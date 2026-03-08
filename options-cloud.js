/**
 * Chrome Sync UI Integration - Standard Refactor
 */

let syncState = null;
let pendingSyncDownload = null;
let syncStateRefreshInterval = null;

async function initCloudSync() {
  console.log('Initializing Cloud Sync UI...');
  await loadSyncState();
  await loadAutoSyncSettings();
  setupSyncEventListeners();
  setupAutoSyncEventListeners();
  updateSyncUI();
  startSyncStateRefresh();
}

function startSyncStateRefresh() {
  if (syncStateRefreshInterval) clearInterval(syncStateRefreshInterval);
  syncStateRefreshInterval = setInterval(async () => {
    await loadSyncState();
    updateSyncUI();
  }, 30000);
}

async function loadSyncState() {
  const res = await sendMessage({ type: 'GET_SYNC_STATE' });
  if (res.success) syncState = res.state;
}

function setupSyncEventListeners() {
  document.getElementById('enable-sync-btn')?.addEventListener('click', enableChromeSync);
  document.getElementById('disable-sync-btn')?.addEventListener('click', disableChromeSync);
  document.getElementById('check-sync-data-btn')?.addEventListener('click', checkCloudData);
  document.getElementById('upload-sync-btn')?.addEventListener('click', uploadToSync);
  document.getElementById('download-sync-btn')?.addEventListener('click', downloadFromSync);
  
  document.getElementById('merge-both-btn')?.addEventListener('click', mergeBothVersions);
  document.getElementById('use-cloud-version-btn')?.addEventListener('click', useCloudVersion);
  document.getElementById('keep-local-version-btn')?.addEventListener('click', keepLocalVersion);
  document.getElementById('cancel-conflict-btn')?.addEventListener('click', () => closeConflictModal(true));
  document.getElementById('close-conflict-modal')?.addEventListener('click', () => closeConflictModal(true));
  
  const accLink = document.querySelector('#sync-account-info a');
  if (accLink) accLink.addEventListener('click', (e) => { e.preventDefault(); chrome.tabs.create({ url: 'chrome://settings/people' }); });
}

function updateSyncUI() {
  if (!syncState) return;
  const isEnabled = syncState.enabled;

  const emailSpan = document.querySelector('#sync-account-info span');
  if (emailSpan) {
    emailSpan.textContent = isEnabled ? 'Google Sync Active' : 'Chrome Sync Disabled';
  }

  const enabledStatus = document.getElementById('sync-enabled-status');
  if (enabledStatus) {
    enabledStatus.textContent = isEnabled ? '✓ Enabled' : '✗ Disabled';
    enabledStatus.className = 'sync-status-value ' + (isEnabled ? 'enabled' : 'disabled');
  }

  const storageUsed = document.getElementById('sync-storage-used');
  if (storageUsed) {
    storageUsed.textContent = isEnabled ? `${(syncState.bytesUsed / 1024).toFixed(1)} KB (${syncState.percentUsed || 0}%)` : '--';
  }

  const lastTime = document.getElementById('sync-last-time');
  if (lastTime) {
    lastTime.textContent = (isEnabled && syncState.lastSyncTime) ? new Date(syncState.lastSyncTime).toLocaleString() : 'Never';
  }

  document.getElementById('enable-sync-btn')?.classList.toggle('hidden', isEnabled);
  document.getElementById('disable-sync-btn')?.classList.toggle('hidden', !isEnabled);
  
  const autoSyncCard = document.getElementById('auto-sync-settings-card');
  if (autoSyncCard) autoSyncCard.style.display = isEnabled ? 'block' : 'none';
  
  const actionsCard = document.getElementById('sync-actions-card');
  if (actionsCard) actionsCard.style.display = isEnabled ? 'block' : 'none';
}

async function enableChromeSync() {
  const res = await sendMessage({ type: 'ENABLE_SYNC' });
  if (res.success) { 
    if (typeof showToast === 'function') showToast('✓ Chrome Sync enabled!'); 
    await loadSyncState(); 
    updateSyncUI(); 
  }
}

async function disableChromeSync() {
  if (!confirm('Disable Chrome Sync? Local data is safe.')) return;
  const res = await sendMessage({ type: 'DISABLE_SYNC' });
  if (res.success) { 
    if (typeof showToast === 'function') showToast('✓ Chrome Sync disabled'); 
    await loadSyncState(); 
    updateSyncUI(); 
  }
}

async function uploadToSync() {
  const btn = document.getElementById('upload-sync-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Uploading...'; }
  try {
    const res = await sendMessage({ type: 'UPLOAD_TO_SYNC' });
    if (res.success) {
      if (typeof showToast === 'function') showToast(`✓ Vault uploaded! (${res.accountCount} accounts)`);
      await loadSyncState();
      updateSyncUI();
    } else {
      if (typeof showToast === 'function') showToast('Upload failed: ' + res.error);
    }
  } finally { if (btn) { btn.disabled = false; btn.textContent = '⬆️ Upload to Cloud'; } }
}

async function downloadFromSync() {
  const btn = document.getElementById('download-sync-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Downloading...'; }
  try {
    const res = await sendMessage({ type: 'DOWNLOAD_FROM_SYNC' });
    if (res.success) {
      pendingSyncDownload = res.data;
      showPasswordModal();
    } else {
      if (typeof showToast === 'function') showToast('Download failed: ' + res.error);
    }
  } finally { if (btn) { btn.disabled = false; btn.textContent = '⬇️ Download from Cloud'; } }
}

async function checkCloudData() {
  const debugText = document.getElementById('sync-debug-text');
  document.getElementById('sync-debug-info')?.classList.remove('hidden');
  if (debugText) debugText.textContent = 'Scanning...';
  const res = await sendMessage({ type: 'CHECK_SYNC_DATA' });
  if (res.success && res.data) {
    const info = res.data;
    debugText.textContent = `Manifest: ${info.hasManifest ? '✅ YES' : '❌ NO'}\nAccounts: ${info.accountCount}\nSize: ${(info.totalSize/1024).toFixed(2)} KB`;
  }
}

/** Auto-Sync Logic */
async function loadAutoSyncSettings() {
  const res = await sendMessage({ type: 'GET_AUTO_SYNC_SETTINGS' });
  console.log('Loaded Auto-Sync Settings:', res);
  if (res.success && res.settings) {
    const s = res.settings;
    const enabledEl = document.getElementById('auto-sync-enabled');
    const intervalEl = document.getElementById('auto-sync-interval');
    const groupEl = document.getElementById('auto-sync-interval-group');

    if (enabledEl) enabledEl.checked = !!s.autoSyncEnabled;
    if (intervalEl) intervalEl.value = s.autoSyncInterval || 30;
    if (groupEl) groupEl.style.display = s.autoSyncEnabled ? 'block' : 'none';
  }
}

async function saveAutoSyncSettings(notify = true) {
  const enabledEl = document.getElementById('auto-sync-enabled');
  const intervalEl = document.getElementById('auto-sync-interval');
  if (!enabledEl || !intervalEl) return;

  const s = {
    autoSyncEnabled: enabledEl.checked,
    autoSyncInterval: parseInt(intervalEl.value)
  };

  console.log('Saving Auto-Sync Settings:', s);
  const res = await sendMessage({ type: 'SAVE_AUTO_SYNC_SETTINGS', settings: s });
  
  if (res.success && notify) {
    const msg = s.autoSyncEnabled ? `✓ Auto-sync enabled (${s.autoSyncInterval}m)` : '✓ Auto-sync disabled';
    if (typeof showToast === 'function') showToast(msg);
  }
}

function setupAutoSyncEventListeners() {
  const enabledEl = document.getElementById('auto-sync-enabled');
  const intervalEl = document.getElementById('auto-sync-interval');
  const groupEl = document.getElementById('auto-sync-interval-group');

  if (enabledEl) {
    enabledEl.addEventListener('change', async () => {
      console.log('Auto-sync toggle changed');
      if (groupEl) groupEl.style.display = enabledEl.checked ? 'block' : 'none';
      await saveAutoSyncSettings(true);
    });
  }

  if (intervalEl) {
    intervalEl.addEventListener('change', async () => {
      console.log('Auto-sync interval changed');
      await saveAutoSyncSettings(true);
    });
  }
}

/** Modals */
function showPasswordModal() {
  if (typeof elements !== 'undefined' && elements.importModal) {
    elements.importError.textContent = '';
    elements.importMasterPassword.value = '';
    elements.importModal.classList.remove('hidden');
    elements.importMasterPassword.focus();
  }
}

function closeConflictModal(c = true) { document.getElementById('conflict-modal')?.classList.add('hidden'); if (c) pendingSyncDownload = null; }
function mergeBothVersions() { closeConflictModal(false); window.isMergingVaults = true; showPasswordModal(); }
function useCloudVersion() { closeConflictModal(false); window.isMergingVaults = false; showPasswordModal(); }
function keepLocalVersion() { closeConflictModal(true); }

async function applySyncedVault(password) {
  if (!pendingSyncDownload) return { success: false, error: 'No data' };
  const type = window.isMergingVaults ? 'MERGE_SYNCED_VAULT' : 'APPLY_SYNCED_VAULT';
  const res = await sendMessage({ type, data: pendingSyncDownload, password });
  if (res.success) {
    pendingSyncDownload = null;
    window.isMergingVaults = false;
    if (typeof showToast === 'function') showToast('✓ Vault restored from cloud!');
    setTimeout(() => location.reload(), 1000);
  }
  return res;
}

function hasPendingSyncDownload() { return pendingSyncDownload !== null; }
