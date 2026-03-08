/**
 * Cloud Sync Module - Bulletproof Refactor
 * Uses individual account chunking to bypass 8KB limits.
 */

const SYNC_ENABLED_KEY = '2fa_sync_enabled';
const SYNC_MANIFEST_KEY = '2fa_sync_manifest';
const SYNC_ACC_PREFIX = '2fa_acc_'; 

const SYNC_QUOTA_BYTES = 102400;

/**
 * Get sync state
 */
async function getSyncState() {
  const localRes = await chrome.storage.local.get(SYNC_ENABLED_KEY);
  const syncRes = await chrome.storage.sync.get(SYNC_ENABLED_KEY);
  const enabled = localRes[SYNC_ENABLED_KEY] || syncRes[SYNC_ENABLED_KEY] || false;

  const syncData = await chrome.storage.sync.get(null);
  const manifest = syncData[SYNC_MANIFEST_KEY] || { accounts: [], lastSyncTime: null };
  const bytesUsed = JSON.stringify(syncData).length;

  return {
    enabled: enabled,
    lastSyncTime: manifest.lastSyncTime,
    accountCount: manifest.accounts ? manifest.accounts.length : 0,
    bytesUsed: bytesUsed,
    percentUsed: Math.round((bytesUsed / SYNC_QUOTA_BYTES) * 100),
    dataExists: !!manifest.lastSyncTime
  };
}

/**
 * Enable sync
 */
async function enableSync() {
  await chrome.storage.local.set({ [SYNC_ENABLED_KEY]: true });
  await chrome.storage.sync.set({ [SYNC_ENABLED_KEY]: true });
  return { success: true };
}

/**
 * Disable sync
 */
async function disableSync() {
  await chrome.storage.local.set({ [SYNC_ENABLED_KEY]: false });
  await chrome.storage.sync.set({ [SYNC_ENABLED_KEY]: false });
  return { success: true };
}

/**
 * Upload Vault - Transactional Chunking
 */
async function uploadVaultToSync() {
  try {
    // 1. Get standardized keys from local storage
    const data = await chrome.storage.local.get(['accounts', 'masterHash', 'settings']);
    if (!data.accounts || !data.masterHash) return { success: false, error: 'Vault is empty' };

    // 2. Get current password from session
    const session = await chrome.storage.session.get('masterPassword');
    if (!session.masterPassword) return { success: false, error: 'Vault is locked' };

    // 3. Decrypt accounts to prepare for chunking
    const accounts = await decryptData(data.accounts, session.masterPassword);
    if (!accounts) return { success: false, error: 'Local decryption failed' };

    // 4. Prepare account chunks
    const syncPayload = {};
    const accountIds = [];
    for (const acc of accounts) {
      if (!acc.id) continue;
      // Re-encrypt individual account
      const encryptedAcc = await encryptData(acc, session.masterPassword);
      syncPayload[SYNC_ACC_PREFIX + acc.id] = encryptedAcc;
      accountIds.push(acc.id);
    }

    // 5. Create the Manifest (Saved LAST to ensure integrity)
    const manifest = {
      accounts: accountIds,
      masterHash: data.masterHash,
      settings: data.settings || {},
      lastSyncTime: Date.now(),
      v: 3
    };

    // 6. Clear OLD accounts from sync to avoid orphan data
    const allSync = await chrome.storage.sync.get(null);
    const keysToRemove = Object.keys(allSync).filter(k => k.startsWith(SYNC_ACC_PREFIX));
    if (keysToRemove.length > 0) await chrome.storage.sync.remove(keysToRemove);

    // 7. Perform the write
    await chrome.storage.sync.set(syncPayload);
    await chrome.storage.sync.set({ [SYNC_MANIFEST_KEY]: manifest, [SYNC_ENABLED_KEY]: true });

    return { success: true, accountCount: accountIds.length, bytesUsed: JSON.stringify(syncPayload).length };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * Download Vault
 */
async function downloadVaultFromSync() {
  try {
    const syncData = await chrome.storage.sync.get(null);
    const manifest = syncData[SYNC_MANIFEST_KEY];

    if (!manifest || !manifest.accounts || manifest.accounts.length === 0) {
      return { success: false, error: 'No cloud backup found' };
    }

    const encryptedAccounts = [];
    for (const id of manifest.accounts) {
      const chunk = syncData[SYNC_ACC_PREFIX + id];
      if (chunk) encryptedAccounts.push(chunk);
    }

    if (encryptedAccounts.length === 0) return { success: false, error: 'Corrupted backup' };

    return {
      success: true,
      data: { accounts: encryptedAccounts, masterHash: manifest.masterHash, settings: manifest.settings },
      timestamp: manifest.lastSyncTime
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * Apply/Merge
 */
async function applySyncedVault(syncedVault, password) {
  try {
    const hash = await hashPassword(password);
    if (hash !== syncedVault.masterHash) return { success: false, error: 'Invalid password for backup' };

    const decrypted = [];
    for (const chunk of syncedVault.accounts) {
      const dec = await decryptData(chunk, password);
      if (dec) decrypted.push(dec);
    }

    const localBlob = await encryptData(decrypted, password);
    await chrome.storage.local.set({
      accounts: localBlob,
      masterHash: syncedVault.masterHash,
      settings: syncedVault.settings || {},
      [SYNC_ENABLED_KEY]: true
    });
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function mergeSyncedVault(syncedVault, password) {
  try {
    const cloudAccounts = [];
    for (const chunk of syncedVault.accounts) {
      const dec = await decryptData(chunk, password);
      if (dec) cloudAccounts.push(dec);
    }

    const localData = await chrome.storage.local.get('accounts');
    let localAccounts = [];
    if (localData.accounts) localAccounts = await decryptData(localData.accounts, password) || [];

    const map = new Map();
    localAccounts.forEach(a => map.set(a.id, a));
    let added = 0;
    cloudAccounts.forEach(a => { if (!map.has(a.id)) { map.set(a.id, a); added++; } });

    const mergedBlob = await encryptData(Array.from(map.values()), password);
    await chrome.storage.local.set({ accounts: mergedBlob, [SYNC_ENABLED_KEY]: true });
    return { success: true, addedCount: added, keptCount: localAccounts.length };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/** Debug */
async function checkSyncData() {
  try {
    const data = await chrome.storage.sync.get(null);
    const keys = Object.keys(data);
    return {
      success: true,
      hasManifest: keys.includes(SYNC_MANIFEST_KEY),
      accountCount: keys.filter(k => k.startsWith(SYNC_ACC_PREFIX)).length,
      keys: keys,
      totalSize: JSON.stringify(data).length
    };
  } catch (e) { return { success: false, error: e.message }; }
}

async function getAutoSyncSettings() { 
  const r = await chrome.storage.local.get('2fa_sync_settings'); 
  return r['2fa_sync_settings'] || { autoSyncEnabled: false, autoSyncInterval: 30 }; 
}
async function saveAutoSyncSettings(s) { 
  await chrome.storage.local.set({ '2fa_sync_settings': s }); 
  return { success: true }; 
}
