/**
 * Popup Script for 2FA Manager Extension
 * Handles UI interactions and communication with background service worker
 */

// State
let currentPassword = '';
let accounts = [];
let codes = [];
let timerInterval = null;
let editingAccountId = null;
let qrStream = null;
let qrScanner = null;
let pendingAutofillAccount = null;
let originalSecret = null; // Original 2FA secret before editing (for showing asterisks)
let isSecretVisible = false; // Track if secret is currently visible

// DOM Elements
const elements = {
  lockScreen: document.getElementById('lock-screen'),
  mainScreen: document.getElementById('main-screen'),
  unlockForm: document.getElementById('unlock-form'),
  unlockPassword: document.getElementById('unlock-password'),
  unlockError: document.getElementById('unlock-error'),
  resetVault: document.getElementById('reset-vault'),
  lockBtn: document.getElementById('lock-btn'),
  searchInput: document.getElementById('search-input'),
  codesList: document.getElementById('codes-list'),
  emptyState: document.getElementById('empty-state'),
  codeCount: document.getElementById('code-count'),
  addAccountManualBtn: document.getElementById('add-account-manual-btn'),
  scanQrBtn: document.getElementById('scan-qr-btn'),
  settingsBtn: document.getElementById('settings-btn'),
  accountPage: document.getElementById('account-page'),
  qrPage: document.getElementById('qr-page'),
  pageTitle: document.getElementById('page-title'),
  backToMain: document.getElementById('back-to-main'),
  backToMainQr: document.getElementById('back-to-main-qr'),
  accountFormPage: document.getElementById('account-form-page'),
  pageAccountIssuer: document.getElementById('page-account-issuer'),
  pageAccountUsername: document.getElementById('page-account-username'),
  pageAccountPassword: document.getElementById('page-account-password'),
  pageAccountSecret: document.getElementById('page-account-secret'),
  pageAccountDigits: document.getElementById('page-account-digits'),
  pageAccountPeriod: document.getElementById('page-account-period'),
  pageToggleSecret: document.getElementById('toggle-secret'),
  pageTogglePassword: document.getElementById('page-toggle-password'),
  pageCancelBtn: document.getElementById('page-cancel-btn'),
  pageFormError: document.getElementById('page-form-error'),
  qrVideo: document.getElementById('qr-video'),
  qrStatus: document.getElementById('qr-status'),
  startScanBtn: document.getElementById('start-scan-btn'),
  qrUpload: document.getElementById('qr-upload'),
  autofillConfirm: document.getElementById('autofill-confirm'),
  autofillMessage: document.getElementById('autofill-message'),
  autofillCodePreview: document.getElementById('autofill-code-preview'),
  autofillCancel: document.getElementById('autofill-cancel'),
  autofillConfirmBtn: document.getElementById('autofill-confirm-btn'),
  toast: document.getElementById('toast'),
  toastMessage: document.getElementById('toast-message')
};

/**
 * Initialize popup
 */
async function init() {
  // Check if vault is unlocked
  const response = await sendMessage({ type: 'GET_STATUS' });

  if (response.unlocked) {
    showMainScreen();
  } else {
    showLockScreen();
  }

  setupEventListeners();
}

/**
 * Show lock screen
 */
function showLockScreen() {
  elements.lockScreen.classList.remove('hidden');
  elements.mainScreen.classList.add('hidden');
  elements.unlockPassword.focus();
}

/**
 * Show main screen
 */
function showMainScreen() {
  console.log('showMainScreen called');
  console.log('lockScreen:', elements.lockScreen);
  console.log('mainScreen:', elements.mainScreen);

  elements.lockScreen.classList.add('hidden');
  elements.mainScreen.classList.remove('hidden');

  console.log('lockScreen classes after:', elements.lockScreen.className);
  console.log('mainScreen classes after:', elements.mainScreen.className);

  loadCodes();
  startTimer();
}

/**
 * Load codes from background
 */
async function loadCodes() {
  // Get codes with TOTP for display
  const codesResponse = await sendMessage({ type: 'GENERATE_ALL_TOTP' });

  // Get full accounts with secrets for editing
  const accountsResponse = await sendMessage({ type: 'GET_ACCOUNTS' });

  if (codesResponse.success && accountsResponse.success) {
    codes = codesResponse.data;
    accounts = accountsResponse.accounts;
    renderCodes();
  }
}

/**
 * Render codes list
 */
function renderCodes(filter = '') {
  const filteredCodes = filter
    ? codes.filter(c =>
      c.issuer.toLowerCase().includes(filter.toLowerCase()) ||
      c.accountName.toLowerCase().includes(filter.toLowerCase())
    )
    : codes;

  elements.codeCount.textContent = `${filteredCodes.length} account${filteredCodes.length !== 1 ? 's' : ''}`;

  // Show empty state only if there are 0 accounts total (not just filtered)
  if (codes.length === 0) {
    // No accounts at all - show empty state
    elements.codesList.classList.add('hidden');
    elements.emptyState.classList.remove('hidden');
    return;
  }

  // We have accounts - always hide empty state and show list
  elements.emptyState.classList.add('hidden');
  elements.codesList.classList.remove('hidden');

  // If search has no results, show a message
  if (filter && filteredCodes.length === 0) {
    elements.codesList.innerHTML = '<div style="text-align: center; padding: 40px; color: var(--text-secondary);">No accounts match your search</div>';
    return;
  }

  elements.codesList.innerHTML = filteredCodes.map(code => {
    // Check if this account has a 2FA secret
    const has2FA = !!code.code;
    const period = code.period || 30;
    const progress = (code.remainingTime / period) * 100;
    const circumference = 2 * Math.PI * 17; // radius = 17
    const dashOffset = circumference - (progress / 100) * circumference;
    const timerClass = code.remainingTime <= 5 ? 'danger' : code.remainingTime <= 12 ? 'warning' : '';

    // Extract domain/username for display
    const displayName = shortenUrl(code.issuer) || 'Unknown';
    let displayUsername = code.username || code.accountName || '';
    try {
      if (code.issuer && code.issuer.startsWith('http')) {
        const url = new URL(code.issuer);
        displayUsername = code.username || url.hostname;
      }
    } catch {}

    return `
    <div class="code-card ${!has2FA ? 'no-2fa' : ''}" data-account-id="${code.accountId}" data-period="${period}">
      <div class="code-card-main">
        <div class="code-card-left">
          <div class="code-card-icon" style="background: ${code.iconColor}">
            ${(displayName || '🔐').charAt(0).toUpperCase()}
          </div>
          <div class="code-card-info">
            <div class="code-card-issuer">${escapeHtml(displayName)}</div>
            <div class="code-card-name">${escapeHtml(displayUsername)}</div>
          </div>
        </div>
        ${has2FA ? `
        <div class="code-card-right">
          <div class="totp-code" data-account-id="${code.accountId}">${formatCode(code.code)}</div>
          <div class="radial-timer ${timerClass}" data-account-id="${code.accountId}">
            <svg width="36" height="36">
              <circle class="radial-timer-circle radial-timer-bg" cx="18" cy="18" r="15"/>
              <circle class="radial-timer-circle radial-timer-progress" cx="18" cy="18" r="15"
                stroke-dasharray="${circumference}" stroke-dashoffset="${dashOffset}"/>
            </svg>
            <span class="radial-timer-text">${code.remainingTime}</span>
          </div>
        </div>
        ` : `
        <div class="code-card-right-credentials">
          <div class="credentials-text">
            ${code.username ? `<span>👤 ${escapeHtml(code.username)}</span>` : ''}
            ${code.password ? `<span>🔑 Password saved</span>` : ''}
          </div>
        </div>
        `}
      </div>
      <div class="code-card-actions">
        ${has2FA ? `<button class="icon-btn copy-code" data-code="${code.code}" title="Copy code">📋</button>` : ''}
        <button class="icon-btn autofill-account" data-account-id="${code.accountId}" title="Autofill">⚡</button>
        <button class="icon-btn edit-account" data-account-id="${code.accountId}" title="Edit">✏️</button>
        <button class="icon-btn delete-account" data-account-id="${code.accountId}" title="Delete">🗑️</button>
      </div>
    </div>
    `;
  }).join('');

  // Add event listeners to code cards
  attachCodeCardListeners();

  // Update timers immediately after rendering
  updateTimer();
}

/**
 * Attach event listeners to code cards
 */
function attachCodeCardListeners() {
  // Copy code button
  document.querySelectorAll('.copy-code').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const code = btn.dataset.code;
      copyToClipboard(code);
      showToast('Code copied!');
      btn.parentElement.parentElement.parentElement.classList.add('copied');
      setTimeout(() => {
        btn.parentElement.parentElement.parentElement.classList.remove('copied');
      }, 300);
    });
  });

  // Autofill button
  document.querySelectorAll('.autofill-account').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      autofillAccount(btn.dataset.accountId);
    });
  });

  // Edit account button
  document.querySelectorAll('.edit-account').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await openAccountPage(btn.dataset.accountId);
    });
  });

  // Delete account button
  document.querySelectorAll('.delete-account').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (confirm('Are you sure you want to delete this account?')) {
        deleteAccount(btn.dataset.accountId);
      }
    });
  });
}

/**
 * Format TOTP code with spaces
 */
function formatCode(code) {
  if (code.length === 6) {
    return `${code.slice(0, 3)} ${code.slice(3)}`;
  }
  return code;
}

/**
 * Start timer countdown
 */
function startTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
  }

  updateTimer();

  timerInterval = setInterval(() => {
    updateTimer();
  }, 1000);
}

/**
 * Update timer display
 */
function updateTimer() {
  // Update each radial timer individually and decrement remaining time
  codes.forEach(code => {
    if (!code.code) return; // Skip non-2FA accounts

    const timerEl = document.querySelector(`.radial-timer[data-account-id="${code.accountId}"]`);
    const codeEl = document.querySelector(`.totp-code[data-account-id="${code.accountId}"]`);
    if (!timerEl) return;

    // Decrement remaining time for display
    if (code.remainingTime > 0) {
      code.remainingTime--;
    }

    const period = code.period || 30;
    const progress = (code.remainingTime / period) * 100;
    const circumference = 2 * Math.PI * 15; // radius = 15
    const dashOffset = circumference - (progress / 100) * circumference;

    const progressCircle = timerEl.querySelector('.radial-timer-progress');
    const timerText = timerEl.querySelector('.radial-timer-text');

    if (progressCircle) {
      progressCircle.style.strokeDashoffset = dashOffset;
    }
    if (timerText) {
      timerText.textContent = code.remainingTime;
    }

    // Update color based on remaining time
    timerEl.classList.remove('warning', 'danger');
    if (code.remainingTime <= 5) {
      timerEl.classList.add('danger');
    } else if (code.remainingTime <= 12) {
      timerEl.classList.add('warning');
    }
  });

  // Check if any code needs refresh (when timer resets)
  const needsRefresh = codes.some(c => c.code && c.remainingTime === 0);
  if (needsRefresh) {
    loadCodes();
  }
}

/**
 * Copy text to clipboard
 */
async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Fallback for older browsers
    const textarea = document.createElement('textarea');
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
  }
}

/**
 * Autofill account credentials
 */
async function autofillAccount(accountId) {
  const account = accounts.find(a => a.id === accountId);
  if (!account) return;

  // Check if account has a 2FA secret
  if (!account.secret) {
    // No 2FA, just autofill credentials
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (tab && tab.url) {
      chrome.tabs.sendMessage(tab.id, {
        type: 'AUTOFILL_CREDENTIALS',
        data: {
          username: account.username || '',
          password: account.password || '',
          totpCode: ''
        }
      }).catch(() => {
        showToast('Navigate to a login page to autofill');
      });
    }

    window.close();
    return;
  }

  // Get current TOTP code for this account
  const response = await sendMessage({
    type: 'GENERATE_TOTP',
    accountId: account.id
  });

  if (response.success && response.data) {
    // Show confirmation popup
    showAutofillConfirm(account, response.data.code);
  }
}

/**
 * Open account page
 */
async function openAccountPage(accountId = null) {
  editingAccountId = accountId;
  originalSecret = null; // Reset original secret
  isSecretVisible = false; // Reset visibility state

  elements.pageTitle.textContent = accountId ? 'Edit Account' : 'Adding Manual Account';
  elements.accountPage.classList.remove('hidden');
  elements.mainScreen.classList.add('hidden');
  elements.pageFormError.textContent = '';

  if (accountId) {
    const account = accounts.find(a => a.id === accountId);
    if (account) {
      elements.pageAccountIssuer.value = account.issuer || '';
      elements.pageAccountUsername.value = account.username || '';
      elements.pageAccountPassword.value = account.password || '';

      // Handle 2FA secret - show asterisks if secret exists
      if (account.secret) {
        originalSecret = account.secret;
        elements.pageAccountSecret.type = 'password';
        elements.pageAccountSecret.value = '•••••••••••••••••••••••';
        elements.pageToggleSecret.textContent = '👁️';
      } else {
        elements.pageAccountSecret.value = '';
        elements.pageToggleSecret.textContent = '👁️';
      }

      elements.pageAccountDigits.value = account.digits || 6;
      elements.pageAccountPeriod.value = account.period || 30;
    }
  } else {
    elements.accountFormPage.reset();
    elements.pageAccountDigits.value = 6;
    elements.pageAccountPeriod.value = 30;
    elements.pageAccountSecret.type = 'password';
    elements.pageToggleSecret.textContent = '👁️';

    // Auto-fill with current tab's full URL
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab && tab.url) {
        elements.pageAccountIssuer.value = tab.url;
      }
    } catch {
      // If we can't get the tab URL, leave empty
    }
  }

  // Show account page
  if (accountId) {
    // Switch to account page
    elements.accountPage.classList.remove('hidden');
    elements.mainScreen.classList.add('hidden');
  }
}

/**
 * Close account page
 */
function closeAccountPage() {
  elements.accountPage.classList.add('hidden');
  elements.mainScreen.classList.remove('hidden');
  elements.accountFormPage.reset();
  elements.pageFormError.textContent = '';
  editingAccountId = null;
}

/**
 * Open QR scanner page
 */
function openQRPage() {
  elements.qrPage.classList.remove('hidden');
  elements.mainScreen.classList.add('hidden');
  elements.qrStatus.textContent = 'Position QR code in frame';
  elements.startScanBtn.classList.remove('hidden');
}

/**
 * Close QR page
 */
function closeQRPage() {
  elements.qrPage.classList.add('hidden');
  elements.mainScreen.classList.remove('hidden');
  stopQRScanner();
}

/**
 * Start QR scanner
 */
async function startQRScanner() {
  try {
    // Initialize QR scanner
    qrScanner = new QRScanner();
    await qrScanner.init(elements.qrVideo);

    // Get camera stream
    qrStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' }
    });

    elements.qrVideo.srcObject = qrStream;
    elements.qrStatus.textContent = 'Scanning...';
    elements.startScanBtn.classList.add('hidden');

    // Wait for video to be ready
    elements.qrVideo.onloadedmetadata = () => {
      elements.qrVideo.play();
      // Start QR detection
      qrScanner.start(handleQRCode);
    };
  } catch (error) {
    elements.qrStatus.textContent = 'Camera access denied or not available';
    console.error('QR Scanner error:', error);
    showToast('Camera access required for QR scanning');
  }
}

/**
 * Stop QR scanner
 */
function stopQRScanner() {
  if (qrScanner) {
    qrScanner.stop();
    qrScanner = null;
  }

  if (qrStream) {
    qrStream.getTracks().forEach(track => track.stop());
    qrStream = null;
  }

  elements.qrVideo.srcObject = null;
  elements.qrStatus.textContent = 'Position QR code in frame';
  elements.startScanBtn.classList.remove('hidden');
}

/**
 * Handle detected QR code
 */
async function handleQRCode(data, error = null) {
  if (error) {
    showToast(error);
    return;
  }

  if (!data) {
    return;
  }

  try {
    // Parse otpauth URL using QRScanner
    const parsed = QRScanner.parseOTPAuth(data);

    if (parsed && parsed.secret) {
      stopQRScanner();

      // Get current tab URL for the issuer field
      let issuer = parsed.issuer || parsed.accountName;
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab && tab.url) {
          issuer = tab.url;
        }
      } catch {
        // Use the issuer from QR code
      }

      // Open account page and fill form
      elements.qrPage.classList.add('hidden');
      await openAccountPage();

      elements.pageAccountIssuer.value = issuer;
      elements.pageAccountSecret.value = parsed.secret;
      elements.pageAccountDigits.value = parsed.digits || 6;
      elements.pageAccountPeriod.value = parsed.period || 30;

      // Use account name from QR as username
      if (parsed.accountName && !elements.pageAccountUsername.value) {
        elements.pageAccountUsername.value = parsed.accountName;
      }

      showToast('QR code scanned! Review and save the account.');
    } else {
      showToast('Invalid QR code. Please scan an otpauth:// QR code.');
    }
  } catch (error) {
    showToast('Invalid QR code format');
  }
}

/**
 * Process uploaded QR image
 */
async function handleQRUpload(event) {
  const file = event.target.files[0];
  if (!file) return;

  try {
    const scanner = new QRScanner();
    const data = await scanner.scanFromFile(file);

    if (data) {
      handleQRCode(data);
    }
  } catch (error) {
    elements.formError.textContent = error.message || 'Failed to scan QR code from image';
  }

  elements.qrUpload.value = '';
}

/**
 * Save account
 */
async function saveAccount(e) {
  e.preventDefault();

  const issuer = elements.pageAccountIssuer.value.trim();
  let secret = elements.pageAccountSecret.value.trim();

  // Check if secret is the asterisks placeholder BEFORE replacing
  // Also check if it starts with the bullet character for robustness
  const isAsterisks = secret === '••••••••••••••••••••••••' || secret.startsWith('•');

  // If editing and secret is still asterisks, preserve the original secret
  if (editingAccountId && isAsterisks) {
    if (originalSecret) {
      secret = originalSecret; // Use the actual stored secret
    } else {
      secret = ''; // No secret stored
    }
  } else {
    secret = secret.toUpperCase().replace(/\s/g, '');
  }

  const username = elements.pageAccountUsername.value.trim();

  // Generate accountName from URL or username
  let accountName = username;
  if (!accountName && issuer) {
    try {
      const url = new URL(issuer);
      accountName = url.hostname;
    } catch {
      accountName = issuer;
    }
  }

  const accountData = {
    issuer: issuer,
    accountName: accountName || 'Unknown',
    secret: secret,
    digits: parseInt(elements.pageAccountDigits.value),
    period: parseInt(elements.pageAccountPeriod.value),
    username: elements.pageAccountUsername.value.trim(),
    password: elements.pageAccountPassword.value
  };

  // Skip validation if editing with original secret (already validated when first added)
  if (isAsterisks) {
    // Using original secret, skip validation
  } else if (secret && !/^[A-Z2-7]+$/.test(secret)) {
    elements.pageFormError.textContent = 'Invalid secret key format (must be Base32)';
    return;
  }

  // Ensure we have the current password before saving
  if (!currentPassword) {
    // Try to get from session storage
    const sessionData = await chrome.storage.session.get('masterPassword');
    currentPassword = sessionData.masterPassword;
  }

  if (!currentPassword) {
    elements.pageFormError.textContent = 'Vault locked. Please close and reopen the extension.';
    return;
  }

  const response = await sendMessage({
    type: editingAccountId ? 'UPDATE_ACCOUNT' : 'ADD_ACCOUNT',
    id: editingAccountId,
    account: accountData,
    password: currentPassword
  });

  if (response.success) {
    const wasEditing = !!editingAccountId;
    closeAccountPage();
    loadCodes();
    showToast(wasEditing ? 'Account edited successfully!' : 'Account added successfully!');
  } else {
    elements.pageFormError.textContent = response.error || 'Failed to save account';
  }
}

/**
 * Delete account
 */
async function deleteAccount(accountId) {
  // Ensure we have the current password before deleting
  if (!currentPassword) {
    // Try to get from session storage
    const sessionData = await chrome.storage.session.get('masterPassword');
    currentPassword = sessionData.masterPassword;
  }

  if (!currentPassword) {
    showToast('Vault locked. Please close and reopen the extension.');
    return;
  }

  const response = await sendMessage({
    type: 'DELETE_ACCOUNT',
    id: accountId,
    password: currentPassword
  });

  if (response.success) {
    // Reload codes and accounts to refresh the list
    const codesResponse = await sendMessage({ type: 'GENERATE_ALL_TOTP' });
    const accountsResponse = await sendMessage({ type: 'GET_ACCOUNTS' });

    if (codesResponse.success && accountsResponse.success) {
      codes = codesResponse.data;
      accounts = accountsResponse.accounts;
      renderCodes();
    }

    showToast('Account deleted!');
  } else {
    showToast(response.error || 'Failed to delete account');
  }
}

/**
 * Setup event listeners
 */
function setupEventListeners() {
  // Unlock form
  elements.unlockForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const password = elements.unlockPassword.value;

    if (!password) {
      elements.unlockError.textContent = 'Please enter a password';
      return;
    }

    console.log('Attempting to unlock vault...');

    try {
      const response = await sendMessage({
        type: 'UNLOCK_VAULT',
        password
      });

      console.log('Unlock response:', response);

      if (response.success) {
        currentPassword = password;
        // Store password in session storage for persistence across service worker restarts
        await chrome.storage.session.set({ masterPassword: password });

        if (response.firstTime) {
          showToast('Welcome! Set up your master password');
        }
        showMainScreen();
      } else {
        elements.unlockError.textContent = response.error || 'Failed to unlock';
        console.error('Unlock failed:', response.error);
      }
    } catch (error) {
      elements.unlockError.textContent = 'An error occurred: ' + error.message;
      console.error('Unlock error:', error);
    }
  });

  // Reset vault link
  elements.resetVault.addEventListener('click', async (e) => {
    e.preventDefault();

    const confirmed = confirm(
      '⚠️ WARNING: This will PERMANENTLY delete all your accounts and data!\n\n' +
      'This action CANNOT be undone.\n\n' +
      'You will need to set up your master password and add all accounts again.\n\n' +
      'Type "RESET" to confirm:'
    );

    if (confirmed) {
      const response = await sendMessage({ type: 'RESET_VAULT' });

      if (response.success) {
        elements.unlockPassword.value = '';
        elements.unlockError.textContent = '';
        showToast('Vault reset. Please set a new master password.');
      }
    }
  });

  // Lock button
  elements.lockBtn.addEventListener('click', async () => {
    await sendMessage({ type: 'LOCK_VAULT' });
    currentPassword = '';
    showLockScreen();
    stopTimer();
  });

  // Search input
  elements.searchInput.addEventListener('input', (e) => {
    renderCodes(e.target.value);
  });

  // Add account button
  elements.addAccountManualBtn.addEventListener('click', async () => await openAccountPage());

  // Scan QR button
  elements.scanQrBtn.addEventListener('click', () => openQRPage());

  // Settings button
  elements.settingsBtn.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  // Back buttons
  elements.backToMain.addEventListener('click', closeAccountPage);
  elements.backToMainQr.addEventListener('click', closeQRPage);
  elements.pageCancelBtn.addEventListener('click', closeAccountPage);

  // Toggle password visibility
  elements.pageTogglePassword.addEventListener('click', () => {
    const type = elements.pageAccountPassword.type === 'password' ? 'text' : 'password';
    elements.pageAccountPassword.type = type;
    elements.pageTogglePassword.textContent = type === 'password' ? '👁️' : '🙈';
  });

  // Toggle secret visibility
  elements.pageToggleSecret.addEventListener('click', () => {
    if (!originalSecret) {
      // No original secret to show - nothing to toggle
      return;
    }

    isSecretVisible = !isSecretVisible;

    if (isSecretVisible) {
      elements.pageAccountSecret.type = 'text';
      elements.pageAccountSecret.value = originalSecret;
      elements.pageToggleSecret.textContent = '🙈';
    } else {
      elements.pageAccountSecret.type = 'password';
      elements.pageAccountSecret.value = '••••••••••••••••••••••••';
      elements.pageToggleSecret.textContent = '👁️';
    }
  });

  // Start QR scan button
  elements.startScanBtn.addEventListener('click', startQRScanner);

  // QR upload
  elements.qrUpload.addEventListener('change', handleQRUpload);

  // Account form page submit
  elements.accountFormPage.addEventListener('submit', saveAccount);

  // Autofill confirmation popup (only setup if not already set by quick action)
  if (!elements.autofillConfirmBtn.onclick) {
    elements.autofillCancel.addEventListener('click', closeAutofillConfirm);
    elements.autofillConfirmBtn.addEventListener('click', confirmAutofill);
  }
}

/**
 * Show autofill confirmation popup
 */
function showAutofillConfirm(account, code) {
  pendingAutofillAccount = { account, code };

  const serviceName = account.issuer || account.accountName || 'this service';
  elements.autofillMessage.textContent = `Found a 2FA code for ${serviceName}. Would you like to use it?`;
  elements.autofillCodePreview.textContent = formatCode(code);

  elements.autofillConfirm.classList.remove('hidden');
}

/**
 * Close autofill confirmation popup
 */
function closeAutofillConfirm() {
  elements.autofillConfirm.classList.add('hidden');
  pendingAutofillAccount = null;
}

/**
 * Confirm autofill
 */
async function confirmAutofill() {
  if (!pendingAutofillAccount) return;

  const { account, code } = pendingAutofillAccount;

  // Get current tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (tab && tab.url) {
    await autofillToTab(tab.id, account, code);
  }

  closeAutofillConfirm();
  window.close();
}

/**
 * Autofill credentials to a specific tab
 */
async function autofillToTab(tabId, account, totpCode) {
  // Send autofill message to content script
  chrome.tabs.sendMessage(tabId, {
    type: 'AUTOFILL_CREDENTIALS',
    data: {
      username: account.username || '',
      password: account.password || '',
      totpCode: totpCode || ''
    }
  }).catch(() => {
    // Content script not loaded, try to inject it
    chrome.scripting.executeScript({
      target: { tabId },
      files: ['content.js']
    }).then(() => {
      setTimeout(() => {
        chrome.tabs.sendMessage(tabId, {
          type: 'AUTOFILL_CREDENTIALS',
          data: {
            username: account.username || '',
            password: account.password || '',
            totpCode: totpCode || ''
          }
        }).catch(() => {
          if (totpCode) {
            copyToClipboard(totpCode);
            showToast('Code copied! Navigate to a login page to autofill.');
          }
        });
      }, 100);
    }).catch(() => {
      if (totpCode) {
        copyToClipboard(totpCode);
        showToast('Code copied! Navigate to a login page to autofill.');
      }
    });
  });
}

/**
 * Stop timer
 */
function stopTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

/**
 * Send message to background
 */
function sendMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        console.error('Messaging error:', chrome.runtime.lastError.message);
        resolve({ success: false, error: chrome.runtime.lastError.message });
      } else {
        resolve(response || { success: false, error: 'No response from background' });
      }
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

/**
 * Shorten URL for display (e.g., https://example.com/long/path -> https://example.com/...)
 */
function shortenUrl(url) {
  if (!url) return '';

  try {
    // If it's a URL, shorten the path
    if (url.startsWith('http://') || url.startsWith('https://')) {
      const urlObj = new URL(url);
      const baseUrl = urlObj.origin;
      const path = urlObj.pathname;

      // If path is longer than 20 characters, truncate it
      if (path.length > 20) {
        return `${baseUrl}/...`;
      }
      // If there's a query string or hash, also truncate
      if (urlObj.search || urlObj.hash) {
        return `${baseUrl}${path}${path.length > 0 ? '/...' : '...'}`;
      }
      // Otherwise return full URL if it's reasonably short
      if (url.length > 50) {
        return `${baseUrl}${path}/...`;
      }
    }
  } catch {
    // If URL parsing fails, just truncate long strings
    if (url.length > 50) {
      return url.substring(0, 47) + '...';
    }
  }

  return url;
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

// Cleanup on popup close
window.addEventListener('beforeunload', () => {
  stopTimer();
  stopQRScanner();
});
