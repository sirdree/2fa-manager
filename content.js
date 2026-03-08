/**
 * Content Script for 2FA Manager Extension
 * Re-implemented with Robust Detection and Premium Theme
 */

let detectedForms = [];
let hasCredentialsForPage = false;
let accountData = null;
let accountsForPage = [];
let autofillButton = null;
let submittedCredentials = null;

const THEME = {
  bg: 'rgb(28, 33, 40)',
  card: 'rgb(34, 40, 49)',
  hover: 'rgb(40, 48, 58)',
  border: 'rgb(95, 95, 135)',
  primary: '#4CAF50',
  secondary: '#2196F3',
  danger: '#ef5350',
  warning: '#FF9800',
  text: '#ffffff',
  textDim: '#b0b0b0'
};

function init() {
  const check = () => {
    detectForms();
    checkPageCredentials();
    checkPendingCredentials();
  };
  
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(check, 1000);
  } else {
    document.addEventListener('DOMContentLoaded', () => setTimeout(check, 1000));
  }
  
  observeDOMChanges();
  chrome.runtime.onMessage.addListener(handleMessage);
}

/** 
 * FORM DETECTION - Robust Re-implementation
 */
function detectForms() {
  detectedForms = [];
  const passwordInputs = document.querySelectorAll('input[type="password"]');

  passwordInputs.forEach(passInput => {
    let form = passInput.closest('form');
    let userInput = null;

    if (form) {
      userInput = form.querySelector('input[type="text"], input[type="email"], input:not([type]), input[name*="user"], input[name*="login"]');
    } else {
      // Look for siblings if no form tag
      const parent = passInput.parentElement;
      userInput = parent.querySelector('input[type="text"], input[type="email"]');
      if (!userInput && parent.parentElement) {
        userInput = parent.parentElement.querySelector('input[type="text"], input[type="email"]');
      }
    }

    if (userInput && userInput !== passInput) {
      const formInfo = {
        form,
        passwordInput: passInput,
        usernameInput: userInput,
        totpInput: document.querySelector('input[name*="otp"], input[id*="otp"], input[autocomplete="one-time-code"]'),
        type: 'login'
      };
      detectedForms.push(formInfo);

      // Attach listener
      const target = form || userInput.parentElement;
      if (target && !target.hasAttribute('data-2fa-monitored')) {
        target.setAttribute('data-2fa-monitored', 'true');
        target.addEventListener('submit', () => captureCredentials(userInput, passInput), true);
        // Also catch button clicks for non-form logins
        const btn = target.querySelector('button, input[type="button"], input[type="submit"]');
        if (btn) btn.addEventListener('click', () => captureCredentials(userInput, passInput));
      }
    }
  });

  // 2FA Only Detection
  if (passwordInputs.length === 0) {
    const otp = document.querySelector('input[name*="otp"], input[id*="otp"], input[autocomplete="one-time-code"]');
    if (otp) {
      detectedForms.push({ form: null, passwordInput: null, usernameInput: null, totpInput: otp, type: '2fa' });
    }
  }
}

function captureCredentials(userEl, passEl) {
  if (!userEl.value || !passEl.value) return;
  const data = {
    username: userEl.value,
    password: passEl.value,
    url: window.location.href,
    timestamp: Date.now()
  };
  chrome.storage.local.set({ 'pending_save_credentials': data });
}

async function checkPendingCredentials() {
  const res = await chrome.storage.local.get('pending_save_credentials');
  const pending = res.pending_save_credentials;
  
  if (!pending) return;
  
  // If we are on the exact same page we just submitted, wait (login might still be processing)
  if (pending.url === window.location.href && (Date.now() - pending.timestamp < 3000)) return;

  // Don't show if too old
  if (Date.now() - pending.timestamp > 300000) {
    chrome.storage.local.remove('pending_save_credentials');
    return;
  }

  const status = await chrome.runtime.sendMessage({ type: 'GET_STATUS' });
  if (!status || !status.unlocked) return;

  // Check if we already have this account
  const domain = new URL(pending.url).hostname.replace('www.', '');
  const existing = await chrome.runtime.sendMessage({ type: 'FIND_ALL_ACCOUNTS', domain });
  
  const alreadySaved = existing.accounts?.some(a => (a.username||'').toLowerCase() === pending.username.toLowerCase());
  if (alreadySaved) {
    chrome.storage.local.remove('pending_save_credentials');
    return;
  }

  submittedCredentials = pending;
  showSaveCredentialsPrompt();
}

/** 
 * UI - Premium Theme Injection
 */
function injectStyles() {
  if (document.getElementById('two-fa-styles')) return;
  const style = document.createElement('style');
  style.id = 'two-fa-styles';
  style.textContent = `
    .two-fa-floating-btn {
      position: fixed !important; bottom: 24px !important; right: 24px !important; z-index: 2147483647 !important;
      display: flex; align-items: center; gap: 8px; padding: 10px 20px;
      background: ${THEME.primary}; color: white !important; border-radius: 50px;
      font-family: system-ui, -apple-system, sans-serif; font-size: 13px; font-weight: 700;
      cursor: pointer; box-shadow: 0 8px 24px rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.1);
      transition: 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    }
    .two-fa-ui-box {
      position: fixed !important; bottom: 24px !important; right: 24px !important; width: 320px !important; z-index: 2147483647 !important;
      background: ${THEME.card} !important; border: 1px solid ${THEME.border} !important; border-radius: 12px !important;
      box-shadow: 0 12px 48px rgba(0,0,0,0.6) !important; font-family: system-ui, sans-serif !important; overflow: hidden;
      color: white !important; animation: two-fa-pop 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
    }
    @keyframes two-fa-pop { from { opacity: 0; transform: translateY(20px) scale(0.95); } to { opacity: 1; transform: translateY(0) scale(1); } }
    .two-fa-ui-header { padding: 16px; border-bottom: 1px solid ${THEME.border}; display: flex; align-items: center; background: ${THEME.primary}; color: white; }
    .two-fa-ui-body { padding: 16px; background: ${THEME.card}; }
    .two-fa-ui-row { display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 13px; color: ${THEME.textDim}; }
    .two-fa-ui-val { color: white; font-weight: 600; text-align: right; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 180px; }
    .two-fa-btn {
      width: 100%; padding: 10px; border-radius: 6px; border: none; font-weight: 700; font-size: 13px;
      cursor: pointer; transition: 0.2s; display: flex; align-items: center; justify-content: center; gap: 8px;
    }
    .two-fa-btn-primary { background: ${THEME.primary}; color: white; }
    .two-fa-btn-secondary { background: ${THEME.hover}; color: white; border: 1px solid ${THEME.border}; }
    .two-fa-btn:hover { opacity: 0.9; }
    .two-fa-notification {
      position: fixed !important; top: 24px !important; right: 24px !important; z-index: 2147483647 !important;
      background: ${THEME.card}; color: white; border: 1px solid ${THEME.border};
      padding: 12px 20px; border-radius: 8px; font-size: 14px; font-weight: 600;
      box-shadow: 0 8px 24px rgba(0,0,0,0.4); animation: two-fa-slide 0.3s ease;
    }
    @keyframes two-fa-slide { from { transform: translateX(100%); } to { transform: translateX(0); } }
  `;
  document.head.appendChild(style);
}

function showSaveCredentialsPrompt() {
  injectStyles();
  const existing = document.querySelector('.two-fa-save-prompt');
  if (existing) existing.remove();

  const box = document.createElement('div');
  box.className = 'two-fa-ui-box two-fa-save-prompt';
  box.innerHTML = `
    <div class="two-fa-ui-header">
      <strong style="flex:1;">Save to 2FA Manager?</strong>
      <span class="close-ui" style="cursor:pointer; font-size:20px;">×</span>
    </div>
    <div class="two-fa-ui-body">
      <div class="two-fa-ui-row"><span>Username</span><span class="two-fa-ui-val">${escapeHtml(submittedCredentials.username)}</span></div>
      <div class="two-fa-ui-row"><span>Password</span><span class="two-fa-ui-val">••••••••</span></div>
      <div style="display:flex; gap:8px; margin-top:16px;">
        <button class="two-fa-btn two-fa-btn-secondary" id="save-never">Never</button>
        <button class="two-fa-btn two-fa-btn-primary" id="save-confirm">Save</button>
      </div>
      <button class="two-fa-btn" id="save-not-now" style="margin-top:8px; background:transparent; color:${THEME.textDim};">Not now</button>
    </div>
  `;
  document.body.appendChild(box);

  box.querySelector('.close-ui').onclick = () => { box.remove(); chrome.storage.local.remove('pending_save_credentials'); };
  box.querySelector('#save-not-now').onclick = () => { box.remove(); chrome.storage.local.remove('pending_save_credentials'); };
  box.querySelector('#save-never').onclick = () => {
    const domain = new URL(submittedCredentials.url).hostname.replace('www.', '');
    chrome.runtime.sendMessage({ type: 'ADD_TO_NEVER_SAVE', domain });
    box.remove();
    chrome.storage.local.remove('pending_save_credentials');
  };
  box.querySelector('#save-confirm').onclick = async () => {
    const res = await chrome.runtime.sendMessage({ type: 'SAVE_CREDENTIALS', credentials: submittedCredentials });
    if (res.success) {
      showNotification('✓ Saved to vault!');
      box.remove();
      chrome.storage.local.remove('pending_save_credentials');
      checkPageCredentials();
    }
  };
}

async function checkPageCredentials() {
  detectForms();
  const domain = window.location.hostname.replace('www.', '');
  
  const res = await chrome.runtime.sendMessage({ type: 'FIND_ALL_ACCOUNTS', domain });
  
  // Show button ONLY if we have accounts AND we found a form on the page
  if (res.success && res.accounts?.length > 0 && detectedForms.length > 0) {
    hasCredentialsForPage = true;
    accountsForPage = res.accounts;
    accountData = res.accounts[0];
    showAutofillButton();
    chrome.runtime.sendMessage({ type: 'SET_BADGE', hasCredentials: true });
  } else {
    hasCredentialsForPage = false;
    removeAutofillButton();
    chrome.runtime.sendMessage({ type: 'SET_BADGE', hasCredentials: false });
  }
}

function showAutofillButton() {
  injectStyles();
  removeAutofillButton();
  const btn = document.createElement('div');
  btn.className = 'two-fa-floating-btn';
  btn.innerHTML = `<span>Autofill</span>`;
  document.body.appendChild(btn);
  autofillButton = btn;
  btn.onclick = () => {
    if (accountsForPage.length > 1) showAccountSelection();
    else autofillCredentials();
  };
}

function removeAutofillButton() { if (autofillButton) autofillButton.remove(); autofillButton = null; }

function showAccountSelection() {
  injectStyles();
  const box = document.createElement('div');
  box.className = 'two-fa-ui-box';
  box.innerHTML = `
    <div class="two-fa-ui-header"><strong>Select Account</strong></div>
    <div class="two-fa-ui-body">
      ${accountsForPage.map((acc, i) => `
        <div class="acc-item" data-i="${i}" style="padding:10px; background:${THEME.hover}; border-radius:6px; margin-bottom:6px; cursor:pointer;">
          <div style="font-weight:700;">${escapeHtml(acc.username || acc.accountName)}</div>
        </div>
      `).join('')}
    </div>
  `;
  document.body.appendChild(box);
  box.querySelectorAll('.acc-item').forEach(item => {
    item.onclick = () => { accountData = accountsForPage[item.dataset.i]; autofillCredentials(); box.remove(); };
  });
}

function autofillCredentials() {
  if (!accountData || detectedForms.length === 0) return;
  const form = detectedForms[0];
  if (form.usernameInput) fillInput(form.usernameInput, accountData.username);
  if (form.passwordInput) fillInput(form.passwordInput, accountData.password);
  showNotification('Credentials filled!');
}

function fillInput(el, val) {
  el.value = val;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

function showNotification(msg) {
  injectStyles();
  const n = document.createElement('div');
  n.className = 'two-fa-notification';
  n.textContent = msg;
  document.body.appendChild(n);
  setTimeout(() => n.remove(), 3000);
}

function escapeHtml(t) { const d = document.createElement('div'); d.textContent = t || ''; return d.innerHTML; }
let checkTimeout = null;
function observeDOMChanges() {
  const observer = new MutationObserver(() => {
    if (checkTimeout) clearTimeout(checkTimeout);
    checkTimeout = setTimeout(() => {
      checkPageCredentials();
    }, 500);
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

function handleMessage(msg, sender, sendResponse) {
  if (msg.type === 'AUTOFILL_CREDENTIALS') {
    accountData = msg.data;
    autofillCredentials();
    sendResponse({ success: true });
  }
  return true;
}

init();
