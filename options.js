/**
 * Options Page Script for 2FA Manager Extension
 * Cleaned: Removed Accounts Management (handled in popup)
 */

// State
let currentPassword = '';
let settings = {};
let pendingImportFile = null; 
let vaultUnlocked = false;

// DOM Elements
const elements = {
  // Password Modal
  passwordModal: document.getElementById('password-modal'),
  passwordForm: document.getElementById('password-form'),
  masterPasswordInput: document.getElementById('options-master-password'),
  passwordError: document.getElementById('options-unlock-error'),

  // Navigation
  navItems: document.querySelectorAll('.nav-item'),
  sections: document.querySelectorAll('.section'),
  lockVaultBtn: document.getElementById('lock-vault-btn'),

  // Security
  changePasswordForm: document.getElementById('change-password-form'),
  currentPassword: document.getElementById('current-password'),
  newPassword: document.getElementById('new-password'),
  confirmPassword: document.getElementById('confirm-password'),
  securityPasswordError: document.getElementById('options-security-error'),
  exportBtn: document.getElementById('export-btn'),
  importBtn: document.getElementById('import-btn'),
  importFile: document.getElementById('import-file'),
  backupStatus: document.getElementById('backup-status'),
  deleteAllBtn: document.getElementById('delete-all-btn'),

  // Settings
  autoLock: document.getElementById('auto-lock'),
  lockTimeout: document.getElementById('lock-timeout'),
  clipboardTimeout: document.getElementById('clipboard-timeout'),
  showNotifications: document.getElementById('show-notifications'),
  defaultDigits: document.getElementById('default-digits'),
  defaultPeriod: document.getElementById('default-period'),

  // Import Modal
  importModal: document.getElementById('import-modal'),
  importPasswordForm: document.getElementById('import-password-form'),
  importMasterPassword: document.getElementById('import-master-password'),
  importError: document.getElementById('import-error'),
  cancelImport: document.querySelector('.cancel-import'),

  // Delete Modal
  deleteModal: document.getElementById('delete-modal'),
  deleteConfirmForm: document.getElementById('delete-confirm-form'),
  deleteConfirmText: document.getElementById('delete-confirm-text'),
  deleteError: document.getElementById('delete-error'),
  cancelDelete: document.querySelector('.cancel-delete'),

  // Toast
  toast: document.getElementById('toast'),
  toastMessage: document.getElementById('toast-message')
};

/**
 * Initialize options page
 */
async function init() {
  setupEventListeners();

  // Check background status
  const statusResponse = await sendMessage({ type: 'GET_STATUS' });

  if (statusResponse.unlocked) {
    vaultUnlocked = true;
    const sessionData = await chrome.storage.session.get('masterPassword');
    if (sessionData.masterPassword) {
      currentPassword = sessionData.masterPassword;
    }

    elements.passwordModal.classList.add('hidden');
    await loadSettings();
    if (typeof initCloudSync === 'function') await initCloudSync();
  } else {
    window.location.href = 'popup.html';
  }
}

/**
 * Unlock vault
 */
async function unlockVault(password) {
  const response = await sendMessage({ type: 'UNLOCK_VAULT', password });

  if (response.success) {
    currentPassword = password;
    vaultUnlocked = true;
    await chrome.storage.session.set({ masterPassword: password });
    elements.passwordModal.classList.add('hidden');
    await loadSettings();
    if (typeof initCloudSync === 'function') await initCloudSync();
  } else {
    elements.passwordError.textContent = response.error || 'Invalid password';
  }
}

/**
 * Load settings
 */
async function loadSettings() {
  const response = await sendMessage({ type: 'GET_SETTINGS' });
  if (response.success) {
    settings = response.settings;
    elements.autoLock.checked = settings.autoLock;
    elements.lockTimeout.value = settings.lockTimeout;
    elements.clipboardTimeout.value = settings.clipboardTimeout;
    elements.showNotifications.checked = settings.showNotifications;
    elements.defaultDigits.value = settings.defaultDigits;
    elements.defaultPeriod.value = settings.defaultPeriod;
  }
}

/**
 * Save settings
 */
async function saveSettings() {
  const newSettings = {
    autoLock: elements.autoLock.checked,
    lockTimeout: parseInt(elements.lockTimeout.value),
    clipboardTimeout: parseInt(elements.clipboardTimeout.value),
    showNotifications: elements.showNotifications.checked,
    defaultDigits: parseInt(elements.defaultDigits.value),
    defaultPeriod: parseInt(elements.defaultPeriod.value)
  };

  const response = await sendMessage({
    type: 'UPDATE_SETTINGS',
    settings: newSettings
  });

  if (response.success) {
    settings = newSettings;
    showToast('Settings saved!');
  }
}

/**
 * Change master password
 */
async function changePassword(e) {
  e.preventDefault();
  const current = elements.currentPassword.value;
  const newPass = elements.newPassword.value;
  const confirm = elements.confirmPassword.value;

  if (newPass.length < 8) {
    elements.securityPasswordError.textContent = 'Password must be at least 8 characters';
    return;
  }
  if (newPass !== confirm) {
    elements.securityPasswordError.textContent = 'Passwords do not match';
    return;
  }

  const unlockResponse = await sendMessage({ type: 'UNLOCK_VAULT', password: current });
  if (!unlockResponse.success) {
    elements.securityPasswordError.textContent = 'Current password is incorrect';
    return;
  }

  const response = await sendMessage({
    type: 'CHANGE_PASSWORD',
    oldPassword: current,
    newPassword: newPass
  });

  if (response.success) {
    currentPassword = newPass;
    elements.changePasswordForm.reset();
    elements.securityPasswordError.textContent = '';
    showToast('Password changed successfully!');
  } else {
    elements.securityPasswordError.textContent = response.error || 'Failed to change password';
  }
}

/**
 * Backup & Restore
 */
async function exportAccounts() {
  try {
    const response = await sendMessage({ type: 'EXPORT_VAULT' });
    if (response.success && response.data) {
      const blob = new Blob([JSON.stringify(response.data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `2fa-vault-backup-${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
      elements.backupStatus.innerHTML = `<div style="color:var(--primary); margin-top:8px;">✓ Exported on ${new Date().toLocaleString()}</div>`;
      showToast('Vault exported!');
    }
  } catch (error) { showToast('Export failed'); }
}

async function importAccounts(file) {
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    if (!data.accounts) { showToast('Invalid format'); return; }
    pendingImportFile = data;
    elements.importError.textContent = '';
    elements.importMasterPassword.value = '';
    elements.importModal.classList.remove('hidden');
    elements.importMasterPassword.focus();
  } catch (error) { showToast('Import failed'); }
}

async function processImport(password) {
  if (!pendingImportFile) return;
  const response = await sendMessage({ type: 'IMPORT_VAULT', data: pendingImportFile, password });
  if (response.success) {
    pendingImportFile = null;
    elements.importModal.classList.add('hidden');
    showToast('Vault imported!');
  } else {
    elements.importError.textContent = response.error || 'Import failed';
  }
}

/**
 * Event Listeners
 */
function setupEventListeners() {
  elements.passwordForm.addEventListener('submit', (e) => { e.preventDefault(); unlockVault(elements.masterPasswordInput.value); });
  
  elements.navItems.forEach(item => {
    item.addEventListener('click', () => {
      elements.navItems.forEach(i => i.classList.remove('active'));
      elements.sections.forEach(s => s.classList.remove('active'));
      item.classList.add('active');
      document.getElementById(`${item.dataset.section}-section`).classList.add('active');
    });
  });

  elements.lockVaultBtn.addEventListener('click', async () => { await sendMessage({ type: 'LOCK_VAULT' }); window.location.href = 'popup.html'; });
  elements.changePasswordForm.addEventListener('submit', changePassword);
  elements.exportBtn.addEventListener('click', exportAccounts);
  elements.importBtn.addEventListener('click', () => elements.importFile.click());
  elements.importFile.addEventListener('change', (e) => { if (e.target.files.length > 0) importAccounts(e.target.files[0]); });
  
  elements.deleteAllBtn.addEventListener('click', () => { 
    elements.deleteError.textContent = ''; 
    elements.deleteConfirmText.value = ''; 
    elements.deleteModal.classList.remove('hidden'); 
  });

  elements.deleteConfirmForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (elements.deleteConfirmText.value === 'DELETE') {
      await sendMessage({ type: 'RESET_VAULT' });
      window.location.href = 'popup.html';
    } else elements.deleteError.textContent = 'Type DELETE to confirm';
  });

  [elements.autoLock, elements.lockTimeout, elements.clipboardTimeout, elements.showNotifications, elements.defaultDigits, elements.defaultPeriod].forEach(el => el.addEventListener('change', saveSettings));

  elements.importPasswordForm.addEventListener('submit', (e) => { e.preventDefault(); processImport(elements.importMasterPassword.value); });
  elements.cancelImport.addEventListener('click', () => elements.importModal.classList.add('hidden'));
  elements.cancelDelete.addEventListener('click', () => elements.deleteModal.classList.add('hidden'));
}

function sendMessage(m) { return new Promise(r => chrome.runtime.sendMessage(m, r)); }
function showToast(m) { elements.toastMessage.textContent = m; elements.toast.classList.remove('hidden'); setTimeout(() => elements.toast.classList.add('hidden'), 2000); }

document.addEventListener('DOMContentLoaded', init);
