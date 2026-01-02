/**
 * Background Service Worker for 2FA Manager Extension
 * Handles storage, TOTP generation, and communication between components
 */

// Import TOTP library
importScripts('totp.js');

// Import Cloud Sync module
importScripts('cloud-sync.js');

// Storage keys
const STORAGE_KEYS = {
  ACCOUNTS: '2fa_accounts',
  SETTINGS: '2fa_settings',
  MASTER_PASSWORD_HASH: '2fa_master_hash',
  NEVER_SAVE_LIST: '2fa_never_save'
};

// Default settings
const DEFAULT_SETTINGS = {
  autoLock: true,
  lockTimeout: 5, // minutes
  clipboardTimeout: 30, // seconds
  showNotifications: true,
  defaultDigits: 6,
  defaultPeriod: 30
};

// In-memory cache for unlocked accounts (encrypted at rest)
let unlockedAccounts = null;
let masterPasswordUnlocked = false;

// Keep-alive interval to prevent service worker from terminating
let keepAliveInterval;

/**
 * Keep service worker alive
 */
function keepAlive() {
  if (keepAliveInterval) return;
  keepAliveInterval = setInterval(() => {
    chrome.runtime.getPlatformInfo(() => {});
  }, 20000); // Every 20 seconds
}

/**
 * Generate a simple hash for master password verification
 * Note: In production, use proper password hashing like bcrypt/argon2
 */
async function hashPassword(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password + '2fa-manager-salt');
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Derive encryption key from password
 */
async function deriveKey(password, salt) {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits', 'deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: encoder.encode(salt),
      iterations: 100000,
      hash: 'SHA-256'
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypt data
 */
async function encryptData(data, password) {
  const salt = '2fa-manager-encryption-salt';
  const key = await deriveKey(password, salt);
  const encoder = new TextEncoder();
  const iv = crypto.getRandomValues(new Uint8Array(12));

  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoder.encode(JSON.stringify(data))
  );

  // Combine IV and encrypted data
  const combined = new Uint8Array(iv.length + encrypted.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(encrypted), iv.length);

  return btoa(String.fromCharCode(...combined));
}

/**
 * Decrypt data
 */
async function decryptData(encryptedData, password) {
  try {
    const salt = '2fa-manager-encryption-salt';
    const key = await deriveKey(password, salt);

    if (!key) {
      console.error('Failed to derive encryption key');
      return null;
    }

    const combined = Uint8Array.from(atob(encryptedData), c => c.charCodeAt(0));

    if (combined.length < 12) {
      console.error('Encrypted data too short');
      return null;
    }

    const iv = combined.slice(0, 12);
    const encrypted = combined.slice(12);

    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      encrypted
    );

    const decoder = new TextDecoder();
    const result = JSON.parse(decoder.decode(decrypted));
    return result;
  } catch (error) {
    console.error('Decryption error:', error);
    return null;
  }
}

/**
 * Initialize or migrate storage
 */
async function initializeStorage() {
  const { settings } = await chrome.storage.local.get({
    settings: null
  });

  // Only initialize settings if not present
  if (!settings) {
    await chrome.storage.local.set({
      settings: DEFAULT_SETTINGS
    });
  }
}

/**
 * Lock the vault
 */
async function lockVault() {
  unlockedAccounts = null;
  masterPasswordUnlocked = false;

  // Clear password from session storage
  await chrome.storage.session.remove('masterPassword');

  // Notify all components
  chrome.runtime.sendMessage({ type: 'VAULT_LOCKED' }).catch(() => {});

  // Update badge
  chrome.action.setBadgeText({ text: '' });
  chrome.action.setBadgeBackgroundColor({ color: '#666666' });
}

/**
 * Unlock the vault
 */
async function unlockVault(password) {
  const { masterHash, accounts: encryptedAccounts } = await chrome.storage.local.get({
    masterHash: null,
    accounts: null
  });

  // First time setup
  if (!masterHash) {
    const hash = await hashPassword(password);
    const emptyAccounts = await encryptData([], password);

    await chrome.storage.local.set({
      masterHash: hash,
      accounts: emptyAccounts
    });

    unlockedAccounts = [];
    masterPasswordUnlocked = true;
    // Store password in session storage (survives service worker restart, cleared on browser close)
    await chrome.storage.session.set({ masterPassword: password });
    return { success: true, firstTime: true };
  }

  // Verify password
  const hash = await hashPassword(password);
  if (hash !== masterHash) {
    return { success: false, error: 'Invalid password' };
  }

  // Decrypt accounts
  const accounts = await decryptData(encryptedAccounts, password);
  if (!accounts) {
    console.error('Failed to decrypt accounts');
    return { success: false, error: 'Decryption failed. The data may be corrupted.' };
  }

  unlockedAccounts = accounts;
  masterPasswordUnlocked = true;
  // Store password in session storage (survives service worker restart, cleared on browser close)
  await chrome.storage.session.set({ masterPassword: password });

  // Update badge
  chrome.action.setBadgeText({ text: '🔓' });
  chrome.action.setBadgeBackgroundColor({ color: '#4CAF50' });

  return { success: true };
}

/**
 * Save accounts
 */
async function saveAccounts(password) {
  if (!unlockedAccounts || !masterPasswordUnlocked) {
    throw new Error('Vault is locked');
  }

  if (!password || password === '') {
    throw new Error('Master password is required');
  }

  const encrypted = await encryptData(unlockedAccounts, password);
  await chrome.storage.local.set({ accounts: encrypted });
}

/**
 * Get all accounts
 */
function getAccounts() {
  return unlockedAccounts || [];
}

/**
 * Get account by ID
 */
function getAccount(id) {
  return getAccounts().find(acc => acc.id === id);
}

/**
 * Get account by domain/issuer
 */
function getAccountByDomain(domain) {
  const accounts = getAccountsByDomain(domain);
  return accounts.length > 0 ? accounts[0] : null;
}

/**
 * Get all accounts for a domain/issuer (for multi-account support)
 */
function getAccountsByDomain(domain) {
  if (!domain) return [];

  let domainLower = domain.toLowerCase().replace('www.', '');

  // If issuer is a full URL, extract hostname for comparison
  const extractHostname = (url) => {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname.replace('www.', '');
    } catch {
      return url;
    }
  };

  return getAccounts().filter(acc => {
    const issuerLower = (acc.issuer || '').toLowerCase();
    const accountNameLower = (acc.accountName || '').toLowerCase();

    // Check if issuer is a full URL
    const issuerHostname = extractHostname(issuerLower);

    // Check if issuer hostname matches domain
    if (issuerHostname === domainLower || domainLower.includes(issuerHostname)) {
      return true;
    }

    // Check if domain matches issuer hostname
    if (issuerHostname.includes(domainLower)) {
      return true;
    }

    // Check if account name matches domain
    if (accountNameLower.includes(domainLower) || domainLower.includes(accountNameLower)) {
      return true;
    }

    // Check domain parts
    const domainParts = domainLower.split('.');
    for (const part of domainParts) {
      if (part.length > 3 && (issuerHostname.includes(part) || accountNameLower.includes(part))) {
        return true;
      }
    }

    return false;
  });
}

/**
 * Generate TOTP code for an account
 */
async function generateTOTPCode(accountId) {
  const account = getAccount(accountId);
  if (!account) {
    throw new Error('Account not found');
  }

  const result = await TOTP.generateTOTP(
    account.secret,
    account.digits || 6,
    account.period || 30
  );

  return {
    accountId,
    code: result.code,
    remainingTime: result.remainingTime,
    issuer: account.issuer,
    accountName: account.accountName
  };
}

/**
 * Generate TOTP codes for all accounts
 */
async function generateAllTOTPCodes() {
  const accounts = getAccounts();
  const codes = await Promise.all(
    accounts.map(async (account) => {
      // If no secret, return credentials-only account
      if (!account.secret) {
        return {
          accountId: account.id,
          code: null,
          remainingTime: 30,
          issuer: account.issuer,
          accountName: account.accountName,
          username: account.username,
          password: account.password,
          iconColor: account.iconColor || '#666666'
        };
      }

      try {
        const result = await TOTP.generateTOTP(
          account.secret,
          account.digits || 6,
          account.period || 30
        );
        return {
          accountId: account.id,
          code: result.code,
          remainingTime: result.remainingTime,
          issuer: account.issuer,
          accountName: account.accountName,
          username: account.username,
          password: account.password,
          iconColor: account.iconColor || '#4CAF50'
        };
      } catch {
        return null;
      }
    })
  );

  return codes.filter(c => c !== null);
}

/**
 * Add new account
 */
async function addAccount(accountData, password) {
  const account = {
    id: crypto.randomUUID(),
    secret: accountData.secret,
    issuer: accountData.issuer || '',
    accountName: accountData.accountName || '',
    username: accountData.username || '',
    password: accountData.password || '',
    digits: accountData.digits || 6,
    period: accountData.period || 30,
    iconColor: accountData.iconColor || generateColor(accountData.issuer),
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  unlockedAccounts.push(account);
  await saveAccounts(password);

  return account;
}

/**
 * Update existing account
 */
async function updateAccount(id, updates, password) {
  const index = unlockedAccounts.findIndex(acc => acc.id === id);
  if (index === -1) {
    throw new Error('Account not found');
  }

  unlockedAccounts[index] = {
    ...unlockedAccounts[index],
    ...updates,
    id,
    updatedAt: Date.now()
  };

  await saveAccounts(password);
  return unlockedAccounts[index];
}

/**
 * Delete account
 */
async function deleteAccount(id, password) {
  const index = unlockedAccounts.findIndex(acc => acc.id === id);
  if (index === -1) {
    throw new Error('Account not found');
  }

  unlockedAccounts.splice(index, 1);
  await saveAccounts(password);
}

/**
 * Generate a consistent color from a string
 */
function generateColor(str) {
  const colors = [
    '#E57373', '#F06292', '#BA68C8', '#9575CD', '#7986CB',
    '#64B5F6', '#4FC3F7', '#4DD0E1', '#4DB6AC', '#81C784',
    '#AED581', '#FFD54F', '#FFB74D', '#FF8A65', '#A1887F'
  ];

  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }

  return colors[Math.abs(hash) % colors.length];
}

/**
 * Check if vault is unlocked
 */
function isUnlocked() {
  return masterPasswordUnlocked;
}

/**
 * Save credentials from page login
 */
async function saveCredentialsFromPage(credentials) {
  if (!masterPasswordUnlocked) {
    throw new Error('Vault is locked');
  }

  // Get password from session storage (survives service worker restarts)
  const sessionData = await chrome.storage.session.get('masterPassword');
  const currentPassword = sessionData.masterPassword;

  if (!currentPassword) {
    throw new Error('Vault is locked');
  }

  const { url, username, password } = credentials;

  // Parse URL to get issuer
  let issuer = url;
  try {
    const urlObj = new URL(url);
    issuer = url; // Store full URL
  } catch {
    // If invalid URL, use as-is
  }

  // Create account data (credentials-only, no 2FA secret)
  const accountData = {
    issuer,
    accountName: username, // Use username as account name for credentials-only
    username,
    password,
    secret: null, // No 2FA secret
    digits: 6,
    period: 30,
    iconColor: generateColor(issuer)
  };

  // Add account
  const account = await addAccount(accountData, currentPassword);
  return account;
}

/**
 * Add domain to "never save" list
 */
async function addToNeverSave(domain) {
  const { neverSaveList } = await chrome.storage.local.get({ neverSaveList: null });

  const list = neverSaveList?.neverSaveList || [];

  if (!list.includes(domain)) {
    list.push(domain);
    await chrome.storage.local.set({
      neverSaveList: { neverSaveList: list }
    });
  }
}

/**
 * Handle messages from content scripts and popup
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      switch (message.type) {
        case 'SET_BADGE':
          // Show/hide badge based on credentials availability
          if (message.hasCredentials) {
            chrome.action.setIcon({
              path: {
                '16': 'icons/icon16-badge.png',
                '48': 'icons/icon48-badge.png',
                '128': 'icons/icon128-badge.png'
              },
              tabId: sender.tab?.id
            }).catch(() => {
              // Fallback if badge icons don't exist
              chrome.action.setBadgeText({ text: '🔑', tabId: sender.tab?.id });
              chrome.action.setBadgeBackgroundColor({ color: '#4CAF50', tabId: sender.tab?.id });
            });
          } else {
            chrome.action.setIcon({
              path: {
                '16': 'icons/icon16.png',
                '48': 'icons/icon48.png',
                '128': 'icons/icon128.png'
              },
              tabId: sender.tab?.id
            }).catch(() => {});
            chrome.action.setBadgeText({ text: '', tabId: sender.tab?.id });
          }
          sendResponse({ success: true });
          break;
        case 'GET_STATUS':
          sendResponse({ unlocked: masterPasswordUnlocked });
          break;

        case 'RESET_VAULT':
          // Clear all data - user must start fresh
          await chrome.storage.local.clear();
          unlockedAccounts = [];
          masterPasswordUnlocked = false;
          sendResponse({ success: true });
          break;

        case 'UNLOCK_VAULT':
          const result = await unlockVault(message.password);
          sendResponse(result);
          break;

        case 'LOCK_VAULT':
          lockVault();
          sendResponse({ success: true });
          break;

        case 'GET_ACCOUNTS':
          // If unlockedAccounts is null but we have password in session, try to decrypt
          if (!unlockedAccounts) {
            const sessionData = await chrome.storage.session.get('masterPassword');
            const password = sessionData.masterPassword;
            if (password) {
              const { accounts: encryptedAccounts } = await chrome.storage.local.get({ accounts: null });
              if (encryptedAccounts) {
                try {
                  const decrypted = await decryptData(encryptedAccounts, password);
                  if (decrypted) {
                    unlockedAccounts = decrypted;
                    masterPasswordUnlocked = true;
                  }
                } catch {
                  // Decryption failed, keep empty
                }
              }
            }
          }
          sendResponse({ success: true, accounts: getAccounts() });
          break;

        case 'GET_ACCOUNT':
          sendResponse({ success: true, account: getAccount(message.id) });
          break;

        case 'FIND_ACCOUNT':
          const foundAccount = getAccountByDomain(message.domain);
          sendResponse({ success: true, account: foundAccount });
          break;

        case 'FIND_ALL_ACCOUNTS':
          const allAccounts = getAccountsByDomain(message.domain);
          sendResponse({ success: true, accounts: allAccounts });
          break;

        case 'GENERATE_TOTP':
          const code = await generateTOTPCode(message.accountId);
          sendResponse({ success: true, data: code });
          break;

        case 'GENERATE_ALL_TOTP':
          const codes = await generateAllTOTPCodes();
          sendResponse({ success: true, data: codes });
          break;

        case 'ADD_ACCOUNT':
          const newAccount = await addAccount(message.account, message.password);
          sendResponse({ success: true, account: newAccount });
          break;

        case 'UPDATE_ACCOUNT':
          // Support both message.account (full account) or message.updates (partial updates)
          const updates = message.updates || message.account;
          const updatedAccount = await updateAccount(message.id, updates, message.password);
          sendResponse({ success: true, account: updatedAccount });
          break;

        case 'DELETE_ACCOUNT':
          await deleteAccount(message.id, message.password);
          sendResponse({ success: true });
          break;

        case 'CHANGE_PASSWORD':
          const { oldPassword, newPassword } = message;
          const newHash = await hashPassword(newPassword);

          // Re-encrypt accounts with new password
          const newEncrypted = await encryptData(unlockedAccounts, newPassword);

          await chrome.storage.local.set({
            masterHash: newHash,
            accounts: newEncrypted
          });

          // Update password in session storage
          await chrome.storage.session.set({ masterPassword: newPassword });
          // Also update in-memory currentMasterPassword in background if it exists
          // Note: This is less secure but necessary for operations that need the password

          sendResponse({ success: true });
          break;

        case 'GET_SETTINGS':
          const { settings } = await chrome.storage.local.get({ settings: DEFAULT_SETTINGS });
          sendResponse({ settings: { ...DEFAULT_SETTINGS, ...settings } });
          break;

        case 'UPDATE_SETTINGS':
          await chrome.storage.local.set({ settings: message.settings });
          sendResponse({ success: true });
          break;

        case 'SAVE_CREDENTIALS':
          const saved = await saveCredentialsFromPage(message.credentials);
          sendResponse({ success: true, account: saved });
          break;

        case 'ADD_TO_NEVER_SAVE':
          await addToNeverSave(message.domain);
          sendResponse({ success: true });
          break;

        case 'IS_NEVER_SAVE':
          const neverSaveList = await chrome.storage.local.get({ neverSaveList: null });
          const isNeverSave = neverSaveList.neverSaveList?.includes(message.domain) || false;
          sendResponse({ success: true, neverSave: isNeverSave });
          break;

        case 'EXPORT_VAULT':
          // Export encrypted vault for backup
          const exportData = await chrome.storage.local.get(['accounts', 'masterHash', 'settings']);
          sendResponse({
            success: true,
            data: {
              version: '1.0',
              exportDate: new Date().toISOString(),
              accounts: exportData.accounts,
              masterHash: exportData.masterHash,
              settings: exportData.settings || DEFAULT_SETTINGS
            }
          });
          break;

        case 'IMPORT_VAULT':
          // Import encrypted vault from backup
          const importData = message.data;

          // Validate import data structure
          if (!importData.version || !importData.accounts || !importData.masterHash) {
            sendResponse({ success: false, error: 'Invalid backup file format' });
            break;
          }

          // Verify the password matches before importing
          const testVault = await unlockVault(message.password);
          if (!testVault.success) {
            sendResponse({ success: false, error: 'Invalid password' });
            break;
          }

          // Import the data (vault is already unlocked from testVault above)
          await chrome.storage.local.set({
            accounts: importData.accounts,
            masterHash: importData.masterHash,
            settings: importData.settings || DEFAULT_SETTINGS
          });

          // Decrypt and load the imported accounts into memory
          const importedAccounts = await decryptData(importData.accounts, message.password);
          if (importedAccounts) {
            unlockedAccounts = importedAccounts;
          }

          sendResponse({ success: true, message: 'Vault imported successfully.' });
          break;

        // ===== Chrome Sync Message Handlers =====

        case 'ENABLE_SYNC':
          const enableResult = await enableSync();
          sendResponse(enableResult);
          break;

        case 'DISABLE_SYNC':
          const disableResult = await disableSync();
          sendResponse(disableResult);
          break;

        case 'GET_SYNC_STATE':
          const syncState = await getSyncState();
          sendResponse({ success: true, state: syncState });
          break;

        case 'UPLOAD_TO_SYNC':
          const uploadResult = await uploadVaultToSync();
          sendResponse(uploadResult);
          break;

        case 'DOWNLOAD_FROM_SYNC':
          const downloadResult = await downloadVaultFromSync();
          sendResponse(downloadResult);
          break;

        case 'CHECK_SYNC_QUOTA':
          const quotaResult = await checkSyncQuota();
          sendResponse(quotaResult);
          break;

        case 'CLEAR_SYNC_DATA':
          const clearResult = await clearSyncData();
          sendResponse(clearResult);
          break;

        case 'APPLY_SYNCED_VAULT':
          // Apply synced vault data (replaces local)
          const applyResult = await applySyncedVault(message.data, message.password);

          if (applyResult.success) {
            // Reload vault into memory
            const reloadResult = await unlockVault(message.password);
            if (reloadResult.success) {
              sendResponse({ success: true, message: 'Synced vault applied successfully.' });
            } else {
              sendResponse({ success: false, error: 'Failed to reload vault' });
            }
          } else {
            sendResponse(applyResult);
          }
          break;

        case 'MERGE_SYNCED_VAULT':
          // Merge synced vault with local (combines both)
          const mergeResult = await mergeSyncedVault(message.data, message.password);

          if (mergeResult.success) {
            // Reload vault into memory
            const reloadResult = await unlockVault(message.password);
            if (reloadResult.success) {
              sendResponse({
                success: true,
                addedCount: mergeResult.addedCount,
                keptCount: mergeResult.keptCount,
                message: 'Vaults merged successfully.'
              });
            } else {
              sendResponse({ success: false, error: 'Failed to reload vault' });
            }
          } else {
            sendResponse(mergeResult);
          }
          break;

        case 'GET_AUTO_SYNC_SETTINGS':
          const autoSyncSettings = await getAutoSyncSettings();
          sendResponse({ success: true, settings: autoSyncSettings });
          break;

        case 'SAVE_AUTO_SYNC_SETTINGS':
          await saveAutoSyncSettings(message.settings);
          // Update alarm based on new settings
          await setupAutoSyncAlarm(message.settings);
          sendResponse({ success: true });
          break;

        case 'VERIFY_VAULT_PASSWORD':
          // Verify if password can decrypt the provided vault
          try {
            const vaultToVerify = message.vault || message.data;
            const decrypted = await decryptData(vaultToVerify, message.password);
            if (decrypted) {
              sendResponse({ success: true });
            } else {
              sendResponse({ success: false, error: 'Decryption failed' });
            }
          } catch (error) {
            sendResponse({ success: false, error: error.message });
          }
          break;

        default:
          sendResponse({ success: false, error: 'Unknown message type' });
      }
    } catch (error) {
      sendResponse({ success: false, error: error.message });
    }

    // Keep message channel open
    return true;
  })();

  return true;
});

/**
 * Setup auto-sync alarm
 */
async function setupAutoSyncAlarm(settings) {
  // Clear existing alarm
  await chrome.alarms.clear('autoSync');

  if (settings.autoSyncEnabled && settings.autoSyncInterval > 0) {
    // Create new alarm
    await chrome.alarms.create('autoSync', {
      delayInMinutes: settings.autoSyncInterval,
      periodInMinutes: settings.autoSyncInterval
    });
    console.log(`Auto-sync alarm created: every ${settings.autoSyncInterval} minutes`);
  }
}

/**
 * Handle auto-sync alarm
 */
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'autoSync') {
    console.log('Auto-sync triggered');

    // Check if sync is enabled
    const syncState = await getSyncState();
    if (syncState.enabled) {
      // Perform auto-upload
      const result = await uploadVaultToSync();
      if (result.success) {
        console.log('Auto-sync completed successfully');
      } else {
        console.error('Auto-sync failed:', result.error);
      }
    }
  }
});

/**
 * Initialize auto-sync on extension startup
 */
chrome.runtime.onStartup.addListener(async () => {
  const settings = await getAutoSyncSettings();
  await setupAutoSyncAlarm(settings);
});

chrome.runtime.onInstalled.addListener(async () => {
  const settings = await getAutoSyncSettings();
  await setupAutoSyncAlarm(settings);
});

/**
 * Handle keyboard shortcut for autofill
 */
chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'autofill-2fa') {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    chrome.tabs.sendMessage(tab.id, {
      type: 'TRIGGER_AUTOFILL'
    }).catch(() => {
      // Inject content script if not loaded
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js']
      });
    });
  }
});

/**
 * Handle install/update
 */
chrome.runtime.onInstalled.addListener(async (details) => {
  await initializeStorage();

  if (details.reason === 'install') {
    // Open options page on first install
    chrome.runtime.openOptionsPage();
  }

  // Register alarms
  chrome.alarms.create('updateCodes', { periodInMinutes: 1 });
});

/**
 * Handle alarms for periodic updates
 */
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'updateCodes') {
    // Broadcast code update to all listeners
    const codes = await generateAllTOTPCodes();
    chrome.runtime.sendMessage({
      type: 'CODES_UPDATED',
      data: codes
    }).catch(() => {});
  }
});

/**
 * Handle startup
 */
chrome.runtime.onStartup.addListener(() => {
  keepAlive();
  initializeStorage();
});

// Initialize
keepAlive();
initializeStorage();
