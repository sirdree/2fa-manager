/**
 * Cloud Sync Setup Page - UI Logic
 * Handles Client ID configuration, OAuth flow, and sync operations
 */

// State
let currentConfig = null;
let syncState = null;
let pendingDownload = null;

// Utility function to send messages to background
async function sendMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      resolve(response || {});
    });
  });
}

// Show toast notification
function showToast(message) {
  const toast = document.getElementById('toast');
  const toastMessage = document.getElementById('toast-message');
  toastMessage.textContent = message;
  toast.classList.remove('hidden');
  setTimeout(() => toast.classList.add('hidden'), 3000);
}

// Initialize page
async function init() {
  await loadConfig();
  await loadSyncState();
  setupEventListeners();
  updateUI();
}

// Load cloud configuration
async function loadConfig() {
  currentConfig = await getCloudConfig();

  const clientIdInput = document.getElementById('client-id-input');
  if (currentConfig && currentConfig.clientId) {
    clientIdInput.value = currentConfig.clientId;
  }
}

// Load sync state
async function loadSyncState() {
  syncState = await getCloudSyncState();
}

// Update UI based on state
function updateUI() {
  const hasClientId = currentConfig && currentConfig.clientId;
  const isConnected = syncState && syncState.connected;

  // Enable/disable connect button based on client ID
  const connectBtn = document.getElementById('connect-btn');
  connectBtn.disabled = !hasClientId;

  // Show connection status
  const statusIndicator = document.getElementById('status-indicator');
  const statusText = document.getElementById('status-text');
  const statusEmail = document.getElementById('status-email');
  const disconnectBtn = document.getElementById('disconnect-btn');

  if (isConnected) {
    statusIndicator.classList.add('connected');
    statusText.textContent = 'Connected';
    statusEmail.textContent = syncState.userEmail || '';
    connectBtn.classList.add('hidden');
    disconnectBtn.classList.remove('hidden');
  } else {
    statusIndicator.classList.remove('connected');
    statusText.textContent = 'Not Connected';
    statusEmail.textContent = '';
    connectBtn.classList.remove('hidden');
    disconnectBtn.classList.add('hidden');
  }

  // Enable/disable sync buttons
  const uploadBtn = document.getElementById('upload-btn');
  const downloadBtn = document.getElementById('download-btn');
  uploadBtn.disabled = !isConnected;
  downloadBtn.disabled = !isConnected;

  // Update timestamps
  updateTimestamps();

  // Update redirect URI in guide
  updateRedirectURI();
}

// Update timestamps display
function updateTimestamps() {
  const uploadTimestamp = document.getElementById('upload-timestamp');
  const downloadTimestamp = document.getElementById('download-timestamp');

  if (syncState && syncState.lastUploadTime) {
    const date = new Date(syncState.lastUploadTime);
    uploadTimestamp.textContent = 'Last uploaded: ' + date.toLocaleString();
  } else {
    uploadTimestamp.textContent = 'Never uploaded';
  }

  if (syncState && syncState.lastDownloadTime) {
    const date = new Date(syncState.lastDownloadTime);
    downloadTimestamp.textContent = 'Last downloaded: ' + date.toLocaleString();
  } else {
    downloadTimestamp.textContent = 'Never downloaded';
  }
}

// Update redirect URI in setup guide
function updateRedirectURI() {
  const redirectUriEl = document.getElementById('redirect-uri');
  const extensionId = getExtensionId();
  redirectUriEl.textContent = 'https://' + extensionId + '.chromiumapp.org/';
}

// Setup event listeners
function setupEventListeners() {
  // Client ID management
  document.getElementById('save-client-id-btn').addEventListener('click', saveClientId);
  document.getElementById('clear-client-id-btn').addEventListener('click', clearClientId);

  // Setup guide
  document.getElementById('show-setup-guide').addEventListener('click', showSetupGuide);
  document.getElementById('close-setup-guide').addEventListener('click', closeSetupGuide);
  document.getElementById('copy-redirect-uri').addEventListener('click', copyRedirectURI);

  // Connection
  document.getElementById('connect-btn').addEventListener('click', connectGoogle);
  document.getElementById('disconnect-btn').addEventListener('click', disconnectGoogle);

  // Sync actions
  document.getElementById('upload-btn').addEventListener('click', uploadVault);
  document.getElementById('download-btn').addEventListener('click', downloadVault);

  // Password modal
  document.getElementById('close-password-modal').addEventListener('click', closePasswordModal);
  document.getElementById('cancel-password').addEventListener('click', closePasswordModal);
  document.getElementById('password-form').addEventListener('submit', handlePasswordSubmit);

  // Conflict modal
  document.getElementById('close-conflict-modal').addEventListener('click', closeConflictModal);
  document.getElementById('use-cloud-btn').addEventListener('click', useCloudVersion);
  document.getElementById('keep-local-btn').addEventListener('click', keepLocalVersion);

  // Close modals on outside click
  document.getElementById('setup-guide-modal').addEventListener('click', (e) => {
    if (e.target.id === 'setup-guide-modal') closeSetupGuide();
  });

  document.getElementById('password-modal').addEventListener('click', (e) => {
    if (e.target.id === 'password-modal') closePasswordModal();
  });

  document.getElementById('conflict-modal').addEventListener('click', (e) => {
    if (e.target.id === 'conflict-modal') closeConflictModal();
  });
}

// Save Client ID
async function saveClientId() {
  const clientIdInput = document.getElementById('client-id-input');
  const clientId = clientIdInput.value.trim();

  if (!clientId) {
    showToast('Please enter a Client ID');
    return;
  }

  // Validate format
  if (!clientId.includes('.apps.googleusercontent.com')) {
    showToast('Invalid Client ID format. Should end with .apps.googleusercontent.com');
    return;
  }

  await saveCloudConfig({ clientId });
  await loadConfig();
  updateUI();

  showToast('✓ Client ID saved! You can now connect your Google account.');
}

// Clear Client ID
async function clearClientId() {
  if (!confirm('Clear saved Client ID? You will need to re-enter it to connect.')) {
    return;
  }

  document.getElementById('client-id-input').value = '';
  await saveCloudConfig({ clientId: null });
  await loadConfig();
  await disconnectGoogle(); // Also disconnect if connected
  updateUI();

  showToast('Client ID cleared');
}

// Show setup guide modal
function showSetupGuide() {
  document.getElementById('setup-guide-modal').classList.remove('hidden');
}

// Close setup guide modal
function closeSetupGuide() {
  document.getElementById('setup-guide-modal').classList.add('hidden');
}

// Copy redirect URI
function copyRedirectURI() {
  const redirectUri = document.getElementById('redirect-uri').textContent;
  navigator.clipboard.writeText(redirectUri);
  showToast('✓ Redirect URI copied to clipboard');
}

// Connect Google account
async function connectGoogle() {
  const connectBtn = document.getElementById('connect-btn');
  connectBtn.disabled = true;
  connectBtn.textContent = 'Connecting...';

  try {
    const response = await sendMessage({ type: 'CONNECT_GOOGLE' });

    if (response.success) {
      showToast('✓ Connected to Google Drive!');
      await loadSyncState();
      updateUI();
    } else {
      showToast('Connection failed: ' + response.error);
      console.error('Connection error:', response.error);
    }
  } catch (error) {
    showToast('Connection error: ' + error.message);
    console.error('Connection error:', error);
  } finally {
    connectBtn.disabled = false;
    connectBtn.textContent = 'Connect Google Account';
  }
}

// Disconnect Google account
async function disconnectGoogle() {
  if (!confirm('Disconnect from Google Drive? Your local vault will not be affected.')) {
    return;
  }

  try {
    const response = await sendMessage({ type: 'DISCONNECT_GOOGLE' });

    if (response.success) {
      showToast('✓ Disconnected from Google Drive');
      await loadSyncState();
      updateUI();
    } else {
      showToast('Disconnect failed: ' + response.error);
    }
  } catch (error) {
    showToast('Disconnect error: ' + error.message);
    console.error('Disconnect error:', error);
  }
}

// Upload vault
async function uploadVault() {
  const uploadBtn = document.getElementById('upload-btn');
  uploadBtn.disabled = true;
  uploadBtn.textContent = 'Uploading...';

  try {
    const response = await sendMessage({ type: 'UPLOAD_TO_DRIVE' });

    if (response.success) {
      showToast('✓ Vault uploaded to Google Drive!');
      await loadSyncState();
      updateUI();
    } else {
      showToast('Upload failed: ' + response.error);
      console.error('Upload error:', response.error);
    }
  } catch (error) {
    showToast('Upload error: ' + error.message);
    console.error('Upload error:', error);
  } finally {
    uploadBtn.disabled = false;
    uploadBtn.textContent = '⬆️ Upload Vault';
  }
}

// Download vault
async function downloadVault() {
  const downloadBtn = document.getElementById('download-btn');
  downloadBtn.disabled = true;
  downloadBtn.textContent = 'Downloading...';

  try {
    const response = await sendMessage({ type: 'DOWNLOAD_FROM_DRIVE' });

    downloadBtn.disabled = false;
    downloadBtn.textContent = '⬇️ Download Vault';

    if (!response.success) {
      showToast('Download failed: ' + response.error);
      console.error('Download error:', response.error);
      return;
    }

    // Check for conflicts
    if (response.needsConflictResolution) {
      showConflictModal(response);
      return;
    }

    // No conflict - show password prompt
    pendingDownload = response.data;
    showPasswordModal();

  } catch (error) {
    showToast('Download error: ' + error.message);
    console.error('Download error:', error);
    downloadBtn.disabled = false;
    downloadBtn.textContent = '⬇️ Download Vault';
  }
}

// Show password modal
function showPasswordModal() {
  const modal = document.getElementById('password-modal');
  const input = document.getElementById('master-password-input');
  const error = document.getElementById('password-error');

  input.value = '';
  error.textContent = '';
  modal.classList.remove('hidden');
  input.focus();
}

// Close password modal
function closePasswordModal() {
  document.getElementById('password-modal').classList.add('hidden');
  pendingDownload = null;
}

// Handle password submit
async function handlePasswordSubmit(e) {
  e.preventDefault();

  const password = document.getElementById('master-password-input').value;
  const error = document.getElementById('password-error');

  if (!pendingDownload) {
    error.textContent = 'No pending download';
    return;
  }

  try {
    const response = await sendMessage({
      type: 'APPLY_CLOUD_VAULT',
      data: pendingDownload,
      password: password
    });

    if (response.success) {
      closePasswordModal();
      showToast('✓ Vault downloaded and applied!');
      await loadSyncState();
      updateUI();
    } else {
      error.textContent = response.error || 'Failed to apply vault';
    }
  } catch (error) {
    error.textContent = error.message;
  }
}

// Show conflict modal
function showConflictModal(downloadResponse) {
  pendingDownload = downloadResponse.data;

  const cloudDate = new Date(downloadResponse.timestamp).toLocaleString();
  const localDate = syncState.lastUploadTime
    ? new Date(syncState.lastUploadTime).toLocaleString()
    : 'Unknown';

  const message = document.getElementById('conflict-message');
  message.innerHTML = `
    <p>Your local vault and cloud backup have different versions:</p>
    <ul style="text-align: left; margin: 16px 0; padding-left: 24px;">
      <li><strong>Local version:</strong> Last uploaded ${localDate}</li>
      <li><strong>Cloud version:</strong> Last modified ${cloudDate}</li>
    </ul>
    <p>Which version would you like to keep?</p>
  `;

  document.getElementById('conflict-modal').classList.remove('hidden');
}

// Close conflict modal
function closeConflictModal() {
  document.getElementById('conflict-modal').classList.add('hidden');
  pendingDownload = null;
}

// Use cloud version
function useCloudVersion() {
  closeConflictModal();
  showPasswordModal();
}

// Keep local version
function keepLocalVersion() {
  closeConflictModal();
  showToast('Keeping local version');
}

// Initialize when page loads
document.addEventListener('DOMContentLoaded', init);
