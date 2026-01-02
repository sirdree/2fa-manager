/**
 * Options Page Script for 2FA Manager Extension
 */

// State
let currentPassword = '';
let accounts = [];
let settings = {};
let pendingImportFile = null; // File being imported
let vaultUnlocked = false; // Track if vault is unlocked
let pendingDeleteAccountId = null; // Account being deleted

// DOM Elements
const elements = {
  // Password Modal
  passwordModal: document.getElementById('password-modal'),
  passwordForm: document.getElementById('password-form'),
  masterPasswordInput: document.getElementById('options-master-password'),
  passwordError: document.getElementById('password-error'),

  // Navigation
  navItems: document.querySelectorAll('.nav-item'),
  sections: document.querySelectorAll('.section'),
  lockVaultBtn: document.getElementById('lock-vault-btn'),

  // Accounts
  accountsList: document.getElementById('accounts-list'),
  noAccounts: document.getElementById('no-accounts'),
  searchAccounts: document.getElementById('search-accounts'),
  addAccountBtn: document.getElementById('add-account-btn'),

  // Security
  changePasswordForm: document.getElementById('change-password-form'),
  currentPassword: document.getElementById('current-password'),
  newPassword: document.getElementById('new-password'),
  confirmPassword: document.getElementById('confirm-password'),
  passwordError: document.getElementById('password-error'),
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

  // Edit Modal
  editModal: document.getElementById('edit-modal'),
  closeModal: document.querySelector('.close-modal'),
  editAccountForm: document.getElementById('edit-account-form'),
  editAccountId: document.getElementById('edit-account-id'),
  editIssuer: document.getElementById('edit-issuer'),
  editName: document.getElementById('edit-name'),
  editUsername: document.getElementById('edit-username'),
  editPassword: document.getElementById('edit-password'),
  togglePassword: document.querySelector('.toggle-password'),
  editSecret: document.getElementById('edit-secret'),
  editToggleSecret: document.getElementById('edit-toggle-secret'),
  cancelEdit: document.querySelector('.cancel-edit'),
  formError: document.getElementById('edit-form-error'),

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

  // Delete Account Modal
  deleteAccountModal: document.getElementById('delete-account-modal'),
  deleteAccountName: document.getElementById('delete-account-name'),
  confirmDeleteAccount: document.getElementById('confirm-delete-account'),
  cancelDeleteAccount: document.querySelector('.cancel-delete-account'),

  // Toast
  toast: document.getElementById('toast'),
  toastMessage: document.getElementById('toast-message')
};

/**
 * Initialize options page
 */
async function init() {
  // Setup event listeners first
  setupEventListeners();

  // Check if we have password in session storage (auto-unlock)
  const sessionData = await chrome.storage.session.get('masterPassword');
  const storedPassword = sessionData.masterPassword;

  if (storedPassword) {
    // Auto-unlock with stored password
    await unlockVault(storedPassword);
  } else {
    // Check if vault is unlocked in background
    const statusResponse = await sendMessage({ type: 'GET_STATUS' });

    if (!statusResponse.unlocked) {
      // Redirect to popup
      window.location.href = 'popup.html';
      return;
    }

    // Show password modal and wait for unlock
    elements.passwordModal.classList.remove('hidden');
    elements.masterPasswordInput.focus();
  }
}

/**
 * Unlock vault with password
 */
async function unlockVault(password) {
  const response = await sendMessage({
    type: 'UNLOCK_VAULT',
    password: password
  });

  if (response.success) {
    currentPassword = password;
    vaultUnlocked = true;

    // Store password in session for auto-unlock on page refresh
    await chrome.storage.session.set({ masterPassword: password });

    // Hide password modal
    elements.passwordModal.classList.add('hidden');
    elements.passwordError.textContent = '';

    // Load data
    await Promise.all([
      loadAccounts(),
      loadSettings()
    ]);

    // Initialize cloud sync if available
    if (typeof initCloudSync === 'function') {
      await initCloudSync();
    }
  } else {
    elements.passwordError.textContent = response.error || 'Invalid password';
  }
}

/**
 * Load accounts
 */
async function loadAccounts() {
  const response = await sendMessage({ type: 'GET_ACCOUNTS' });

  if (response.success) {
    accounts = response.accounts || [];
    renderAccounts();
  }
}

/**
 * Render accounts list
 */
function renderAccounts(filter = '') {
  const filtered = filter
    ? accounts.filter(a =>
      a.issuer.toLowerCase().includes(filter.toLowerCase()) ||
      a.accountName.toLowerCase().includes(filter.toLowerCase())
    )
    : accounts;

  // Force DOM refresh by clearing and re-adding
  elements.accountsList.innerHTML = '';

  if (filtered.length === 0) {
    elements.accountsList.classList.add('hidden');
    elements.noAccounts.classList.remove('hidden');
    return;
  }

  elements.accountsList.classList.remove('hidden');
  elements.noAccounts.classList.add('hidden');

  // Create document fragment for better performance
  const fragment = document.createDocumentFragment();

  filtered.forEach(account => {
    const card = document.createElement('div');
    card.className = 'account-card';
    card.dataset.accountId = account.id;

    card.innerHTML = `
      <div class="account-icon" style="background: ${account.iconColor || '#4CAF50'}">
        ${(account.issuer || account.accountName || '🔐').charAt(0).toUpperCase()}
      </div>
      <div class="account-info">
        <div class="account-issuer">${escapeHtml(account.issuer || 'Unknown')}</div>
        <div class="account-name">${escapeHtml(account.accountName)}</div>
        ${account.username || account.password ? `
          <div class="account_credentials">
            ${account.username ? `<span>👤 ${escapeHtml(account.username)}</span>` : ''}
            ${account.password ? `<span>🔑 Password saved</span>` : ''}
          </div>
        ` : ''}
      </div>
      <div class="account-actions">
        <button class="icon-btn edit-btn" data-account-id="${account.id}" title="Edit">✏️</button>
        <button class="icon-btn delete-btn" data-account-id="${account.id}" title="Delete">🗑️</button>
      </div>
    `;

    fragment.appendChild(card);
  });

  // Clear and append (forces browser to re-render)
  elements.accountsList.appendChild(fragment);

  // Add event listeners
  attachAccountListeners();
}

/**
 * Attach event listeners to account cards
 */
function attachAccountListeners() {
  document.querySelectorAll('.edit-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openEditModal(btn.dataset.accountId);
    });
  });

  document.querySelectorAll('.delete-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const accountId = btn.dataset.accountId;
      const account = accounts.find(a => a.id === accountId);
      showDeleteAccountModal(account);
    });
  });
}

/**
 * Open edit modal
 */
function openEditModal(accountId) {
  const account = accounts.find(a => a.id === accountId);
  if (!account) return;

  elements.editAccountId.value = account.id;
  elements.editIssuer.value = account.issuer || '';
  elements.editName.value = account.accountName || '';
  elements.editUsername.value = account.username || '';
  elements.editPassword.value = account.password || '';

  // Handle 2FA secret - show asterisks if secret exists
  if (account.secret) {
    elements.editSecret.type = 'password';
    elements.editSecret.value = '••••••••••••••••••••••••';
    elements.editSecret.dataset.originalSecret = account.secret;
    elements.editToggleSecret.textContent = '👁️';
  } else {
    elements.editSecret.value = '';
    elements.editSecret.dataset.originalSecret = '';
    elements.editToggleSecret.textContent = '👁️';
  }

  elements.formError.textContent = '';

  elements.editModal.classList.remove('hidden');
}

/**
 * Close edit modal
 */
function closeEditModal() {
  elements.editModal.classList.add('hidden');
  elements.editAccountForm.reset();
  elements.formError.textContent = '';
}

/**
 * Save account edit
 */
async function saveAccountEdit(e) {
  e.preventDefault();

  // Handle 2FA secret
  let secret = elements.editSecret.value.trim();
  const originalSecret = elements.editSecret.dataset.originalSecret || '';

  // If secret is asterisks or empty, preserve original
  if (secret === '••••••••••••••••••••••••' || secret === '') {
    secret = originalSecret;
  } else {
    // New secret entered, validate it
    secret = secret.toUpperCase().replace(/\s/g, '');
    if (secret && !/^[A-Z2-7]+$/.test(secret)) {
      elements.formError.textContent = 'Invalid secret key format (must be Base32)';
      return;
    }
  }

  const updates = {
    issuer: elements.editIssuer.value.trim(),
    accountName: elements.editName.value.trim(),
    username: elements.editUsername.value.trim(),
    password: elements.editPassword.value,
    secret: secret
  };

  const response = await sendMessage({
    type: 'UPDATE_ACCOUNT',
    id: elements.editAccountId.value,
    updates,
    password: currentPassword
  });

  if (response.success) {
    closeEditModal();
    await loadAccounts();
    showToast('Account updated!');
  } else {
    elements.formError.textContent = response.error || 'Failed to update account';
  }
}

/**
 * Delete account
 */
async function deleteAccount(accountId) {
  const response = await sendMessage({
    type: 'DELETE_ACCOUNT',
    id: accountId,
    password: currentPassword
  });

  if (response.success) {
    await loadAccounts();
    showToast('Account deleted!');
  } else {
    showToast(response.error || 'Failed to delete account');
  }
}

/**
 * Show delete account confirmation modal
 */
function showDeleteAccountModal(account) {
  if (!account) return;
  pendingDeleteAccountId = account.id;

  elements.deleteAccountName.textContent =
    `${account.issuer || 'Unknown'} (${account.accountName || 'No name'})`;

  elements.deleteAccountModal.classList.remove('hidden');
}

/**
 * Confirm delete account
 */
async function confirmDeleteAccount() {
  if (!pendingDeleteAccountId) return;

  const response = await sendMessage({
    type: 'DELETE_ACCOUNT',
    id: pendingDeleteAccountId,
    password: currentPassword
  });

  elements.deleteAccountModal.classList.add('hidden');
  pendingDeleteAccountId = null;

  if (response.success) {
    await loadAccounts();
    showToast('Account deleted!');
  } else {
    showToast(response.error || 'Failed to delete account');
  }
}

/**
 * Load settings
 */
async function loadSettings() {
  const response = await sendMessage({ type: 'GET_SETTINGS' });

  if (response.success) {
    settings = response.settings;

    // Apply settings to form
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

  // Validate
  if (newPass.length < 8) {
    elements.passwordError.textContent = 'Password must be at least 8 characters';
    return;
  }

  if (newPass !== confirm) {
    elements.passwordError.textContent = 'Passwords do not match';
    return;
  }

  // Verify current password
  const unlockResponse = await sendMessage({
    type: 'UNLOCK_VAULT',
    password: current
  });

  if (!unlockResponse.success) {
    elements.passwordError.textContent = 'Current password is incorrect';
    return;
  }

  // Change password
  const response = await sendMessage({
    type: 'CHANGE_PASSWORD',
    oldPassword: current,
    newPassword: newPass
  });

  if (response.success) {
    currentPassword = newPass;
    elements.changePasswordForm.reset();
    elements.passwordError.textContent = '';
    showToast('Password changed successfully!');
  } else {
    elements.passwordError.textContent = response.error || 'Failed to change password';
  }
}

/**
 * Export encrypted vault
 */
async function exportAccounts() {
  try {
    const response = await sendMessage({ type: 'EXPORT_VAULT' });

    if (response.success && response.data) {
      // Create a downloadable file with encrypted vault data
      const blob = new Blob([JSON.stringify(response.data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);

      const a = document.createElement('a');
      a.href = url;
      const dateStr = new Date().toISOString().split('T')[0];
      a.download = `2fa-vault-backup-${dateStr}.json`;
      a.click();

      URL.revokeObjectURL(url);

      // Show status
      elements.backupStatus.innerHTML = `
        <div class="backup-success">✓ Backup exported on ${new Date().toLocaleString()}</div>
      `;

      showToast('Vault backup exported successfully!');
    } else {
      showToast('Failed to export backup');
    }
  } catch (error) {
    console.error('Export error:', error);
    showToast('Export failed: ' + error.message);
  }
}

/**
 * Import encrypted vault
 */
async function importAccounts(file) {
  try {
    // Read the file
    const text = await file.text();
    const data = JSON.parse(text);

    // Validate the backup file structure
    if (!data.version || !data.accounts) {
      showToast('Invalid backup file format');
      return;
    }

    // Store the file data and show password modal
    pendingImportFile = data;
    elements.importError.textContent = '';
    elements.importMasterPassword.value = '';
    elements.importModal.classList.remove('hidden');
    elements.importMasterPassword.focus();
  } catch (error) {
    console.error('Import error:', error);
    showToast('Import failed: ' + error.message);
  }
}

/**
 * Process import with password
 */
async function processImport(password) {
  if (!pendingImportFile) {
    return;
  }

  try {
    // Send import request with password verification
    const response = await sendMessage({
      type: 'IMPORT_VAULT',
      data: pendingImportFile,
      password: password
    });

    if (response.success) {
      // Clear pending file
      pendingImportFile = null;
      elements.importFile.value = '';

      // Close modal
      elements.importModal.classList.add('hidden');
      elements.importError.textContent = '';

      // Show status
      elements.backupStatus.innerHTML = `
        <div class="backup-success">✓ Backup imported on ${new Date().toLocaleString()}</div>
      `;

      // Small delay to allow import to complete
      await new Promise(resolve => setTimeout(resolve, 300));

      // Refresh data - fetch accounts again from background
      await loadAccounts();
      await loadSettings();

      // Switch to Accounts section
      elements.sections.forEach(s => s.classList.remove('active'));
      elements.navItems.forEach(i => i.classList.remove('active'));
      document.getElementById('accounts-section').classList.add('active');
      document.querySelector('.nav-item[data-section="accounts"]').classList.add('active');

      showToast('Vault imported successfully!');
    } else {
      elements.importError.textContent = response.error || 'Import failed';
    }
  } catch (error) {
    console.error('Import error:', error);
    elements.importError.textContent = error.message;
  }
}

/**
 * Delete all data
 */
function showDeleteModal() {
  elements.deleteError.textContent = '';
  elements.deleteConfirmText.value = '';
  elements.deleteModal.classList.remove('hidden');
  elements.deleteConfirmText.focus();
}

async function processDelete(confirmText) {
  if (confirmText !== 'DELETE') {
    elements.deleteError.textContent = 'Please type "DELETE" to confirm';
    return;
  }

  try {
    // Delete all accounts
    for (const account of accounts) {
      await sendMessage({
        type: 'DELETE_ACCOUNT',
        id: account.id,
        password: currentPassword
      });
    }

    // Lock vault
    await sendMessage({ type: 'LOCK_VAULT' });

    // Close modal
    elements.deleteModal.classList.add('hidden');

    showToast('All data deleted. Redirecting...');
    setTimeout(() => {
      window.location.href = 'popup.html';
    }, 1000);
  } catch (error) {
    elements.deleteError.textContent = error.message;
  }
}

async function deleteAllData() {
  showDeleteModal();
}

/**
 * Setup event listeners
 */
function setupEventListeners() {
  // Password form
  elements.passwordForm.addEventListener('submit', (e) => {
    e.preventDefault();
    unlockVault(elements.masterPasswordInput.value);
  });

  // Navigation
  elements.navItems.forEach(item => {
    item.addEventListener('click', () => {
      const section = item.dataset.section;

      elements.navItems.forEach(i => i.classList.remove('active'));
      elements.sections.forEach(s => s.classList.remove('active'));

      item.classList.add('active');
      document.getElementById(`${section}-section`).classList.add('active');
    });
  });

  // Lock vault
  elements.lockVaultBtn.addEventListener('click', async () => {
    await sendMessage({ type: 'LOCK_VAULT' });
    window.location.href = 'popup.html';
  });

  // Search
  elements.searchAccounts.addEventListener('input', (e) => {
    renderAccounts(e.target.value);
  });

  // Add account (redirect to popup with add mode)
  elements.addAccountBtn.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
    // In a real implementation, you'd communicate with popup to open add modal
    showToast('Use the popup to add new accounts');
  });

  document.querySelector('.add-first-btn')?.addEventListener('click', () => {
    showToast('Use the popup to add new accounts');
  });

  // Change password form
  elements.changePasswordForm.addEventListener('submit', changePassword);

  // Export
  elements.exportBtn.addEventListener('click', exportAccounts);

  // Import
  elements.importBtn.addEventListener('click', () => {
    elements.importFile.click();
  });

  elements.importFile.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      importAccounts(e.target.files[0]);
    }
  });

  // Delete all
  elements.deleteAllBtn.addEventListener('click', deleteAllData);

  // Settings changes
  [elements.autoLock, elements.lockTimeout, elements.clipboardTimeout,
   elements.showNotifications, elements.defaultDigits, elements.defaultPeriod].forEach(el => {
    el.addEventListener('change', saveSettings);
  });

  // Modal
  elements.closeModal.addEventListener('click', closeEditModal);
  elements.cancelEdit.addEventListener('click', closeEditModal);
  elements.editModal.addEventListener('click', (e) => {
    if (e.target === elements.editModal) {
      closeEditModal();
    }
  });

  // Import modal
  elements.importModal.addEventListener('click', (e) => {
    if (e.target === elements.importModal) {
      elements.importModal.classList.add('hidden');
      pendingImportFile = null;
    }
  });
  elements.cancelImport.addEventListener('click', () => {
    elements.importModal.classList.add('hidden');
    pendingImportFile = null;
    // Also clear cloud download if applicable
    if (typeof clearPendingCloudDownload === 'function') {
      clearPendingCloudDownload();
    }
  });
  elements.importPasswordForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const password = elements.importMasterPassword.value;

    // Check if this is a sync download (from options-cloud.js)
    if (typeof hasPendingSyncDownload === 'function' && hasPendingSyncDownload()) {
      // Handle synced vault download
      const result = await applySyncedVault(password);
      if (result.success) {
        elements.importModal.classList.add('hidden');
        elements.importError.textContent = '';
      } else {
        elements.importError.textContent = result.error || 'Failed to apply synced vault';
      }
    } else if (pendingImportFile) {
      // Handle local file import
      processImport(password);
    }
  });

  // Delete modal
  elements.deleteModal.addEventListener('click', (e) => {
    if (e.target === elements.deleteModal) {
      elements.deleteModal.classList.add('hidden');
    }
  });
  elements.cancelDelete.addEventListener('click', () => {
    elements.deleteModal.classList.add('hidden');
  });
  elements.deleteConfirmForm.addEventListener('submit', (e) => {
    e.preventDefault();
    processDelete(elements.deleteConfirmText.value);
  });

  // Delete account modal
  elements.deleteAccountModal.addEventListener('click', (e) => {
    if (e.target === elements.deleteAccountModal) {
      elements.deleteAccountModal.classList.add('hidden');
      pendingDeleteAccountId = null;
    }
  });
  elements.cancelDeleteAccount.addEventListener('click', () => {
    elements.deleteAccountModal.classList.add('hidden');
    pendingDeleteAccountId = null;
  });
  elements.confirmDeleteAccount.addEventListener('click', () => {
    confirmDeleteAccount();
  });

  // Toggle password visibility
  elements.togglePassword.addEventListener('click', () => {
    const type = elements.editPassword.type === 'password' ? 'text' : 'password';
    elements.editPassword.type = type;
    elements.togglePassword.textContent = type === 'password' ? '👁️' : '🙈';
  });

  // Toggle secret visibility
  elements.editToggleSecret.addEventListener('click', () => {
    const originalSecret = elements.editSecret.dataset.originalSecret || '';

    if (!originalSecret) {
      // No original secret to show
      return;
    }

    const type = elements.editSecret.type === 'password' ? 'text' : 'password';
    elements.editSecret.type = type;

    if (type === 'text') {
      elements.editSecret.value = originalSecret;
      elements.editToggleSecret.textContent = '🙈';
    } else {
      elements.editSecret.value = '••••••••••••••••••••••••';
      elements.editToggleSecret.textContent = '👁️';
    }
  });

  // Edit form submit
  elements.editAccountForm.addEventListener('submit', saveAccountEdit);

  // All close modal buttons
  document.querySelectorAll('.close-modal').forEach(btn => {
    btn.addEventListener('click', () => {
      // Close all modals
      elements.editModal?.classList.add('hidden');
      elements.importModal?.classList.add('hidden');
      elements.deleteModal?.classList.add('hidden');
      elements.deleteAccountModal?.classList.add('hidden');
      pendingImportFile = null;
      pendingDeleteAccountId = null;
    });
  });
}

/**
 * Send message to background
 */
function sendMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      resolve(response || { success: false, error: 'No response' });
    });
  });
}

/**
 * Show toast notification
 */
function showToast(message) {
  elements.toastMessage.textContent = message;
  elements.toast.classList.remove('hidden');

  setTimeout(() => {
    elements.toast.classList.add('hidden');
  }, 3000);
}

/**
 * Escape HTML
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Initialize
document.addEventListener('DOMContentLoaded', init);
