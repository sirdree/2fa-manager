/**
 * Popup Script for 2FA Manager Extension
 * Stable Rebuild with Precise Refinements
 */

// State
let currentPassword = '';
let accounts = [];
let codes = [];
let timerInterval = null;
let editingAccountId = null;
let selectedAccountId = null;
let qrStream = null;
let qrScanner = null;
let originalSecret = null;
let isDetailPasswordVisible = false;
let pendingImportData = null; // State for import

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
  emptyAddBtn: document.getElementById('empty-add-btn'),
  emptyScanBtn: document.getElementById('empty-scan-btn'),
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
  pageTogglePassword: document.getElementById('page-toggle-password'),
  toggleSecret: document.getElementById('toggle-secret'),
  pageCancelBtn: document.getElementById('page-cancel-btn'),
  pageFormError: document.getElementById('page-form-error'),
  qrVideo: document.getElementById('qr-video'),
  qrStatus: document.getElementById('qr-status'),
  startScanBtn: document.getElementById('start-scan-btn'),
  qrUpload: document.getElementById('qr-upload'),
  toast: document.getElementById('toast'),
  toastMessage: document.getElementById('toast-message'),
  emptyDetailState: document.getElementById('empty-detail-state'),
  accountDetailView: document.getElementById('account-detail-view'),
  // New elements for initialization and import
  lockSubtitle: document.getElementById('lock-subtitle'),
  emptyImportBtn: document.getElementById('empty-import-btn'),
  emptySettingsBtn: document.getElementById('empty-settings-btn'),
  importPage: document.getElementById('import-page'),
  backToMainImport: document.getElementById('back-to-main-import'),
  selectImportBtn: document.getElementById('select-import-file-btn'),
  importFileInput: document.getElementById('import-file-input'),
  importVerifySection: document.getElementById('import-verify-section'),
  importMasterPassword: document.getElementById('import-master-password'),
  confirmImportBtn: document.getElementById('confirm-import-btn'),
  importError: document.getElementById('import-error')
};

// SVG Assets
const SVG = {
  COPY: `<svg class="icon" style="opacity:0.6;" viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`,
  EYE: `<svg class="icon" viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`,
  FLASH: `<svg class="icon" viewBox="0 0 24 24"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>`,
  EDIT: `<svg class="icon" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>`,
  TRASH: `<svg class="svg-base icon-trash" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>`,
  LINK: `<svg class="icon" style="width:12px;height:12px;opacity:0.7;" viewBox="0 0 24 24"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>`,
  USER: `<svg class="icon" style="width:14px;height:14px;opacity:0.6;" viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>`
};

/** Initialize */
async function init() {
  const res = await sendMessage({ type: 'GET_STATUS' });
  
  if (res.unlocked) {
    showMainScreen();
  } else {
    // Check if vault exists to update UI
    if (!res.vaultExists) {
      if (elements.lockSubtitle) elements.lockSubtitle.textContent = 'Create a master password for your new vault';
      const unlockBtn = elements.unlockForm.querySelector('button');
      if (unlockBtn) {
        unlockBtn.innerHTML = '<svg class="icon" style="width:18px;height:18px;" viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg> Create Vault';
      }
    } else {
      if (elements.lockSubtitle) elements.lockSubtitle.textContent = 'Unlock your secure vault';
    }
    showLockScreen();
  }
  setupEventListeners();
}

function showLockScreen() {
  elements.lockScreen.classList.remove('hidden');
  elements.mainScreen.classList.add('hidden');
}

function showMainScreen() {
  elements.lockScreen.classList.add('hidden');
  elements.mainScreen.classList.remove('hidden');
  loadCodes();
  startTimer();
}

async function loadCodes() {
  const codesRes = await sendMessage({ type: 'GENERATE_ALL_TOTP' });
  const accountsRes = await sendMessage({ type: 'GET_ACCOUNTS' });
  if (codesRes.success && accountsRes.success) {
    codes = codesRes.data;
    accounts = accountsRes.accounts;
    renderCodes();
    if (codes.length > 0 && !selectedAccountId) selectAccount(codes[0].accountId);
    else if (codes.length === 0) {
      elements.emptyDetailState.classList.remove('hidden');
      elements.accountDetailView.classList.add('hidden');
    } else if (selectedAccountId) renderAccountDetail();
  }
}

function renderCodes(filter = '') {
  const filtered = filter ? codes.filter(c => (c.issuer + c.accountName + (c.username||'')).toLowerCase().includes(filter.toLowerCase())) : codes;
  elements.codeCount.textContent = `${filtered.length} accounts`;
  if (codes.length === 0) {
    elements.emptyState.classList.remove('hidden');
    elements.codesList.innerHTML = '';
    return;
  }
  elements.emptyState.classList.add('hidden');
  elements.codesList.innerHTML = filtered.map(code => {
    const sName = shortenUrl(code.issuer) || code.accountName || '🔐';
    const char = sName.charAt(0).toUpperCase();
    return `
      <div class="item-acc ${selectedAccountId === code.accountId ? 'active' : ''}" data-account-id="${code.accountId}">
        <div class="item-acc-icon" style="background: ${code.iconColor}">${char}</div>
        <div class="item-acc-info" style="flex:1;min-width:0;">
          <div class="item-acc-title">${escapeHtml(sName)}</div>
          <div class="item-acc-sub">${escapeHtml(code.username || code.accountName || '')}</div>
        </div>
      </div>
    `;
  }).join('');
  document.querySelectorAll('.item-acc').forEach(item => item.addEventListener('click', () => selectAccount(item.dataset.accountId)));
}

function selectAccount(id) {
  selectedAccountId = id;
  isDetailPasswordVisible = false;
  document.querySelectorAll('.item-acc').forEach(item => item.classList.toggle('active', item.dataset.accountId === id));
  renderAccountDetail();
}

function renderAccountDetail() {
  const code = codes.find(c => c.accountId === selectedAccountId);
  if (!code) {
    elements.emptyDetailState.classList.remove('hidden');
    elements.accountDetailView.classList.add('hidden');
    return;
  }
  elements.emptyDetailState.classList.add('hidden');
  elements.accountDetailView.classList.remove('hidden');

  const sName = shortenUrl(code.issuer) || code.accountName || '🔐';
  const char = sName.charAt(0).toUpperCase();
  const dUrl = code.issuer.length > 40 ? code.issuer.substring(0, 37) + '...' : code.issuer;

  elements.accountDetailView.innerHTML = `
    <div class="dt-view-container">
      <div class="dt-scroll-pane">
        <div class="dt-content-max">
          <header class="dt-header">
            <div class="dt-header-icon" style="background: ${code.iconColor}">${char}</div>
            <div class="dt-header-info">
              <h2 class="dt-header-title">${escapeHtml(sName)}</h2>
              <a href="${code.issuer}" target="_blank" class="dt-header-link" title="${escapeHtml(code.issuer)}">${escapeHtml(dUrl)} ${SVG.LINK}</a>
            </div>
          </header>

          <section class="dt-card">
            <div class="dt-card-head">
              <span class="dt-card-label">Credentials</span>
              <span class="dt-hint">Click field to copy</span>
            </div>

            <div class="dt-row">
              <label class="dt-label">Username</label>
              <div class="dt-click-box btn-copy" data-value="${code.username || ''}">
                <div class="dt-inner-val">
                  ${SVG.USER}
                  <span class="dt-val-text">${escapeHtml(code.username || 'Not set')}</span>
                </div>
                ${SVG.COPY}
              </div>
            </div>

            <div class="dt-row">
              <label class="dt-label">Password</label>
              <div class="dt-click-box">
                <div class="dt-inner-val btn-copy" data-value="${code.password || ''}" style="flex: 1;">
                  ${isDetailPasswordVisible ? escapeHtml(code.password) : '••••••••••••'}
                </div>
                <button class="box-action-btn btn-toggle-pass">${SVG.EYE}</button>
              </div>
            </div>

            ${code.code ? `
            <div class="dt-row" style="margin-top:20px;">
              <label class="dt-label">2FA Code</label>
              <div class="dt-click-box btn-copy" data-value="${code.code}">
                <div class="flex-between">
                  <span class="totp-large">${formatCode(code.code)}</span>
                  <div class="timer-wrap" data-account-id="${code.accountId}">
                    <svg viewBox="0 0 36 36">
                      <circle class="timer-bg" cx="18" cy="18" r="15"/>
                      <circle class="timer-prog" cx="18" cy="18" r="15" stroke-dasharray="94.2" stroke-dashoffset="0"/>
                    </svg>
                    <span class="timer-txt">${code.remainingTime}</span>
                  </div>
                </div>
              </div>
            </div>
            ` : ''}
          </section>
        </div>
      </div>
      <footer class="app-footer">
        <button class="btn-footer btn-footer-primary btn-autofill">${SVG.FLASH} Autofill</button>
        <button class="btn-footer btn-footer-secondary btn-edit-account">${SVG.EDIT} Edit</button>
        <button class="btn-footer btn-footer-danger btn-icon-only">${SVG.TRASH}</button>
      </footer>
    </div>
  `;
  attachDetailListeners();
  updateTimer();
}

function attachDetailListeners() {
  const view = elements.accountDetailView;
  view.querySelectorAll('.btn-copy').forEach(b => b.addEventListener('click', (e) => {
    e.stopPropagation();
    if (b.dataset.value) { copyToClipboard(b.dataset.value); showToast('Copied!'); }
  }));
  view.querySelector('.btn-toggle-pass')?.addEventListener('click', (e) => {
    e.stopPropagation();
    isDetailPasswordVisible = !isDetailPasswordVisible;
    renderAccountDetail();
  });
  view.querySelector('.btn-autofill')?.addEventListener('click', () => autofillAccount(selectedAccountId));
  view.querySelector('.btn-edit-account')?.addEventListener('click', () => openAccountPage(selectedAccountId));
  view.querySelector('.btn-delete-account')?.addEventListener('click', () => {
    if (confirm('Delete this account?')) deleteAccount(selectedAccountId);
  });
}

/** Timer Logic */
function startTimer() {
  if (timerInterval) clearInterval(timerInterval);
  updateTimer();
  timerInterval = setInterval(updateTimer, 1000);
}

function updateTimer() {
  let needsRefresh = false;
  codes.forEach(code => {
    if (!code.code) return;
    if (code.remainingTime > 0) code.remainingTime--;
    else needsRefresh = true;
    if (code.accountId === selectedAccountId) {
      const timerEl = document.querySelector(`.timer-wrap[data-account-id="${code.accountId}"]`);
      if (timerEl) {
        const period = code.period || 30;
        const offset = 94.2 - (code.remainingTime / period) * 94.2;
        timerEl.querySelector('.timer-prog').style.strokeDashoffset = offset;
        timerEl.querySelector('.timer-txt').textContent = code.remainingTime;
        const valEl = document.querySelector('.totp-large');
        if (valEl) valEl.textContent = formatCode(code.code);
      }
    }
  });
  if (needsRefresh) loadCodes();
}

/** Event Listeners Setup */
function setupEventListeners() {
  elements.unlockForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const res = await sendMessage({ type: 'UNLOCK_VAULT', password: elements.unlockPassword.value });
    if (res.success) {
      currentPassword = elements.unlockPassword.value;
      await chrome.storage.session.set({ masterPassword: currentPassword });
      showMainScreen();
    } else elements.unlockError.textContent = res.error || 'Invalid password';
  });

  elements.resetVault.addEventListener('click', async (e) => {
    e.preventDefault();
    if (confirm('RESET ALL DATA?')) {
      const res = await sendMessage({ type: 'RESET_VAULT' });
      if (res.success) location.reload();
    }
  });

  elements.lockBtn.addEventListener('click', async () => {
    await sendMessage({ type: 'LOCK_VAULT' });
    currentPassword = ''; selectedAccountId = null; showLockScreen();
  });

  elements.addAccountManualBtn.addEventListener('click', () => openAccountPage());
  elements.scanQrBtn.addEventListener('click', openQRPage);
  elements.settingsBtn.addEventListener('click', () => chrome.runtime.openOptionsPage());
  elements.searchInput.addEventListener('input', (e) => renderCodes(e.target.value));
  elements.emptyAddBtn.addEventListener('click', () => openAccountPage());
  elements.emptyScanBtn.addEventListener('click', openQRPage);
  elements.emptyImportBtn?.addEventListener('click', openImportPage);
  elements.emptySettingsBtn?.addEventListener('click', () => chrome.runtime.openOptionsPage());

  elements.backToMain.addEventListener('click', closeAccountPage);
  elements.backToMainQr.addEventListener('click', closeQRPage);
  elements.backToMainImport?.addEventListener('click', closeImportPage);
  elements.pageCancelBtn.addEventListener('click', closeAccountPage);
  elements.startScanBtn.addEventListener('click', startQRScanner);
  elements.qrUpload.addEventListener('change', handleQRUpload);
  elements.accountFormPage.addEventListener('submit', saveAccount);

  elements.pageTogglePassword.addEventListener('click', () => {
    const type = elements.pageAccountPassword.type === 'password' ? 'text' : 'password';
    elements.pageAccountPassword.type = type;
  });
  elements.toggleSecret.addEventListener('click', () => {
    const type = elements.pageAccountSecret.type === 'password' ? 'text' : 'password';
    elements.pageAccountSecret.type = type;
  });

  // Import Listeners
  elements.selectImportBtn?.addEventListener('click', () => elements.importFileInput.click());
  elements.importFileInput?.addEventListener('change', handleImportFile);
  elements.confirmImportBtn?.addEventListener('click', processVaultImport);
}

/** Import Flow */
function openImportPage() { elements.importPage.classList.remove('hidden'); elements.mainScreen.classList.add('hidden'); }
function closeImportPage() { 
  elements.importPage.classList.add('hidden'); elements.mainScreen.classList.remove('hidden'); 
  pendingImportData = null; elements.importVerifySection.classList.add('hidden');
}

async function handleImportFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    if (!data.accounts || !data.masterHash) { showToast('Invalid backup file'); return; }
    pendingImportData = data;
    elements.importVerifySection.classList.remove('hidden');
    elements.importMasterPassword.focus();
  } catch { showToast('Error reading file'); }
}

async function processVaultImport() {
  const password = elements.importMasterPassword.value;
  if (!password) return;
  const res = await sendMessage({ type: 'IMPORT_VAULT', data: pendingImportData, password });
  if (res.success) {
    currentPassword = password;
    await chrome.storage.session.set({ masterPassword: password });
    
    closeImportPage();
    
    // Refresh initialization to load new data and show main screen
    await init();
    
    showToast('Vault restored!');
  } else { elements.importError.textContent = res.error || 'Import failed'; }
}

/** Account Page Logic */
async function openAccountPage(accountId = null) {
  editingAccountId = accountId;
  originalSecret = null;
  elements.accountPage.classList.remove('hidden');
  elements.mainScreen.classList.add('hidden');
  if (accountId) {
    const a = accounts.find(a => a.id === accountId);
    if (a) {
      elements.pageTitle.textContent = 'Edit Account';
      elements.pageAccountIssuer.value = a.issuer || '';
      elements.pageAccountUsername.value = a.username || '';
      elements.pageAccountPassword.value = a.password || '';
      if (a.secret) { originalSecret = a.secret; elements.pageAccountSecret.type = 'password'; elements.pageAccountSecret.value = '••••••••••••••••••••••••'; }
      elements.pageAccountDigits.value = a.digits || 6;
      elements.pageAccountPeriod.value = a.period || 30;
    }
  } else {
    elements.pageTitle.textContent = 'Add Account';
    elements.accountFormPage.reset();
    try { const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }); if (tab) elements.pageAccountIssuer.value = tab.url; } catch {}
  }
}

function closeAccountPage() { elements.accountPage.classList.add('hidden'); elements.mainScreen.classList.remove('hidden'); editingAccountId = null; }
function openQRPage() { elements.qrPage.classList.remove('hidden'); elements.mainScreen.classList.add('hidden'); }
function closeQRPage() { elements.qrPage.classList.add('hidden'); elements.mainScreen.classList.remove('hidden'); stopQRScanner(); }

async function startQRScanner() {
  qrScanner = new QRScanner(); await qrScanner.init(elements.qrVideo);
  qrStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
  elements.qrVideo.srcObject = qrStream;
  elements.qrVideo.onloadedmetadata = () => { elements.qrVideo.play(); qrScanner.start(handleQRCode); };
}

function stopQRScanner() { if (qrScanner) qrScanner.stop(); if (qrStream) qrStream.getTracks().forEach(t => t.stop()); qrScanner = null; qrStream = null; }

async function handleQRCode(data) {
  const parsed = QRScanner.parseOTPAuth(data);
  if (parsed && parsed.secret) { stopQRScanner(); await openAccountPage(); elements.pageAccountSecret.value = parsed.secret; elements.pageAccountIssuer.value = parsed.issuer || parsed.accountName; elements.pageAccountUsername.value = parsed.accountName; }
}

async function handleQRUpload(e) { const f = e.target.files[0]; if (f) { const s = new QRScanner(); const d = await s.scanFromFile(f); if (d) handleQRCode(d); } }

async function saveAccount(e) {
  e.preventDefault();
  let secret = elements.pageAccountSecret.value.trim();
  if (editingAccountId && secret.startsWith('•')) secret = originalSecret; else secret = secret.toUpperCase().replace(/\s/g, '');
  const response = await sendMessage({
    type: editingAccountId ? 'UPDATE_ACCOUNT' : 'ADD_ACCOUNT',
    id: editingAccountId,
    account: {
      issuer: elements.pageAccountIssuer.value.trim(),
      accountName: elements.pageAccountUsername.value.trim() || 'Unknown',
      secret,
      digits: parseInt(elements.pageAccountDigits.value),
      period: parseInt(elements.pageAccountPeriod.value),
      username: elements.pageAccountUsername.value.trim(),
      password: elements.pageAccountPassword.value
    },
    password: currentPassword || (await chrome.storage.session.get('masterPassword')).masterPassword
  });
  if (response.success) { closeAccountPage(); loadCodes(); }
}

async function deleteAccount(id) {
  const p = currentPassword || (await chrome.storage.session.get('masterPassword')).masterPassword;
  if ((await sendMessage({ type: 'DELETE_ACCOUNT', id, password: p })).success) { if (selectedAccountId === id) selectedAccountId = null; loadCodes(); }
}

async function autofillAccount(id) {
  const a = accounts.find(a => a.id === id);
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let code = ''; if (a.secret) { const r = await sendMessage({ type: 'GENERATE_TOTP', accountId: id }); if (r.success) code = r.data.code; }
  chrome.tabs.sendMessage(tab.id, { type: 'AUTOFILL_CREDENTIALS', data: { username: a.username || '', password: a.password || '', totpCode: code } }).catch(() => {
    chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] }).then(() => {
      chrome.tabs.sendMessage(tab.id, { type: 'AUTOFILL_CREDENTIALS', data: { username: a.username || '', password: a.password || '', totpCode: code } });
    });
  });
  window.close();
}

function formatCode(c) { return c && c.length === 6 ? `${c.slice(0, 3)} ${c.slice(3)}` : c; }
function copyToClipboard(t) { navigator.clipboard.writeText(t); }
function sendMessage(m) { return new Promise(r => chrome.runtime.sendMessage(m, r)); }
function showToast(m) { elements.toastMessage.textContent = m; elements.toast.classList.remove('hidden'); setTimeout(() => elements.toast.classList.add('hidden'), 2000); }
function escapeHtml(t) { const d = document.createElement('div'); d.textContent = t || ''; return d.innerHTML; }
function shortenUrl(u) { try { return new URL(u).hostname.replace('www.', ''); } catch { return u; } }

init();
