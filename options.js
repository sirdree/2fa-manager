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
  passwordError: document.getElementById('options-unlock-error'),

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

  // Account Modal (Unified Add/Edit)
  editModal: document.getElementById('edit-modal'),
  modalTitle: document.getElementById('modal-title'),
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
  editDigits: document.getElementById('edit-digits'),
  editPeriod: document.getElementById('edit-period'),
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

  // Check background status
  const statusResponse = await sendMessage({ type: 'GET_STATUS' });

  if (statusResponse.unlocked) {
    // Background is unlocked!
    vaultUnlocked = true;
    
    // Attempt to get password from session storage
    const sessionData = await chrome.storage.session.get('masterPassword');
    if (sessionData.masterPassword) {
      currentPassword = sessionData.masterPassword;
    }

    // Hide modal and load UI
    elements.passwordModal.classList.add('hidden');
    await Promise.all([
      loadAccounts(),
      loadSettings()
    ]);
    if (typeof initCloudSync === 'function') await initCloudSync();
  } else {
    // Vault is locked, must unlock via popup or here
    // Redirect to popup for consistent behavior
    window.location.href = 'popup.html';
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

    // Store password in session storage
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
      (a.issuer + a.accountName + (a.username||'')).toLowerCase().includes(filter.toLowerCase())
    )
    : accounts;

  elements.accountsList.innerHTML = '';

  if (filtered.length === 0) {
    elements.accountsList.classList.add('hidden');
    elements.noAccounts.classList.remove('hidden');
    return;
  }

  elements.accountsList.classList.remove('hidden');
  elements.noAccounts.classList.add('hidden');

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
        ${account.username ? `<div class="account-credentials">👤 ${escapeHtml(account.username)}</div>` : ''}
      </div>
      <div class="account-actions">
        <button class="btn btn-secondary edit-btn" data-account-id="${account.id}" title="Edit">✏️ Edit</button>
        <button class="btn btn-danger delete-btn" data-account-id="${account.id}" title="Delete">🗑️</button>
      </div>
    `;

    fragment.appendChild(card);
  });

  elements.accountsList.appendChild(fragment);
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
 * Open add modal
 */
function openAddModal() {
  editingAccountId = null;
  elements.editAccountId.value = '';
  elements.modalTitle.textContent = 'Add Account';
  elements.editAccountForm.reset();
  
  // Set default values
  elements.editDigits.value = settings.defaultDigits || 6;
  elements.editPeriod.value = settings.defaultPeriod || 30;
  
  elements.editSecret.type = 'text';
  elements.formError.textContent = '';
  elements.editModal.classList.remove('hidden');
}

/**
 * Open edit modal
 */
function openEditModal(accountId) {
  const account = accounts.find(a => a.id === accountId);
  if (!account) return;

  editingAccountId = accountId;
  elements.editAccountId.value = account.id;
  elements.modalTitle.textContent = 'Edit Account';
  
  elements.editIssuer.value = account.issuer || '';
  elements.editName.value = account.accountName || '';
  elements.editUsername.value = account.username || '';
  elements.editPassword.value = account.password || '';
  elements.editDigits.value = account.digits || 6;
  elements.editPeriod.value = account.period || 30;

  if (account.secret) {
    elements.editSecret.type = 'password';
    elements.editSecret.value = '••••••••••••••••••••••••';
    elements.editSecret.dataset.originalSecret = account.secret;
  } else {
    elements.editSecret.value = '';
    elements.editSecret.dataset.originalSecret = '';
  }

  elements.formError.textContent = '';
  elements.editModal.classList.remove('hidden');
}

/**
 * Close modal
 */
function closeEditModal() {
  elements.editModal.classList.add('hidden');
  elements.editAccountForm.reset();
  elements.formError.textContent = '';
}

/**
 * Save account (Add or Edit)
 */
async function saveAccount(e) {
  e.preventDefault();

  let secret = elements.editSecret.value.trim();
  const originalSecret = elements.editSecret.dataset.originalSecret || '';

  if (secret === '••••••••••••••••••••••••' || secret === '') {
    secret = originalSecret;
  } else {
    secret = secret.toUpperCase().replace(/\s/g, '');
  }

  const accountData = {
    issuer: elements.editIssuer.value.trim(),
    accountName: elements.editName.value.trim(),
    username: elements.editUsername.value.trim(),
    password: elements.editPassword.value,
    secret: secret,
    digits: parseInt(elements.editDigits.value),
    period: parseInt(elements.editPeriod.value)
  };

  const type = editingAccountId ? 'UPDATE_ACCOUNT' : 'ADD_ACCOUNT';
  const response = await sendMessage({
    type,
    id: editingAccountId,
    account: accountData,
    password: currentPassword
  });

  if (response.success) {
    closeEditModal();
    await loadAccounts();
    showToast(editingAccountId ? 'Account updated!' : 'Account added!');
  } else {
    elements.formError.textContent = response.error || 'Failed to save account';
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
 * Export encrypted vault
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
      elements.backupStatus.innerHTML = `<div class="backup-success">✓ Exported on ${new Date().toLocaleString()}</div>`;
      showToast('Vault exported!');
    }
  } catch (error) { showToast('Export failed'); }
}

/**
 * Import encrypted vault
 */
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
    await loadAccounts();
    showToast('Vault imported!');
  } else {
    elements.importError.textContent = response.error || 'Import failed';
  }
}

/**
 * Delete account confirmation
 */
function showDeleteAccountModal(account) {
  if (!account) return;
  pendingDeleteAccountId = account.id;
  elements.deleteAccountName.textContent = `${account.issuer || 'Unknown'} (${account.accountName})`;
  elements.deleteAccountModal.classList.remove('hidden');
}

async function confirmDeleteAccount() {
  if (!pendingDeleteAccountId) return;
  const response = await sendMessage({ type: 'DELETE_ACCOUNT', id: pendingDeleteAccountId, password: currentPassword });
  elements.deleteAccountModal.classList.add('hidden');
  pendingDeleteAccountId = null;
  if (response.success) { await loadAccounts(); showToast('Deleted!'); }
}

/**
 * Setup event listeners
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
  elements.searchAccounts.addEventListener('input', (e) => renderAccounts(e.target.value));
  elements.addAccountBtn.addEventListener('click', openAddModal);
  document.querySelector('.add-first-btn')?.addEventListener('click', openAddModal);
  elements.changePasswordForm.addEventListener('submit', changePassword);
  elements.exportBtn.addEventListener('click', exportAccounts);
  elements.importBtn.addEventListener('click', () => elements.importFile.click());
  elements.importFile.addEventListener('change', (e) => { if (e.target.files.length > 0) importAccounts(e.target.files[0]); });
  elements.deleteAllBtn.addEventListener('click', () => { elements.deleteError.textContent = ''; elements.deleteConfirmText.value = ''; elements.deleteModal.classList.remove('hidden'); });
  elements.deleteConfirmForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (elements.deleteConfirmText.value === 'DELETE') {
      await sendMessage({ type: 'RESET_VAULT' });
      window.location.href = 'popup.html';
    } else elements.deleteError.textContent = 'Type DELETE to confirm';
  });

  [elements.autoLock, elements.lockTimeout, elements.clipboardTimeout, elements.showNotifications, elements.defaultDigits, elements.defaultPeriod].forEach(el => el.addEventListener('change', saveSettings));

  elements.closeModal.addEventListener('click', closeEditModal);
  elements.cancelEdit.addEventListener('click', closeEditModal);
  elements.editAccountForm.addEventListener('submit', saveAccount);
  elements.togglePassword.addEventListener('click', () => {
    const type = elements.editPassword.type === 'password' ? 'text' : 'password';
    elements.editPassword.type = type;
    elements.togglePassword.textContent = type === 'password' ? '👁️' : '🙈';
  });
  elements.editToggleSecret.addEventListener('click', () => {
    const original = elements.editSecret.dataset.originalSecret || '';
    if (!original && !editingAccountId) return;
    const type = elements.editSecret.type === 'password' ? 'text' : 'password';
    elements.editSecret.type = type;
    if (type === 'text') {
      if (editingAccountId) elements.editSecret.value = original;
      elements.editToggleSecret.textContent = '🙈';
    } else {
      if (editingAccountId) elements.editSecret.value = '••••••••••••••••••••••••';
      elements.editToggleSecret.textContent = '👁️';
    }
  });

  elements.importPasswordForm.addEventListener('submit', (e) => { e.preventDefault(); processImport(elements.importMasterPassword.value); });
  elements.cancelImport.addEventListener('click', () => elements.importModal.classList.add('hidden'));
  elements.cancelDelete.addEventListener('click', () => elements.deleteModal.classList.add('hidden'));
  elements.cancelDeleteAccount.addEventListener('click', () => elements.deleteAccountModal.classList.add('hidden'));
  elements.confirmDeleteAccount.addEventListener('click', confirmDeleteAccount);
}

function sendMessage(m) { return new Promise(r => chrome.runtime.sendMessage(m, r)); }
function showToast(m) { elements.toastMessage.textContent = m; elements.toast.classList.remove('hidden'); setTimeout(() => elements.toast.classList.add('hidden'), 2000); }
function escapeHtml(t) { const d = document.createElement('div'); d.textContent = t; return d.innerHTML; }
function shortenUrl(u) { try { return new URL(u).hostname.replace('www.', ''); } catch { return u; } }

document.addEventListener('DOMContentLoaded', init);
