/**
 * Cloud Sync Module - Chrome Sync Storage Integration
 * Simple cloud sync using Chrome's built-in sync storage
 * No OAuth required - uses user's Chrome/Google account automatically
 */

// Storage keys
const SYNC_ENABLED_KEY = '2fa_sync_enabled';
const SYNC_METADATA_KEY = '2fa_sync_metadata';
const SYNC_ACCOUNT_PREFIX = '2fa_account_';
const SYNC_SETTINGS_KEY = '2fa_sync_settings';

// Chrome sync storage limits
const SYNC_QUOTA_BYTES = 102400; // 100KB
const SYNC_QUOTA_BYTES_PER_ITEM = 8192; // 8KB
const SYNC_MAX_ITEMS = 512;

// Auto-sync intervals (in minutes)
const AUTO_SYNC_INTERVALS = {
  DISABLED: 0,
  FIVE_MIN: 5,
  TEN_MIN: 10,
  THIRTY_MIN: 30,
  ONE_HOUR: 60,
  SIX_HOURS: 360,
  TWELVE_HOURS: 720,
  DAILY: 1440
};

/**
 * Compress data using gzip
 */
async function compressData(data) {
  const json = JSON.stringify(data);
  const blob = new Blob([json], { type: 'application/json' });
  const stream = blob.stream();
  const compressedStream = stream.pipeThrough(new CompressionStream('gzip'));
  const compressedBlob = await new Response(compressedStream).blob();
  const arrayBuffer = await compressedBlob.arrayBuffer();

  // Convert to base64 for storage
  const bytes = new Uint8Array(arrayBuffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Decompress data
 */
async function decompressData(compressedBase64) {
  // Convert from base64
  const binary = atob(compressedBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  const blob = new Blob([bytes]);
  const stream = blob.stream();
  const decompressedStream = stream.pipeThrough(new DecompressionStream('gzip'));
  const decompressedBlob = await new Response(decompressedStream).blob();
  const text = await decompressedBlob.text();
  return JSON.parse(text);
}

// Default sync state
const DEFAULT_SYNC_STATE = {
  enabled: false,
  lastSyncTime: null,
  accountCount: 0,
  bytesUsed: 0,
  lastError: null
};

/**
 * Get sync state
 */
async function getSyncState() {
  const result = await chrome.storage.local.get(SYNC_ENABLED_KEY);
  const enabled = result[SYNC_ENABLED_KEY] || false;

  if (!enabled) {
    return { ...DEFAULT_SYNC_STATE, enabled: false };
  }

  // Calculate current usage
  const syncData = await chrome.storage.sync.get(null);
  const accountKeys = Object.keys(syncData).filter(k => k.startsWith(SYNC_ACCOUNT_PREFIX));
  const bytesUsed = JSON.stringify(syncData).length;

  const metadata = syncData[SYNC_METADATA_KEY] || {};

  return {
    enabled: true,
    lastSyncTime: metadata.lastSyncTime || null,
    accountCount: accountKeys.length,
    bytesUsed: bytesUsed,
    percentUsed: Math.round((bytesUsed / SYNC_QUOTA_BYTES) * 100),
    lastError: null
  };
}

/**
 * Enable sync
 */
async function enableSync() {
  await chrome.storage.local.set({ [SYNC_ENABLED_KEY]: true });
  return { success: true };
}

/**
 * Disable sync
 */
async function disableSync() {
  await chrome.storage.local.set({ [SYNC_ENABLED_KEY]: false });
  return { success: true };
}

/**
 * Upload vault to sync storage
 * Encrypts and stores each account individually for better sync performance
 */
async function uploadVaultToSync() {
  try {
    // Check if sync is enabled
    const syncEnabled = await chrome.storage.local.get(SYNC_ENABLED_KEY);
    if (!syncEnabled[SYNC_ENABLED_KEY]) {
      return { success: false, error: 'Sync not enabled' };
    }

    // Get vault data from local storage (same keys as used in background.js)
    const vaultData = await chrome.storage.local.get(['accounts', 'masterHash', 'settings']);

    if (!vaultData.accounts || !vaultData.masterHash) {
      return { success: false, error: 'No vault data found. Please create accounts first.' };
    }

    // Package vault data (same format as EXPORT_VAULT)
    const vaultToSync = {
      version: '1.0',
      exportDate: new Date().toISOString(),
      accounts: vaultData.accounts,
      masterHash: vaultData.masterHash,
      settings: vaultData.settings || {}
    };

    // Try compression and use it only if beneficial
    const originalSize = JSON.stringify(vaultToSync).length;
    let dataToStore;
    let useCompression = false;
    let compressionRatio = 0;
    let estimatedSize;

    // Only compress if data is large enough to benefit (>2KB)
    if (originalSize > 2048) {
      const compressedVault = await compressData(vaultToSync);
      const compressedSize = compressedVault.length;

      // Use compression only if it saves at least 10%
      if (compressedSize < originalSize * 0.9) {
        dataToStore = compressedVault;
        estimatedSize = compressedSize;
        useCompression = true;
        compressionRatio = Math.round((1 - compressedSize / originalSize) * 100);
      } else {
        // Compression not beneficial, use original
        dataToStore = vaultToSync;
        estimatedSize = originalSize;
      }
    } else {
      // Too small to compress efficiently
      dataToStore = vaultToSync;
      estimatedSize = originalSize;
    }

    if (estimatedSize > SYNC_QUOTA_BYTES) {
      return {
        success: false,
        error: `Vault too large for sync storage (${Math.round(estimatedSize/1024)}KB > 100KB). Please remove some accounts.`
      };
    }

    // Clear existing sync data
    const existingSyncData = await chrome.storage.sync.get(null);
    const keysToRemove = Object.keys(existingSyncData).filter(k =>
      k.startsWith(SYNC_ACCOUNT_PREFIX) || k === SYNC_METADATA_KEY
    );
    if (keysToRemove.length > 0) {
      await chrome.storage.sync.remove(keysToRemove);
    }

    // Store vault (compressed or not)
    const syncKey = SYNC_ACCOUNT_PREFIX + 'vault';
    await chrome.storage.sync.set({
      [syncKey]: dataToStore,
      [SYNC_METADATA_KEY]: {
        lastSyncTime: Date.now(),
        version: 1,
        compressed: useCompression,
        originalSize: originalSize,
        compressedSize: estimatedSize,
        compressionRatio: compressionRatio
      }
    });

    return {
      success: true,
      timestamp: Date.now(),
      bytesUsed: estimatedSize,
      originalSize: originalSize,
      compressionRatio: compressionRatio
    };

  } catch (error) {
    console.error('Upload to sync error:', error);

    // Handle quota errors
    if (error.message && error.message.includes('QUOTA')) {
      return {
        success: false,
        error: 'Storage quota exceeded. Please remove some accounts and try again.'
      };
    }

    return {
      success: false,
      error: error.message || 'Upload failed'
    };
  }
}

/**
 * Download vault from sync storage
 */
async function downloadVaultFromSync() {
  try {
    // Check if sync is enabled
    const syncEnabled = await chrome.storage.local.get(SYNC_ENABLED_KEY);
    if (!syncEnabled[SYNC_ENABLED_KEY]) {
      return { success: false, error: 'Sync not enabled' };
    }

    // Get vault from sync storage
    const syncKey = SYNC_ACCOUNT_PREFIX + 'vault';
    const syncData = await chrome.storage.sync.get([syncKey, SYNC_METADATA_KEY]);

    if (!syncData[syncKey]) {
      return { success: false, error: 'No cloud backup found. Upload your vault first.' };
    }

    const metadata = syncData[SYNC_METADATA_KEY] || {};

    // Decompress if needed
    let syncedVault;
    if (metadata.compressed) {
      syncedVault = await decompressData(syncData[syncKey]);
    } else {
      syncedVault = syncData[syncKey];
    }

    // Validate vault structure
    if (!syncedVault.accounts || !syncedVault.masterHash) {
      return { success: false, error: 'Invalid cloud backup format' };
    }

    // Check for conflicts (compare timestamps)
    const localVault = await chrome.storage.local.get(['accounts', 'masterHash']);

    let needsConflictResolution = false;

    // Only show conflict if there's actual local encrypted data
    // Check if accounts is a non-empty string (encrypted data)
    if (localVault.accounts && typeof localVault.accounts === 'string' && localVault.accounts.length > 10 && localVault.masterHash) {
      const syncTime = metadata.lastSyncTime || 0;
      const now = Date.now();

      // If local vault exists and sync is not recent, ask user
      if (syncTime > 0 && (now - syncTime > 60000)) { // More than 1 minute old
        needsConflictResolution = true;
      }
    }

    return {
      success: true,
      data: syncedVault,
      timestamp: metadata.lastSyncTime,
      needsConflictResolution: needsConflictResolution
    };

  } catch (error) {
    console.error('Download from sync error:', error);
    return {
      success: false,
      error: error.message || 'Download failed'
    };
  }
}

/**
 * Apply synced vault to local storage
 * This replaces the local vault with the synced version
 * Note: This function runs in background.js context, so it can directly use decryptData
 */
async function applySyncedVault(syncedVault, password) {
  try {
    // Validate vault structure
    if (!syncedVault || !syncedVault.accounts || !syncedVault.masterHash) {
      console.error('Invalid vault structure');
      return {
        success: false,
        error: 'Invalid vault data'
      };
    }

    // Verify password matches by trying to decrypt the accounts
    // Since we're in background.js context, call decryptData directly
    let testDecrypt;
    try {
      testDecrypt = await decryptData(syncedVault.accounts, password);
    } catch (error) {
      console.error('Decryption failed:', error);
      return {
        success: false,
        error: 'Invalid master password. Make sure you use the same password on all devices.'
      };
    }

    if (!testDecrypt) {
      console.error('Decryption returned null/undefined');
      return {
        success: false,
        error: 'Invalid master password. Make sure you use the same password on all devices.'
      };
    }

    // Replace local vault with synced data
    await chrome.storage.local.set({
      accounts: syncedVault.accounts,
      masterHash: syncedVault.masterHash,
      settings: syncedVault.settings || {}
    });

    return { success: true };

  } catch (error) {
    console.error('Apply synced vault error:', error);
    return {
      success: false,
      error: error.message || 'Failed to apply vault'
    };
  }
}

/**
 * Check sync storage quota
 */
async function checkSyncQuota() {
  try {
    const syncData = await chrome.storage.sync.get(null);
    const bytesUsed = JSON.stringify(syncData).length;
    const itemCount = Object.keys(syncData).length;

    return {
      success: true,
      bytesUsed: bytesUsed,
      bytesAvailable: SYNC_QUOTA_BYTES - bytesUsed,
      percentUsed: Math.round((bytesUsed / SYNC_QUOTA_BYTES) * 100),
      itemCount: itemCount,
      itemsAvailable: SYNC_MAX_ITEMS - itemCount
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Clear all sync data
 */
async function clearSyncData() {
  try {
    const syncData = await chrome.storage.sync.get(null);
    const keysToRemove = Object.keys(syncData).filter(k =>
      k.startsWith(SYNC_ACCOUNT_PREFIX) || k === SYNC_METADATA_KEY
    );

    if (keysToRemove.length > 0) {
      await chrome.storage.sync.remove(keysToRemove);
    }

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Get auto-sync settings
 */
async function getAutoSyncSettings() {
  const result = await chrome.storage.local.get(SYNC_SETTINGS_KEY);
  return result[SYNC_SETTINGS_KEY] || {
    autoSyncEnabled: false,
    autoSyncInterval: AUTO_SYNC_INTERVALS.DISABLED
  };
}

/**
 * Save auto-sync settings
 */
async function saveAutoSyncSettings(settings) {
  await chrome.storage.local.set({
    [SYNC_SETTINGS_KEY]: settings
  });
  return { success: true };
}

/**
 * Merge synced vault with local vault
 * Combines accounts from both, deduplicating by ID
 */
async function mergeSyncedVault(syncedVault, password) {
  try {
    // Validate vault structure
    if (!syncedVault || !syncedVault.accounts || !syncedVault.masterHash) {
      console.error('Invalid vault structure');
      return {
        success: false,
        error: 'Invalid vault data'
      };
    }

    // Decrypt cloud accounts
    let cloudAccounts;
    try {
      cloudAccounts = await decryptData(syncedVault.accounts, password);
    } catch (error) {
      console.error('Failed to decrypt cloud accounts:', error);
      return {
        success: false,
        error: 'Invalid master password or corrupted cloud data'
      };
    }

    if (!cloudAccounts || !Array.isArray(cloudAccounts)) {
      return {
        success: false,
        error: 'Invalid cloud accounts data'
      };
    }

    // Get local vault
    const localVault = await chrome.storage.local.get(['accounts', 'masterHash']);
    let localAccounts = [];

    if (localVault.accounts && localVault.masterHash) {
      // Decrypt local accounts
      try {
        localAccounts = await decryptData(localVault.accounts, password);
      } catch (error) {
        console.error('Failed to decrypt local accounts:', error);
        // Continue with empty local accounts if decryption fails
        localAccounts = [];
      }
    }

    if (!Array.isArray(localAccounts)) {
      localAccounts = [];
    }

    // Merge accounts - deduplicate by ID
    const accountMap = new Map();

    // Add local accounts first
    for (const account of localAccounts) {
      if (account && account.id) {
        accountMap.set(account.id, account);
      }
    }

    const localCount = accountMap.size;

    // Add cloud accounts (will overwrite if same ID exists, but keep both if different IDs)
    let addedFromCloud = 0;
    for (const account of cloudAccounts) {
      if (account && account.id) {
        if (!accountMap.has(account.id)) {
          addedFromCloud++;
        }
        accountMap.set(account.id, account);
      }
    }

    // Convert back to array
    const mergedAccounts = Array.from(accountMap.values());

    // Re-encrypt merged accounts
    const encryptedAccounts = await encryptData(mergedAccounts, password);

    // Save to storage
    await chrome.storage.local.set({
      accounts: encryptedAccounts,
      masterHash: syncedVault.masterHash, // Use cloud's master hash (should be same)
      settings: syncedVault.settings || {}
    });


    return {
      success: true,
      addedCount: addedFromCloud,
      keptCount: localCount
    };

  } catch (error) {
    console.error('Merge synced vault error:', error);
    return {
      success: false,
      error: error.message || 'Failed to merge vaults'
    };
  }
}
