/**
 * Background Service Worker for 2FA Manager Extension
 */

// Import TOTP library
importScripts('totp.js');

// Import Cloud Sync module
importScripts('cloud-sync.js');

// Standardized Storage Keys
const KEYS = {
  ACCOUNTS: 'accounts',
  SETTINGS: 'settings',
  MASTER_HASH: 'masterHash'
};

const DEFAULT_SETTINGS = {
  autoLock: true,
  lockTimeout: 5,
  clipboardTimeout: 30,
  showNotifications: true,
  defaultDigits: 6,
  defaultPeriod: 30
};

// Internal state
let unlockedAccounts = null;
let masterPasswordUnlocked = false;

/* ==========================================================================
   CRYPTOGRAPHY CORE
   ========================================================================== */

async function deriveKey(password, salt) {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw', encoder.encode(password), { name: 'PBKDF2' }, false, ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: encoder.encode(salt), iterations: 100000, hash: 'SHA-256' },
    keyMaterial, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
  );
}

async function hashPassword(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password + '2fa-manager-salt');
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function encryptData(data, password) {
  const salt = '2fa-manager-encryption-salt';
  const key = await deriveKey(password, salt);
  const encoder = new TextEncoder();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(JSON.stringify(data)));
  const combined = new Uint8Array(iv.length + encrypted.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(encrypted), iv.length);
  let binary = '';
  for (let i = 0; i < combined.byteLength; i++) binary += String.fromCharCode(combined[i]);
  return btoa(binary);
}

async function decryptData(encryptedData, password) {
  try {
    const salt = '2fa-manager-encryption-salt';
    const key = await deriveKey(password, salt);
    const binary = atob(encryptedData);
    const combined = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) combined[i] = binary.charCodeAt(i);
    const iv = combined.slice(0, 12);
    const encrypted = combined.slice(12);
    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, encrypted);
    return JSON.parse(new TextDecoder().decode(decrypted));
  } catch (error) { return null; }
}

/* ==========================================================================
   VAULT LOGIC
   ========================================================================== */

async function unlockVault(password) {
  const data = await chrome.storage.local.get([KEYS.MASTER_HASH, KEYS.ACCOUNTS]);
  const masterHash = data[KEYS.MASTER_HASH];
  const encryptedAccounts = data[KEYS.ACCOUNTS];

  if (!masterHash) {
    const hash = await hashPassword(password);
    const emptyEnc = await encryptData([], password);
    await chrome.storage.local.set({ [KEYS.MASTER_HASH]: hash, [KEYS.ACCOUNTS]: emptyEnc });
    unlockedAccounts = [];
    masterPasswordUnlocked = true;
    await chrome.storage.session.set({ masterPassword: password });
    return { success: true, firstTime: true };
  }

  const hash = await hashPassword(password);
  if (hash !== masterHash) return { success: false, error: 'Invalid password' };

  const accounts = await decryptData(encryptedAccounts, password);
  if (!accounts) return { success: false, error: 'Decryption failed' };

  unlockedAccounts = accounts;
  masterPasswordUnlocked = true;
  await chrome.storage.session.set({ masterPassword: password });
  chrome.action.setBadgeText({ text: '🔓' });
  chrome.action.setBadgeBackgroundColor({ color: '#4CAF50' });
  return { success: true };
}

/* ==========================================================================
   MESSAGE HANDLER
   ========================================================================== */

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      switch (message.type) {
        case 'GET_STATUS':
          const data = await chrome.storage.local.get(KEYS.MASTER_HASH);
          sendResponse({ unlocked: masterPasswordUnlocked, vaultExists: !!data[KEYS.MASTER_HASH] });
          break;

        case 'UNLOCK_VAULT': sendResponse(await unlockVault(message.password)); break;
        case 'LOCK_VAULT':
          unlockedAccounts = null;
          masterPasswordUnlocked = false;
          await chrome.storage.session.remove('masterPassword');
          chrome.action.setBadgeText({ text: '' });
          sendResponse({ success: true });
          break;

        case 'GET_ACCOUNTS':
          if (!masterPasswordUnlocked) sendResponse({ success: false, error: 'Locked' });
          else sendResponse({ success: true, accounts: unlockedAccounts || [] });
          break;

        case 'ADD_ACCOUNT':
        case 'UPDATE_ACCOUNT':
          if (!masterPasswordUnlocked) { sendResponse({ success: false, error: 'Locked' }); break; }
          if (message.type === 'ADD_ACCOUNT') {
            unlockedAccounts.push({ ...message.account, id: crypto.randomUUID(), createdAt: Date.now() });
          } else {
            const idx = unlockedAccounts.findIndex(a => a.id === message.id);
            if (idx !== -1) unlockedAccounts[idx] = { ...unlockedAccounts[idx], ...message.account };
          }
          const enc = await encryptData(unlockedAccounts, message.password);
          await chrome.storage.local.set({ [KEYS.ACCOUNTS]: enc });
          sendResponse({ success: true });
          break;

        case 'DELETE_ACCOUNT':
          unlockedAccounts = unlockedAccounts.filter(a => a.id !== message.id);
          const encDel = await encryptData(unlockedAccounts, message.password);
          await chrome.storage.local.set({ [KEYS.ACCOUNTS]: encDel });
          sendResponse({ success: true });
          break;

        case 'IMPORT_VAULT':
          const impData = message.data;
          const impHash = await hashPassword(message.password);
          if (impHash !== impData.masterHash) { sendResponse({ success: false, error: 'Invalid password for backup' }); break; }
          await chrome.storage.local.set({
            [KEYS.ACCOUNTS]: impData.accounts,
            [KEYS.MASTER_HASH]: impData.masterHash,
            [KEYS.SETTINGS]: impData.settings || DEFAULT_SETTINGS
          });
          await unlockVault(message.password);
          sendResponse({ success: true });
          break;

        case 'RESET_VAULT':
          await chrome.storage.local.clear();
          await disableSync();
          unlockedAccounts = null;
          masterPasswordUnlocked = false;
          sendResponse({ success: true });
          break;

        case 'GENERATE_TOTP':
          const singleAcc = unlockedAccounts.find(a => a.id === message.accountId);
          if (!singleAcc || !singleAcc.secret) { sendResponse({ success: false }); break; }
          const sRes = await TOTP.generateTOTP(singleAcc.secret, singleAcc.digits, singleAcc.period);
          sendResponse({ success: true, data: { code: sRes.code, remainingTime: sRes.remainingTime } });
          break;

        case 'GENERATE_ALL_TOTP':
          if (!unlockedAccounts) { sendResponse({ success: false }); break; }
          const totpResults = [];
          for (const a of unlockedAccounts) {
            let code = null;
            let remainingTime = 0;
            if (a.secret) {
              try {
                const res = await TOTP.generateTOTP(a.secret, a.digits, a.period);
                code = res.code;
                remainingTime = res.remainingTime;
              } catch (e) { console.error('TOTP Gen Error:', e); }
            }
            totpResults.push({
              accountId: a.id, issuer: a.issuer, accountName: a.accountName, 
              username: a.username, password: a.password,
              code, remainingTime, period: a.period, 
              iconColor: a.iconColor || '#4CAF50'
            });
          }
          sendResponse({ success: true, data: totpResults });
          break;

        case 'FIND_ALL_ACCOUNTS':
          if (!masterPasswordUnlocked) { sendResponse({ success: false, error: 'Locked' }); break; }
          const domain = message.domain.toLowerCase();
          const matches = unlockedAccounts.filter(a => (a.issuer || '').toLowerCase().includes(domain));
          sendResponse({ success: true, accounts: matches });
          break;

        case 'SAVE_CREDENTIALS':
          if (!masterPasswordUnlocked) { sendResponse({ success: false, error: 'Locked' }); break; }
          const { url, username, password } = message.credentials;
          const host = new URL(url).hostname.replace('www.', '');
          
          const newAccount = {
            id: crypto.randomUUID(),
            issuer: host,
            accountName: username,
            username: username,
            password: password,
            secret: '',
            digits: 6,
            period: 30,
            iconColor: '#4CAF50',
            createdAt: Date.now()
          };
          
          unlockedAccounts.push(newAccount);
          const sessionPass = (await chrome.storage.session.get('masterPassword')).masterPassword;
          const encNew = await encryptData(unlockedAccounts, sessionPass);
          await chrome.storage.local.set({ [KEYS.ACCOUNTS]: encNew });
          sendResponse({ success: true });
          break;

        case 'IS_NEVER_SAVE':
          const nsData = await chrome.storage.local.get('never_save');
          const nsList = nsData.never_save || [];
          sendResponse({ success: true, neverSave: nsList.includes(message.domain) });
          break;

        case 'ADD_TO_NEVER_SAVE':
          const nsAddData = await chrome.storage.local.get('never_save');
          const nsAddList = nsAddData.never_save || [];
          if (!nsAddList.includes(message.domain)) {
            nsAddList.push(message.domain);
            await chrome.storage.local.set({ never_save: nsAddList });
          }
          sendResponse({ success: true });
          break;

        case 'SET_BADGE':
          if (message.hasCredentials) {
            chrome.action.setBadgeText({ text: '🔑', tabId: sender.tab?.id });
          } else {
            chrome.action.setBadgeText({ text: '', tabId: sender.tab?.id });
          }
          sendResponse({ success: true });
          break;

        case 'UPDATE_SETTINGS':
          await chrome.storage.local.set({ [KEYS.SETTINGS]: message.settings });
          sendResponse({ success: true });
          break;

        case 'ENABLE_SYNC': sendResponse(await enableSync()); break;
        case 'DISABLE_SYNC': sendResponse(await disableSync()); break;
        case 'GET_SYNC_STATE': sendResponse({ success: true, state: await getSyncState() }); break;
        case 'UPLOAD_TO_SYNC': sendResponse(await uploadVaultToSync()); break;
        case 'DOWNLOAD_FROM_SYNC': sendResponse(await downloadVaultFromSync()); break;
        case 'CHECK_SYNC_DATA': sendResponse({ success: true, data: await checkSyncData() }); break;
        case 'APPLY_SYNCED_VAULT':
          const aRes = await applySyncedVault(message.data, message.password);
          if (aRes.success) await unlockVault(message.password);
          sendResponse(aRes);
          break;
        case 'MERGE_SYNCED_VAULT':
          const mRes = await mergeSyncedVault(message.data, message.password);
          if (mRes.success) await unlockVault(message.password);
          sendResponse(mRes);
          break;

        case 'GET_AUTO_SYNC_SETTINGS': sendResponse({ success: true, settings: await getAutoSyncSettings() }); break;
        case 'SAVE_AUTO_SYNC_SETTINGS': 
          await saveAutoSyncSettings(message.settings);
          await setupAutoSyncAlarm(message.settings);
          sendResponse({ success: true });
          break;

        default: sendResponse({ success: false, error: 'Unknown action' });
      }
    } catch (e) { sendResponse({ success: false, error: e.message }); }
    return true;
  })();
  return true;
});

async function setupAutoSyncAlarm(s) {
  try {
    await chrome.alarms.clear('autoSync');
    if (s.autoSyncEnabled && s.autoSyncInterval > 0) {
      const interval = Math.max(1, s.autoSyncInterval);
      chrome.alarms.create('autoSync', { delayInMinutes: interval, periodInMinutes: interval });
    }
  } catch (e) {}
}

chrome.alarms.onAlarm.addListener(async (a) => {
  if (a.name === 'autoSync') {
    const state = await getSyncState();
    if (state.enabled) await uploadVaultToSync();
  }
});

chrome.runtime.onInstalled.addListener(async () => {
  if (chrome.storage.session.setAccessLevel) {
    chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' });
  }
});
