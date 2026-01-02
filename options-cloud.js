/**
 * Chrome Sync UI Integration for Options Page
 * Handles Chrome sync functionality within the main options page
 */

// Sync state
let syncState = null;
let pendingSyncDownload = null;
let syncStateRefreshInterval = null;

/**
 * Initialize Chrome sync UI (called from options.js)
 */
async function initCloudSync() {
  await loadSyncState();
  await loadAutoSyncSettings();
  setupSyncEventListeners();
  setupAutoSyncEventListeners();
  updateSyncUI();
  startSyncStateRefresh();
}

/**
 * Start auto-refresh of sync state (updates last sync time)
 */
function startSyncStateRefresh() {
  // Clear existing interval
  if (syncStateRefreshInterval) {
    clearInterval(syncStateRefreshInterval);
  }

  // Refresh every 30 seconds
  syncStateRefreshInterval = setInterval(async () => {
    await loadSyncState();
    updateSyncUI();
  }, 30000);
}

/**
 * Stop auto-refresh
 */
function stopSyncStateRefresh() {
  if (syncStateRefreshInterval) {
    clearInterval(syncStateRefreshInterval);
    syncStateRefreshInterval = null;
  }
}

/**
 * Load sync state
 */
async function loadSyncState() {
  const response = await sendMessage({ type: 'GET_SYNC_STATE' });
  if (response.success) {
    syncState = response.state;
  }
}

/**
 * Setup sync event listeners
 */
function setupSyncEventListeners() {
  // Enable/Disable sync
  const enableBtn = document.getElementById('enable-sync-btn');
  if (enableBtn) {
    enableBtn.addEventListener('click', enableChromeSync);
  }

  const disableBtn = document.getElementById('disable-sync-btn');
  if (disableBtn) {
    disableBtn.addEventListener('click', disableChromeSync);
  }

  // Upload/Download actions
  const uploadBtn = document.getElementById('upload-sync-btn');
  if (uploadBtn) {
    uploadBtn.addEventListener('click', uploadToSync);
  }

  const downloadBtn = document.getElementById('download-sync-btn');
  if (downloadBtn) {
    downloadBtn.addEventListener('click', downloadFromSync);
  }

  // Conflict resolution (reuse existing modals from import/export)
  const mergeBothBtn = document.getElementById('merge-both-btn');
  if (mergeBothBtn) {
    mergeBothBtn.addEventListener('click', mergeBothVersions);
  }

  const useCloudBtn = document.getElementById('use-cloud-version-btn');
  if (useCloudBtn) {
    useCloudBtn.addEventListener('click', useCloudVersion);
  }

  const keepLocalBtn = document.getElementById('keep-local-version-btn');
  if (keepLocalBtn) {
    keepLocalBtn.addEventListener('click', keepLocalVersion);
  }

  const cancelConflictBtn = document.getElementById('cancel-conflict-btn');
  if (cancelConflictBtn) {
    cancelConflictBtn.addEventListener('click', () => closeConflictModal(true));
  }

  const closeConflictBtn = document.getElementById('close-conflict-modal');
  if (closeConflictBtn) {
    closeConflictBtn.addEventListener('click', () => closeConflictModal(true));
  }

  // Modal click outside
  const conflictModal = document.getElementById('conflict-modal');
  if (conflictModal) {
    conflictModal.addEventListener('click', (e) => {
      if (e.target.id === 'conflict-modal') {
        closeConflictModal(true);
      }
    });
  }
}

/**
 * Update sync UI
 */
function updateSyncUI() {
  if (!syncState) return;

  const isEnabled = syncState.enabled;

  // Update status
  const enabledStatus = document.getElementById('sync-enabled-status');
  if (enabledStatus) {
    if (isEnabled) {
      enabledStatus.textContent = '✓ Enabled';
      enabledStatus.classList.add('enabled');
      enabledStatus.classList.remove('disabled');
    } else {
      enabledStatus.textContent = '✗ Disabled';
      enabledStatus.classList.remove('enabled');
      enabledStatus.classList.add('disabled');
    }
  }

  // Update storage used
  const storageUsed = document.getElementById('sync-storage-used');
  if (storageUsed) {
    if (isEnabled && syncState.bytesUsed !== undefined) {
      const kb = (syncState.bytesUsed / 1024).toFixed(1);
      const percent = syncState.percentUsed || 0;
      storageUsed.textContent = `${kb} KB (${percent}%)`;
    } else {
      storageUsed.textContent = '--';
    }
  }

  // Update last sync time
  const lastTime = document.getElementById('sync-last-time');
  if (lastTime) {
    if (isEnabled && syncState.lastSyncTime) {
      const date = new Date(syncState.lastSyncTime);
      lastTime.textContent = date.toLocaleString();
    } else {
      lastTime.textContent = 'Never';
    }
  }

  // Show/hide buttons and cards
  const enableBtn = document.getElementById('enable-sync-btn');
  const disableBtn = document.getElementById('disable-sync-btn');
  const actionsCard = document.getElementById('sync-actions-card');
  const autoSyncCard = document.getElementById('auto-sync-settings-card');

  if (isEnabled) {
    if (enableBtn) enableBtn.classList.add('hidden');
    if (disableBtn) disableBtn.classList.remove('hidden');
    if (actionsCard) actionsCard.style.display = 'block';
    if (autoSyncCard) autoSyncCard.style.display = 'block';
  } else {
    if (enableBtn) enableBtn.classList.remove('hidden');
    if (disableBtn) disableBtn.classList.add('hidden');
    if (actionsCard) actionsCard.style.display = 'none';
    if (autoSyncCard) autoSyncCard.style.display = 'none';
  }
}

/**
 * Enable Chrome sync
 */
async function enableChromeSync() {
  const enableBtn = document.getElementById('enable-sync-btn');
  if (enableBtn) {
    enableBtn.disabled = true;
    enableBtn.textContent = 'Enabling...';
  }

  try {
    const response = await sendMessage({ type: 'ENABLE_SYNC' });

    if (response.success) {
      if (typeof showToast === 'function') {
        showToast('✓ Chrome Sync enabled!');
      }
      await loadSyncState();
      updateSyncUI();
    } else {
      if (typeof showToast === 'function') {
        showToast('Failed to enable sync: ' + response.error);
      }
    }
  } catch (error) {
    if (typeof showToast === 'function') {
      showToast('Error enabling sync: ' + error.message);
    }
    console.error('Enable sync error:', error);
  } finally {
    if (enableBtn) {
      enableBtn.disabled = false;
      enableBtn.textContent = 'Enable Sync';
    }
  }
}

/**
 * Disable Chrome sync
 */
async function disableChromeSync() {
  if (!confirm('Disable Chrome Sync? Your local vault will not be affected, but it will stop syncing to the cloud.')) {
    return;
  }

  const disableBtn = document.getElementById('disable-sync-btn');
  if (disableBtn) {
    disableBtn.disabled = true;
    disableBtn.textContent = 'Disabling...';
  }

  try {
    const response = await sendMessage({ type: 'DISABLE_SYNC' });

    if (response.success) {
      if (typeof showToast === 'function') {
        showToast('✓ Chrome Sync disabled');
      }
      await loadSyncState();
      updateSyncUI();
    } else {
      if (typeof showToast === 'function') {
        showToast('Failed to disable sync: ' + response.error);
      }
    }
  } catch (error) {
    if (typeof showToast === 'function') {
      showToast('Error disabling sync: ' + error.message);
    }
    console.error('Disable sync error:', error);
  } finally {
    if (disableBtn) {
      disableBtn.disabled = false;
      disableBtn.textContent = 'Disable Sync';
    }
  }
}

/**
 * Upload vault to Chrome sync
 */
async function uploadToSync() {
  const uploadBtn = document.getElementById('upload-sync-btn');
  if (uploadBtn) {
    uploadBtn.disabled = true;
    uploadBtn.textContent = 'Uploading...';
  }

  try {
    const response = await sendMessage({ type: 'UPLOAD_TO_SYNC' });

    if (response.success) {
      const kb = (response.bytesUsed / 1024).toFixed(1);
      const compressionInfo = response.compressionRatio
        ? ` (saved ${response.compressionRatio}% with compression)`
        : '';
      if (typeof showToast === 'function') {
        showToast(`✓ Vault uploaded to Chrome Sync: ${kb} KB${compressionInfo}`);
      }
      await loadSyncState();
      updateSyncUI();
    } else {
      if (typeof showToast === 'function') {
        showToast('Upload failed: ' + response.error);
      }
      console.error('Upload error:', response.error);
    }
  } catch (error) {
    if (typeof showToast === 'function') {
      showToast('Upload error: ' + error.message);
    }
    console.error('Upload error:', error);
  } finally {
    if (uploadBtn) {
      uploadBtn.disabled = false;
      uploadBtn.textContent = '⬆️ Upload to Cloud';
    }
  }
}

/**
 * Download vault from Chrome sync
 */
async function downloadFromSync() {
  const downloadBtn = document.getElementById('download-sync-btn');
  if (downloadBtn) {
    downloadBtn.disabled = true;
    downloadBtn.textContent = 'Downloading...';
  }

  try {
    const response = await sendMessage({ type: 'DOWNLOAD_FROM_SYNC' });

    if (downloadBtn) {
      downloadBtn.disabled = false;
      downloadBtn.textContent = '⬇️ Download from Cloud';
    }

    if (!response.success) {
      if (typeof showToast === 'function') {
        showToast('Download failed: ' + response.error);
      }
      console.error('Download error:', response.error);
      return;
    }

    // Check for conflicts
    if (response.needsConflictResolution) {
      showConflictModal(response);
      return;
    }

    // No conflict - show password prompt
    pendingSyncDownload = response.data;
    showPasswordModal();

  } catch (error) {
    if (typeof showToast === 'function') {
      showToast('Download error: ' + error.message);
    }
    console.error('Download error:', error);
    if (downloadBtn) {
      downloadBtn.disabled = false;
      downloadBtn.textContent = '⬇️ Download from Cloud';
    }
  }
}

/**
 * Show password modal
 */
function showPasswordModal() {
  if (typeof elements !== 'undefined' && elements.importModal) {
    elements.importError.textContent = '';
    elements.importMasterPassword.value = '';
    elements.importModal.classList.remove('hidden');
    elements.importMasterPassword.focus();
  }
}

/**
 * Show conflict modal
 */
function showConflictModal(downloadResponse) {
  pendingSyncDownload = downloadResponse.data;

  const cloudDate = downloadResponse.timestamp
    ? new Date(downloadResponse.timestamp).toLocaleString()
    : 'Unknown';

  const localDate = syncState && syncState.lastSyncTime
    ? new Date(syncState.lastSyncTime).toLocaleString()
    : 'Unknown';

  const message = document.getElementById('conflict-message');
  if (message) {
    message.innerHTML = `
      <p>Your local vault and cloud backup have different versions:</p>
      <ul style="text-align: left; margin: 16px 0; padding-left: 24px;">
        <li><strong>Local version:</strong> Last synced ${localDate}</li>
        <li><strong>Cloud version:</strong> Last synced ${cloudDate}</li>
      </ul>
      <p><strong>Choose how to resolve:</strong></p>
      <ul style="text-align: left; margin: 8px 0; padding-left: 24px; font-size: 0.9rem;">
        <li><strong>🔄 Merge Both:</strong> Combines both versions (keeps all accounts)</li>
        <li><strong>☁️ Use Cloud Only:</strong> Replaces local with cloud (loses local changes)</li>
        <li><strong>💾 Keep Local Only:</strong> Keeps local, ignores cloud</li>
      </ul>
    `;
  }

  const modal = document.getElementById('conflict-modal');
  if (modal) {
    modal.classList.remove('hidden');
  } else {
    console.error('Conflict modal element not found!');
  }
}

/**
 * Close conflict modal
 */
function closeConflictModal(clearPending = true) {
  const modal = document.getElementById('conflict-modal');
  if (modal) {
    modal.classList.add('hidden');
  }

  // Only clear pending download if requested (e.g., when canceling)
  if (clearPending) {
    pendingSyncDownload = null;
  }
}

/**
 * Merge both versions (recommended)
 */
async function mergeBothVersions() {

  if (!pendingSyncDownload) {
    if (typeof showToast === 'function') {
      showToast('No cloud data to merge');
    }
    closeConflictModal(true);
    return;
  }

  // Close modal but keep pending download
  closeConflictModal(false);

  // Ask for password to decrypt both vaults
  if (typeof showToast === 'function') {
    showToast('Enter your master password to merge accounts');
  }

  // Show password modal - but we'll handle it differently
  // Set a flag to indicate we're merging, not replacing
  window.isMergingVaults = true;
  showPasswordModal();
}

/**
 * Use cloud version (replaces local)
 */
function useCloudVersion() {
  // Don't clear pending download - we still need it for the password modal
  closeConflictModal(false);

  // Make sure we're not merging
  window.isMergingVaults = false;
  showPasswordModal();
}

/**
 * Keep local version (don't download)
 */
function keepLocalVersion() {
  // Clear pending download since we're keeping local
  closeConflictModal(true);
  if (typeof showToast === 'function') {
    showToast('Keeping local version');
  }
}

/**
 * Apply synced vault (called from options.js after password is entered)
 */
async function applySyncedVault(password) {

  if (!pendingSyncDownload) {
    console.error('No pending sync download');
    return { success: false, error: 'No pending sync download' };
  }

  const isMerging = window.isMergingVaults || false;
  const messageType = isMerging ? 'MERGE_SYNCED_VAULT' : 'APPLY_SYNCED_VAULT';


  try {
    const response = await sendMessage({
      type: messageType,
      data: pendingSyncDownload,
      password: password
    });


    if (response.success) {
      pendingSyncDownload = null;
      window.isMergingVaults = false;

      if (typeof showToast === 'function') {
        const message = isMerging
          ? `✓ Accounts merged! ${response.addedCount || 0} from cloud, ${response.keptCount || 0} from local`
          : '✓ Vault downloaded and applied!';
        showToast(message);
      }

      // Reload data
      if (typeof loadAccounts === 'function') await loadAccounts();
      if (typeof loadSettings === 'function') await loadSettings();
      await loadSyncState();
      updateSyncUI();
    } else {
      console.error('Apply/merge synced vault failed:', response.error);
    }

    return response;
  } catch (error) {
    console.error('Apply synced vault error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Check if we're currently handling a sync download
 */
function hasPendingSyncDownload() {
  return pendingSyncDownload !== null;
}

/**
 * Clear pending sync download
 */
function clearPendingSyncDownload() {
  pendingSyncDownload = null;
}

/**
 * Load auto-sync settings
 */
async function loadAutoSyncSettings() {
  const response = await sendMessage({ type: 'GET_AUTO_SYNC_SETTINGS' });
  if (response.success) {
    const settings = response.settings;

    const autoSyncEnabled = document.getElementById('auto-sync-enabled');
    const autoSyncInterval = document.getElementById('auto-sync-interval');
    const autoSyncIntervalGroup = document.getElementById('auto-sync-interval-group');

    if (autoSyncEnabled) {
      autoSyncEnabled.checked = settings.autoSyncEnabled || false;
    }

    if (autoSyncInterval) {
      autoSyncInterval.value = settings.autoSyncInterval || 30;
    }

    // Show/hide interval selector
    if (autoSyncIntervalGroup) {
      autoSyncIntervalGroup.style.display = settings.autoSyncEnabled ? 'block' : 'none';
    }
  }
}

/**
 * Save auto-sync settings
 */
async function saveAutoSyncSettings() {
  const autoSyncEnabled = document.getElementById('auto-sync-enabled');
  const autoSyncInterval = document.getElementById('auto-sync-interval');

  const settings = {
    autoSyncEnabled: autoSyncEnabled.checked,
    autoSyncInterval: parseInt(autoSyncInterval.value)
  };

  const response = await sendMessage({
    type: 'SAVE_AUTO_SYNC_SETTINGS',
    settings: settings
  });

  if (response.success) {
    if (typeof showToast === 'function') {
      const msg = settings.autoSyncEnabled
        ? `✓ Auto-sync enabled (every ${settings.autoSyncInterval} minutes)`
        : '✓ Auto-sync disabled';
      showToast(msg);
    }
  }
}

/**
 * Setup auto-sync event listeners
 */
function setupAutoSyncEventListeners() {
  const autoSyncEnabled = document.getElementById('auto-sync-enabled');
  const autoSyncInterval = document.getElementById('auto-sync-interval');
  const autoSyncIntervalGroup = document.getElementById('auto-sync-interval-group');

  if (autoSyncEnabled) {
    autoSyncEnabled.addEventListener('change', () => {
      if (autoSyncIntervalGroup) {
        autoSyncIntervalGroup.style.display = autoSyncEnabled.checked ? 'block' : 'none';
      }
      saveAutoSyncSettings();
    });
  }

  if (autoSyncInterval) {
    autoSyncInterval.addEventListener('change', saveAutoSyncSettings);
  }
}
