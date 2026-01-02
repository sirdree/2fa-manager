/**
 * Content Script for 2FA Manager Extension
 * Detects login forms and provides autofill functionality
 */

// State
let detectedForms = [];
let hasCredentialsForPage = false;
let accountData = null;
let accountsForPage = []; // All accounts for current page (for multi-account support)
let autofillButton = null;
let submittedCredentials = null; // Track submitted credentials for save prompt

/**
 * Initialize content script
 */
function init() {
  // Wait for page to load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      setTimeout(checkPageCredentials, 500);
      setTimeout(detectForms, 500);
      // Check for pending credentials from previous page
      setTimeout(checkPendingCredentials, 1000);
    });
  } else {
    setTimeout(checkPageCredentials, 500);
    setTimeout(detectForms, 500);
    // Check for pending credentials from previous page
    setTimeout(checkPendingCredentials, 1000);
  }

  // Watch for DOM changes
  observeDOMChanges();

  // Listen for messages from background/popup
  chrome.runtime.onMessage.addListener(handleMessage);
}

/**
 * Check if we have credentials for this page
 */
async function checkPageCredentials() {
  // First detect forms to see what's on the page
  detectForms();

  // If no forms detected, remove button and clear badge
  if (detectedForms.length === 0) {
    hasCredentialsForPage = false;
    accountData = null;
    accountsForPage = [];
    removeAutofillButton();
    chrome.runtime.sendMessage({
      type: 'SET_BADGE',
      hasCredentials: false
    });
    return;
  }

  const domain = window.location.hostname.replace('www.', '');

  // Check if domain is in "never save" list
  const neverSaveResponse = await chrome.runtime.sendMessage({
    type: 'IS_NEVER_SAVE',
    domain
  });

  if (neverSaveResponse.success && neverSaveResponse.neverSave) {
    // Domain is in never save list, don't offer to save
    hasCredentialsForPage = false;
    accountData = null;
    accountsForPage = [];
    removeAutofillButton();
    chrome.runtime.sendMessage({
      type: 'SET_BADGE',
      hasCredentials: false
    });
    return;
  }

  // Get ALL accounts for this domain
  const response = await chrome.runtime.sendMessage({
    type: 'FIND_ALL_ACCOUNTS',
    domain
  });

  if (response.success && response.accounts && response.accounts.length > 0) {
    hasCredentialsForPage = true;
    accountsForPage = response.accounts;
    accountData = response.accounts[0]; // Keep first account for backward compatibility

    // Show floating autofill button only if there's a form
    showAutofillButton();

    // Set badge to show we have credentials
    chrome.runtime.sendMessage({
      type: 'SET_BADGE',
      hasCredentials: true
    });
  } else {
    hasCredentialsForPage = false;
    accountData = null;
    accountsForPage = [];
    removeAutofillButton();

    // Clear badge
    chrome.runtime.sendMessage({
      type: 'SET_BADGE',
      hasCredentials: false
    });
  }
}

/**
 * Show floating autofill button
 */
function showAutofillButton() {
  // Determine button type based on forms and account count
  const is2FAPage = detectedForms.length > 0 && detectedForms[0].type === '2fa' && detectedForms[0].totpInput;
  const hasMultipleAccounts = accountsForPage.length > 1;

  // Remove existing button
  removeAutofillButton();

  const button = document.createElement('div');
  button.className = 'two-fa-autofill-floating-btn';

  if (is2FAPage) {
    // 2FA page - show "2FA available"
    button.classList.add('two-fa-2fa-mode');
    button.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
        <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
      </svg>
      <span>2FA Available</span>
    `;
  } else if (hasMultipleAccounts) {
    // Multiple accounts - show "Multi-account"
    button.classList.add('two-fa-multi-mode');
    button.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
        <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
      </svg>
      <span>Autofill (${accountsForPage.length})</span>
    `;
  } else {
    // Login page - show "Autofill"
    button.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
        <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
      </svg>
      <span>Autofill</span>
    `;
  }

  // Add styles
  if (!document.querySelector('#two-fa-floating-btn-styles')) {
    const style = document.createElement('style');
    style.id = 'two-fa-floating-btn-styles';
    style.textContent = `
      .two-fa-autofill-floating-btn {
        position: fixed;
        bottom: 20px;
        right: 20px;
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 10px 16px;
        background: #4CAF50;
        color: white;
        border-radius: 8px;
        font-size: 13px;
        font-weight: 500;
        cursor: pointer;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
        z-index: 999999;
        transition: all 0.2s;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      }

      .two-fa-autofill-floating-btn:hover {
        background: #388E3C;
        transform: translateY(-2px);
        box-shadow: 0 6px 16px rgba(0, 0, 0, 0.4);
      }

      .two-fa-autofill-floating-btn.two-fa-2fa-mode {
        background: #FF9800;
      }

      .two-fa-autofill-floating-btn.two-fa-2fa-mode:hover {
        background: #F57C00;
      }

      .two-fa-autofill-floating-btn.two-fa-multi-mode {
        background: #2196F3;
      }

      .two-fa-autofill-floating-btn.two-fa-multi-mode:hover {
        background: #1976D2;
      }

      .two-fa-autofill-floating-btn svg {
        flex-shrink: 0;
      }

      @keyframes two-fa-btn-slideIn {
        from {
          opacity: 0;
          transform: translateY(20px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }

      .two-fa-autofill-floating-btn {
        animation: two-fa-btn-slideIn 0.3s ease;
      }
    `;
    document.head.appendChild(style);
  }

  document.body.appendChild(button);
  autofillButton = button;

  // Click handler
  button.addEventListener('click', () => {
    if (is2FAPage) {
      autofill2FADirectly();
    } else if (hasMultipleAccounts) {
      showAccountSelectionPopup();
    } else {
      autofillCredentials();
    }
  });
}

/**
 * Remove autofill button
 */
function removeAutofillButton() {
  if (autofillButton) {
    autofillButton.remove();
    autofillButton = null;
  }
  // Also remove any that might be in DOM
  document.querySelectorAll('.two-fa-autofill-floating-btn').forEach(btn => btn.remove());
}

/**
 * Show account selection popup for multi-account autofill
 */
async function showAccountSelectionPopup() {
  // Remove existing popup
  const existing = document.querySelector('.two-fa-account-selection-popup');
  if (existing) existing.remove();

  const popup = document.createElement('div');
  popup.className = 'two-fa-account-selection-popup';

  // Build account list HTML
  const accountsListHtml = accountsForPage.map((acc, index) => {
    const username = acc.username || acc.accountName || 'Unknown';
    return `
      <div class="two-fa-account-item" data-account-index="${index}">
        <div class="two-fa-account-icon">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
          </svg>
        </div>
        <div class="two-fa-account-info">
          <div class="two-fa-account-username">${escapeHtml(username)}</div>
          <div class="two-fa-account-details">${acc.secret ? 'Has 2FA' : 'Credentials only'}</div>
        </div>
        <div class="two-fa-account-arrow">→</div>
      </div>
    `;
  }).join('');

  popup.innerHTML = `
    <div class="two-fa-account-selection-content">
      <div class="two-fa-account-selection-header">
        <span class="two-fa-account-selection-icon">🔑</span>
        <span class="two-fa-account-selection-title">Multi-account autofill</span>
        <button class="two-fa-account-selection-close" title="Close">×</button>
      </div>
      <div class="two-fa-account-list">
        ${accountsListHtml}
      </div>
    </div>
  `;

  // Add styles if not exists
  if (!document.querySelector('#two-fa-account-selection-styles')) {
    const style = document.createElement('style');
    style.id = 'two-fa-account-selection-styles';
    style.textContent = `
      .two-fa-account-selection-popup {
        position: fixed;
        bottom: 80px;
        right: 20px;
        width: 320px;
        max-height: 400px;
        background: #2d2d2d;
        border: 1px solid #404040;
        border-radius: 12px;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
        z-index: 999999;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        animation: two-fa-accountSlideUp 0.3s ease;
      }

      @keyframes two-fa-accountSlideUp {
        from {
          opacity: 0;
          transform: translateY(20px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }

      .two-fa-account-selection-content {
        color: #e0e0e0;
      }

      .two-fa-account-selection-header {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 16px;
        border-bottom: 1px solid #404040;
      }

      .two-fa-account-selection-icon {
        font-size: 18px;
      }

      .two-fa-account-selection-title {
        flex: 1;
        font-size: 15px;
        font-weight: 600;
      }

      .two-fa-account-selection-close {
        background: transparent;
        border: none;
        color: #a0a0a0;
        font-size: 24px;
        cursor: pointer;
        padding: 0;
        width: 24px;
        height: 24px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 4px;
        transition: all 0.2s;
      }

      .two-fa-account-selection-close:hover {
        background: #3d3d3d;
        color: #e0e0e0;
      }

      .two-fa-account-list {
        max-height: 300px;
        overflow-y: auto;
        padding: 8px;
      }

      .two-fa-account-item {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 12px;
        border-radius: 8px;
        cursor: pointer;
        transition: all 0.2s;
        background: #1e1e1e;
        margin-bottom: 8px;
      }

      .two-fa-account-item:hover {
        background: #3d3d3d;
      }

      .two-fa-account-item:last-child {
        margin-bottom: 0;
      }

      .two-fa-account-icon {
        width: 32px;
        height: 32px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: #2196F3;
        border-radius: 6px;
        color: white;
        flex-shrink: 0;
      }

      .two-fa-account-info {
        flex: 1;
        min-width: 0;
      }

      .two-fa-account-username {
        font-size: 14px;
        font-weight: 500;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .two-fa-account-details {
        font-size: 12px;
        color: #a0a0a0;
        margin-top: 2px;
      }

      .two-fa-account-arrow {
        font-size: 18px;
        color: #a0a0a0;
        flex-shrink: 0;
      }

      .two-fa-account-item:hover .two-fa-account-arrow {
        color: #2196F3;
      }
    `;
    document.head.appendChild(style);
  }

  document.body.appendChild(popup);

  // Close button
  const closeBtn = popup.querySelector('.two-fa-account-selection-close');
  closeBtn.addEventListener('click', () => {
    popup.remove();
  });

  // Account items
  const accountItems = popup.querySelectorAll('.two-fa-account-item');
  accountItems.forEach(item => {
    item.addEventListener('click', () => {
      const accountIndex = parseInt(item.getAttribute('data-account-index'));
      const selectedAccount = accountsForPage[accountIndex];
      autofillSelectedAccount(selectedAccount);
      popup.remove();
    });
  });

  // Auto-hide after 30 seconds
  setTimeout(() => {
    if (document.body.contains(popup)) {
      popup.remove();
    }
  }, 30000);
}

/**
 * Autofill selected account from multi-account list
 */
async function autofillSelectedAccount(account) {
  if (!account || detectedForms.length === 0) {
    showNotification('No form detected on this page');
    return;
  }

  const formInfo = detectedForms[0];

  // Check if this is a 2FA-only page
  if (formInfo.type === '2fa' && formInfo.totpInput) {
    // For 2FA-only pages, generate and fill 2FA code
    if (!account.secret) {
      showNotification('No 2FA code saved for this account');
      return;
    }

    const codeResponse = await chrome.runtime.sendMessage({
      type: 'GENERATE_TOTP',
      accountId: account.id
    });

    if (!codeResponse.success || !codeResponse.data.code) {
      showNotification('Failed to generate 2FA code');
      return;
    }

    fillInput(formInfo.totpInput, codeResponse.data.code);
    highlightFilledFields(formInfo);
    showNotification('2FA code filled!');
    return;
  }

  // Regular login page - fill username/password
  if (formInfo.usernameInput && account.username) {
    fillInput(formInfo.usernameInput, account.username);
  }

  if (formInfo.passwordInput && account.password) {
    fillInput(formInfo.passwordInput, account.password);
  }

  focusNextField(formInfo);
  highlightFilledFields(formInfo);
  showNotification('Credentials filled!');

  // Check if there's a 2FA field on the same page and we have a 2FA code
  if (formInfo.totpInput && account.secret) {
    setTimeout(() => {
      show2FAQuickPromptForAccount(formInfo.totpInput, account);
    }, 500);
  }
}

/**
 * Show 2FA quick prompt for specific account
 */
async function show2FAQuickPromptForAccount(targetInput, account) {
  const codeResponse = await chrome.runtime.sendMessage({
    type: 'GENERATE_TOTP',
    accountId: account.id
  });

  if (!codeResponse.success || !codeResponse.data.code) return;

  const code = codeResponse.data.code;

  // Remove existing 2FA prompt
  const existing = document.querySelector('.two-fa-quick-prompt');
  if (existing) existing.remove();

  // Find position for the prompt (near the 2FA input)
  const inputRect = targetInput.getBoundingClientRect();
  const prompt = document.createElement('div');
  prompt.className = 'two-fa-quick-prompt';
  prompt.innerHTML = `
    <div class="two-fa-prompt-header">
      <span class="two-fa-prompt-icon">🔐</span>
      <span class="two-fa-prompt-text">2FA code available</span>
    </div>
    <div class="two-fa-prompt-actions">
      <button class="two-fa-prompt-btn two-fa-prompt-cancel">Cancel</button>
      <button class="two-fa-prompt-btn two-fa-prompt-use">Autofill</button>
    </div>
  `;

  // Position prompt above the 2FA input
  const promptTop = Math.max(10, inputRect.top - 70);
  const promptLeft = Math.max(10, Math.min(inputRect.left, window.innerWidth - 260));

  // Add styles if not exists
  if (!document.querySelector('#two-fa-quick-prompt-styles')) {
    const style = document.createElement('style');
    style.id = 'two-fa-quick-prompt-styles';
    style.textContent = `
      .two-fa-quick-prompt {
        position: fixed;
        min-width: 200px;
        background: #2d2d2d;
        border: 1px solid #404040;
        border-radius: 8px;
        padding: 12px;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
        z-index: 999999;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        animation: two-fa-quickFadeIn 0.2s ease;
      }

      @keyframes two-fa-quickFadeIn {
        from {
          opacity: 0;
          transform: translateY(-5px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }

      .two-fa-prompt-header {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 10px;
        color: #e0e0e0;
        font-size: 13px;
      }

      .two-fa-prompt-icon {
        font-size: 16px;
      }

      .two-fa-prompt-text {
        flex: 1;
      }

      .two-fa-prompt-actions {
        display: flex;
        gap: 8px;
      }

      .two-fa-prompt-btn {
        flex: 1;
        padding: 8px 12px;
        border: none;
        border-radius: 4px;
        font-size: 12px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s;
      }

      .two-fa-prompt-cancel {
        background: #3d3d3d;
        color: #e0e0e0;
      }

      .two-fa-prompt-cancel:hover {
        background: #4d4d4d;
      }

      .two-fa-prompt-use {
        background: #4CAF50;
        color: white;
      }

      .two-fa-prompt-use:hover {
        background: #388E3C;
      }
    `;
    document.head.appendChild(style);
  }

  prompt.style.top = promptTop + 'px';
  prompt.style.left = promptLeft + 'px';

  document.body.appendChild(prompt);

  // Cancel button
  const cancelBtn = prompt.querySelector('.two-fa-prompt-cancel');
  cancelBtn.addEventListener('click', () => {
    prompt.remove();
  });

  // Use button
  const useBtn = prompt.querySelector('.two-fa-prompt-use');
  useBtn.addEventListener('click', () => {
    fillInput(targetInput, code);
    prompt.remove();
    showNotification('2FA code filled!');
  });

  // Auto-hide after 10 seconds
  setTimeout(() => {
    if (document.body.contains(prompt)) {
      prompt.remove();
    }
  }, 10000);
}

/**
 * Autofill credentials from stored account
 */
async function autofillCredentials() {
  if (!accountData || detectedForms.length === 0) {
    showNotification('No form detected on this page');
    return;
  }

  const formInfo = detectedForms[0];

  // Check if this is a 2FA-only page
  if (formInfo.type === '2fa' && formInfo.totpInput) {
    // Directly show 2FA prompt for 2FA-only pages
    await show2FAQuickPrompt(formInfo.totpInput);
    return;
  }

  // Regular login page - fill username/password
  // Fill username
  if (formInfo.usernameInput && accountData.username) {
    fillInput(formInfo.usernameInput, accountData.username);
  }

  // Fill password
  if (formInfo.passwordInput && accountData.password) {
    fillInput(formInfo.passwordInput, accountData.password);
  }

  focusNextField(formInfo);
  highlightFilledFields(formInfo);
  showNotification('Credentials filled!');

  // Check if there's a 2FA field on the same page and we have a 2FA code
  if (formInfo.totpInput && accountData.secret) {
    // Wait a bit for the autofill to complete, then show 2FA prompt
    setTimeout(() => {
      show2FAQuickPrompt(formInfo.totpInput);
    }, 500);
  }
}

/**
 * Autofill 2FA code directly (no popup confirmation)
 */
async function autofill2FADirectly() {
  if (!accountData || !accountData.secret) {
    showNotification('No 2FA code saved for this account');
    return;
  }

  const formInfo = detectedForms.find(f => f.totpInput);
  if (!formInfo || !formInfo.totpInput) {
    showNotification('No 2FA field detected');
    return;
  }

  // Get TOTP code
  const codeResponse = await chrome.runtime.sendMessage({
    type: 'GENERATE_TOTP',
    accountId: accountData.id
  });

  if (!codeResponse.success || !codeResponse.data.code) {
    showNotification('Failed to generate 2FA code');
    return;
  }

  // Fill the 2FA code directly
  fillInput(formInfo.totpInput, codeResponse.data.code);
  highlightFilledFields(formInfo);
  showNotification('2FA code filled!');
}

/**
 * Show small 2FA prompt
 */
async function show2FAQuickPrompt(targetInput) {
  // Get TOTP code
  const codeResponse = await chrome.runtime.sendMessage({
    type: 'GENERATE_TOTP',
    accountId: accountData.id
  });

  if (!codeResponse.success || !codeResponse.data.code) return;

  const code = codeResponse.data.code;

  // Remove existing 2FA prompt
  const existing = document.querySelector('.two-fa-quick-prompt');
  if (existing) existing.remove();

  // Find position for the prompt (near the 2FA input)
  const inputRect = targetInput.getBoundingClientRect();
  const prompt = document.createElement('div');
  prompt.className = 'two-fa-quick-prompt';
  prompt.innerHTML = `
    <div class="two-fa-prompt-header">
      <span class="two-fa-prompt-icon">🔐</span>
      <span class="two-fa-prompt-text">2FA code available</span>
    </div>
    <div class="two-fa-prompt-actions">
      <button class="two-fa-prompt-btn two-fa-prompt-cancel">Cancel</button>
      <button class="two-fa-prompt-btn two-fa-prompt-use">Autofill</button>
    </div>
  `;

  // Position prompt above the 2FA input
  const promptTop = Math.max(10, inputRect.top - 70);
  const promptLeft = Math.max(10, Math.min(inputRect.left, window.innerWidth - 260));

  // Add styles if not exists
  if (!document.querySelector('#two-fa-quick-prompt-styles')) {
    const style = document.createElement('style');
    style.id = 'two-fa-quick-prompt-styles';
    style.textContent = `
      .two-fa-quick-prompt {
        position: fixed;
        min-width: 200px;
        background: #2d2d2d;
        border: 1px solid #404040;
        border-radius: 8px;
        padding: 12px;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
        z-index: 999999;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        animation: two-fa-quickFadeIn 0.2s ease;
      }

      @keyframes two-fa-quickFadeIn {
        from {
          opacity: 0;
          transform: translateY(-5px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }

      .two-fa-prompt-header {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 10px;
        color: #e0e0e0;
        font-size: 13px;
      }

      .two-fa-prompt-icon {
        font-size: 16px;
      }

      .two-fa-prompt-text {
        flex: 1;
      }

      .two-fa-prompt-actions {
        display: flex;
        gap: 8px;
      }

      .two-fa-prompt-btn {
        flex: 1;
        padding: 8px 12px;
        border: none;
        border-radius: 4px;
        font-size: 12px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s;
      }

      .two-fa-prompt-cancel {
        background: #3d3d3d;
        color: #e0e0e0;
      }

      .two-fa-prompt-cancel:hover {
        background: #4d4d4d;
      }

      .two-fa-prompt-use {
        background: #4CAF50;
        color: white;
      }

      .two-fa-prompt-use:hover {
        background: #388E3C;
      }
    `;
    document.head.appendChild(style);
  }

  prompt.style.top = promptTop + 'px';
  prompt.style.left = promptLeft + 'px';

  document.body.appendChild(prompt);

  // Cancel button
  const cancelBtn = prompt.querySelector('.two-fa-prompt-cancel');
  cancelBtn.addEventListener('click', () => {
    prompt.remove();
  });

  // Use button
  const useBtn = prompt.querySelector('.two-fa-prompt-use');
  useBtn.addEventListener('click', () => {
    fillInput(targetInput, code);
    prompt.remove();
    showNotification('2FA code filled!');
  });

  // Auto-hide after 10 seconds
  setTimeout(() => {
    if (document.body.contains(prompt)) {
      prompt.remove();
    }
  }, 10000);
}

/**
 * Observe DOM changes for dynamic forms
 */
function observeDOMChanges() {
  const observer = new MutationObserver((mutations) => {
    let shouldRecheck = false;

    for (const mutation of mutations) {
      if (mutation.addedNodes.length > 0) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === 1) {
            if (
              node.tagName === 'FORM' ||
              node.tagName === 'INPUT' ||
              node.querySelector?.('form') ||
              node.querySelector?.('input[type="password"]') ||
              node.matches?.('input[name*="otp"], input[name*="code"], input[autocomplete="one-time-code"]')
            ) {
              shouldRecheck = true;
              break;
            }
          }
        }
      }
      if (shouldRecheck) break;
    }

    if (shouldRecheck) {
      setTimeout(() => {
        detectForms();
        // Update button based on current page state
        if (detectedForms.length === 0) {
          // No forms anymore - hide button
          removeAutofillButton();
        } else if (hasCredentialsForPage) {
          // Forms detected and we have credentials - update button
          showAutofillButton();
        }
      }, 100);
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
}

/**
 * Detect login forms on the page
 */
function detectForms() {
  detectedForms = [];

  // Find all password inputs
  const passwordInputs = document.querySelectorAll('input[type="password"]');

  passwordInputs.forEach(passwordInput => {
    // Find associated form
    let form = passwordInput.closest('form');

    // Find username/email input
    let usernameInput = null;

    if (form) {
      usernameInput = form.querySelector('input[type="text"], input[type="email"], input[name*="user"], input[name*="email"], input[id*="user"], input[id*="email"]');
    } else {
      const parent = passwordInput.parentElement;
      const siblings = Array.from(parent.parentElement?.children || []);

      for (const sibling of siblings) {
        if (sibling === parent) break;
        const input = sibling.querySelector('input[type="text"], input[type="email"]');
        if (input) {
          usernameInput = input;
          break;
        }
      }

      if (!usernameInput) {
        let prev = passwordInput.previousElementSibling;
        while (prev) {
          if (prev.tagName === 'INPUT' && (prev.type === 'text' || prev.type === 'email')) {
            usernameInput = prev;
            break;
          }
          if (prev.querySelector) {
            const found = prev.querySelector('input[type="text"], input[type="email"]');
            if (found) {
              usernameInput = found;
              break;
            }
          }
          prev = prev.previousElementSibling;
        }
      }
    }

    // Look for 2FA input field
    let totpInput = null;

    if (form) {
      totpInput = form.querySelector(
        'input[name*="otp"], input[name*="code"], input[name*="2fa"], input[name*="totp"], ' +
        'input[id*="otp"], input[id*="code"], input[id*="2fa"], input[id*="totp"], ' +
        'input[placeholder*="code"], input[placeholder*="OTP"], input[autocomplete="one-time-code"]'
      );
    }

    if (!totpInput) {
      const passwordParent = passwordInput.parentElement;
      const container = passwordParent.parentElement?.parentElement || passwordParent.parentElement;
      if (container) {
        totpInput = container.querySelector(
          'input[name*="otp"], input[name*="code"], input[name*="2fa"], input[name*="totp"], ' +
          'input[id*="otp"], input[id*="code"], input[id*="2fa"], input[id*="totp"], ' +
          'input[placeholder*="code"], input[placeholder*="OTP"], input[autocomplete="one-time-code"]'
        );
      }
    }

    const formInfo = {
      form,
      passwordInput,
      usernameInput,
      totpInput,
      type: 'login' // This is a login form with password
    };

    detectedForms.push(formInfo);

    // Attach submit listener to capture credentials
    if (form && !form.hasAttribute('data-twofa-listener')) {
      form.setAttribute('data-twofa-listener', 'true');
      form.addEventListener('submit', handleFormSubmit);
    }
  });

  // Also check for 2FA-only pages (no password field, just 2FA field)
  if (passwordInputs.length === 0) {
    const totpInputs = document.querySelectorAll(
      'input[name*="otp"], input[name*="code"], input[name*="2fa"], input[name*="totp"], ' +
      'input[id*="otp"], input[id*="code"], input[id*="2fa"], input[id*="totp"], ' +
      'input[placeholder*="code"], input[placeholder*="OTP"], input[placeholder*="2FA"], ' +
      'input[autocomplete="one-time-code"]'
    );

    totpInputs.forEach(totpInput => {
      detectedForms.push({
        form: null,
        passwordInput: null,
        usernameInput: null,
        totpInput,
        type: '2fa' // This is a 2FA-only page
      });
    });
  }
}

/**
 * Handle form submission - capture credentials and offer to save
 */
function handleFormSubmit(e) {
  // Find username and password inputs from the form
  const form = e.target;
  const usernameInput = form.querySelector('input[type="text"], input[type="email"], input[name*="user"], input[name*="email"], input[id*="user"], input[id*="email"]');
  const passwordInput = form.querySelector('input[type="password"]');

  // Only proceed if we have both username and password
  if (!usernameInput || !passwordInput) return;

  const username = usernameInput.value.trim();
  const password = passwordInput.value;

  // Skip if either is empty
  if (!username || !password) return;

  // Store submitted credentials in chrome.storage so it persists across page navigation
  const credentialsData = {
    username,
    password,
    url: window.location.href,
    timestamp: Date.now()
  };

  // Store in chrome.storage.local to survive page navigation
  try {
    chrome.storage.local.set({ 'pending_save_credentials': credentialsData }).catch(() => {
      // Extension was reloaded or context invalidated - silently ignore
    }).then(() => {
      // Check after delay if login succeeded (we're on a new page)
      setTimeout(checkPendingCredentials, 2000);
    }).catch(() => {
      // Extension context invalidated - ignore
    });
  } catch (error) {
    // Extension context invalidated - silently ignore
  }
}

/**
 * Check for pending credentials from previous page and show save prompt
 */
async function checkPendingCredentials() {
  try {
    const result = await chrome.storage.local.get('pending_save_credentials');
    const pending = result.pending_save_credentials;

    // No pending credentials
    if (!pending) {
      submittedCredentials = null;
      return;
    }

    // Check if credentials are too old (more than 5 minutes)
    const maxAge = 5 * 60 * 1000; // 5 minutes
    if (Date.now() - pending.timestamp > maxAge) {
      // Clear expired pending credentials
      chrome.storage.local.remove('pending_save_credentials').catch(() => {});
      submittedCredentials = null;
      return;
    }

    // Check if vault is unlocked first (can't save if vault is locked)
    const statusResponse = await chrome.runtime.sendMessage({
      type: 'GET_STATUS'
    });

    if (!statusResponse || !statusResponse.unlocked) {
      // Vault is locked, clear pending credentials
      chrome.storage.local.remove('pending_save_credentials').catch(() => {});
      submittedCredentials = null;
      return;
    }

    const domain = window.location.hostname.replace('www.', '');
    const originalDomain = new URL(pending.url).hostname.replace('www.', '');

    // Only show prompt if we're on the same domain or a redirect within the same site
    // This prevents showing the prompt on unrelated websites
    if (domain !== originalDomain && !isSameSite(domain, originalDomain)) {
      // Different site - check if enough time has passed (likely a successful redirect)
      // If we're on a different page after 2+ seconds, login likely succeeded
      const timeSinceSubmit = Date.now() - pending.timestamp;
      if (timeSinceSubmit > 2000) {
        // It's been more than 2 seconds, likely successful login to a different page
        // But only show if it seems related (same base domain or common redirect pattern)
        if (!isRelatedSite(domain, originalDomain)) {
          // Completely unrelated site - clear pending credentials
          chrome.storage.local.remove('pending_save_credentials').catch(() => {});
          submittedCredentials = null;
          return;
        }
      } else {
        // Not enough time passed, wait for next check
        return;
      }
    }

    // Check if we already have accounts for the ORIGINAL domain (where login happened)
    const existingAccountsResponse = await chrome.runtime.sendMessage({
      type: 'FIND_ALL_ACCOUNTS',
      domain: originalDomain
    });

    if (existingAccountsResponse && existingAccountsResponse.success && existingAccountsResponse.accounts && existingAccountsResponse.accounts.length > 0) {
      // Check if any existing account matches the username we're trying to save
      const matchingAccount = existingAccountsResponse.accounts.find(acc => {
        const existingUsername = (acc.username || '').toLowerCase();
        const newUsername = (pending.username || '').toLowerCase();
        return existingUsername === newUsername;
      });

      if (matchingAccount) {
        // Account with same username already exists - don't offer to save
        chrome.storage.local.remove('pending_save_credentials').catch(() => {});
        submittedCredentials = null;
        return;
      }
    }

    // Check if domain is in "never save" list
    const neverSaveResponse = await chrome.runtime.sendMessage({
      type: 'IS_NEVER_SAVE',
      domain: originalDomain
    });

    if (neverSaveResponse && neverSaveResponse.success && neverSaveResponse.neverSave) {
      // Domain is in never save list, clear pending
      chrome.storage.local.remove('pending_save_credentials').catch(() => {});
      submittedCredentials = null;
      return;
    }

    // Set submittedCredentials and show prompt
    submittedCredentials = pending;
    showSaveCredentialsPrompt();
  } catch (error) {
    // Extension context invalidated - clear pending and ignore
    submittedCredentials = null;
    try {
      chrome.storage.local.remove('pending_save_credentials').catch(() => {});
    } catch {}
  }
}

/**
 * Check if two domains are the same site
 */
function isSameSite(domain1, domain2) {
  if (domain1 === domain2) return true;

  // Check for common subdomains
  const parts1 = domain1.split('.');
  const parts2 = domain2.split('.');

  // Get the last two parts for comparison (e.g., example.com)
  if (parts1.length >= 2 && parts2.length >= 2) {
    const base1 = parts1.slice(-2).join('.');
    const base2 = parts2.slice(-2).join('.');
    return base1 === base2;
  }

  return false;
}

/**
 * Check if two domains are related sites (for redirect detection)
 */
function isRelatedSite(domain1, domain2) {
  // Same site
  if (isSameSite(domain1, domain2)) return true;

  // Common authentication redirect patterns
  // e.g., login.example.com -> example.com
  // or example.com -> accounts.example.com
  const authPrefixes = ['login', 'auth', 'accounts', 'signin', 'secure', 'sso', 'id', 'oauth', 'api'];
  const parts1 = domain1.split('.');
  const parts2 = domain2.split('.');

  // Check if one is an auth subdomain of the other
  if (parts1.length >= 2 && parts2.length >= 2) {
    const base1 = parts1.slice(-2).join('.');
    const base2 = parts2.slice(-2).join('.');

    if (base1 === base2) {
      // Same base domain - check for auth prefix
      const prefix1 = parts1.length > 2 ? parts1[0] : '';
      const prefix2 = parts2.length > 2 ? parts2[0] : '';

      return authPrefixes.includes(prefix1) || authPrefixes.includes(prefix2);
    }
  }

  return false;
}

/**
 * Show save credentials prompt
 */
async function showSaveCredentialsPrompt() {
  // Don't show if we already have credentials for this domain
  if (hasCredentialsForPage && accountData) {
    submittedCredentials = null;
    chrome.storage.local.remove('pending_save_credentials');
    return;
  }

  if (!submittedCredentials) return;

  // Get the original domain from where credentials were submitted
  const originalDomain = new URL(submittedCredentials.url).hostname.replace('www.', '');

  // Check if domain is in "never save" list
  const neverSaveResponse = await chrome.runtime.sendMessage({
    type: 'IS_NEVER_SAVE',
    domain: originalDomain
  });

  if (neverSaveResponse.success && neverSaveResponse.neverSave) {
    // Domain is in never save list, don't show prompt
    submittedCredentials = null;
    chrome.storage.local.remove('pending_save_credentials');
    return;
  }

  let displayName = originalDomain;

  // Try to get a better display name from the original URL
  try {
    const urlObj = new URL(submittedCredentials.url);
    // Use the page title from the pending credentials' URL if we could get it
    // For now, just use the domain
  } catch {
    // Invalid URL, use as-is
  }

  // Try to get a better display name from current page (might be redirect)
  const pageTitle = document.title;
  if (pageTitle && pageTitle.length > 0 && pageTitle.length < 50) {
    displayName = pageTitle;
  }

  // Remove existing save prompt
  const existing = document.querySelector('.two-fa-save-prompt');
  if (existing) existing.remove();

  const prompt = document.createElement('div');
  prompt.className = 'two-fa-save-prompt';
  prompt.innerHTML = `
    <div class="two-fa-save-content">
      <div class="two-fa-save-header">
        <span class="two-fa-save-icon">💾</span>
        <span class="two-fa-save-title">Save Credentials?</span>
        <button class="two-fa-save-close" title="Close">×</button>
      </div>
      <div class="two-fa-save-body">
        <p>Save credentials for <strong>${escapeHtml(displayName)}</strong>?</p>
        <div class="two-fa-save-details">
          <div class="two-fa-save-detail">
            <span class="two-fa-save-label">Username:</span>
            <span class="two-fa-save-value">${escapeHtml(submittedCredentials.username)}</span>
          </div>
          <div class="two-fa-save-detail">
            <span class="two-fa-save-label">Password:</span>
            <span class="two-fa-save-value">•••••••••</span>
          </div>
        </div>
        <div class="two-fa-save-actions">
          <button class="two-fa-save-btn two-fa-save-not-now">Not Now</button>
          <button class="two-fa-save-btn two-fa-save-never">Never for this site</button>
          <button class="two-fa-save-btn two-fa-save-confirm">Save</button>
        </div>
      </div>
    </div>
  `;

  // Add styles if not exists
  if (!document.querySelector('#two-fa-save-prompt-styles')) {
    const style = document.createElement('style');
    style.id = 'two-fa-save-prompt-styles';
    style.textContent = `
      .two-fa-save-prompt {
        position: fixed;
        bottom: 80px;
        right: 20px;
        width: 320px;
        background: #2d2d2d;
        border: 1px solid #404040;
        border-radius: 12px;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
        z-index: 999999;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        animation: two-fa-saveSlideUp 0.3s ease;
      }

      @keyframes two-fa-saveSlideUp {
        from {
          opacity: 0;
          transform: translateY(20px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }

      .two-fa-save-content {
        color: #e0e0e0;
      }

      .two-fa-save-header {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 16px;
        border-bottom: 1px solid #404040;
      }

      .two-fa-save-icon {
        font-size: 20px;
      }

      .two-fa-save-title {
        flex: 1;
        font-size: 16px;
        font-weight: 600;
      }

      .two-fa-save-close {
        background: transparent;
        border: none;
        color: #a0a0a0;
        font-size: 24px;
        cursor: pointer;
        padding: 0;
        width: 24px;
        height: 24px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 4px;
        transition: all 0.2s;
      }

      .two-fa-save-close:hover {
        background: #3d3d3d;
        color: #e0e0e0;
      }

      .two-fa-save-body {
        padding: 16px;
      }

      .two-fa-save-body p {
        margin: 0 0 12px 0;
        font-size: 14px;
        color: #a0a0a0;
      }

      .two-fa-save-details {
        background: #1e1e1e;
        border-radius: 8px;
        padding: 12px;
        margin-bottom: 16px;
      }

      .two-fa-save-detail {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 4px 0;
        font-size: 13px;
      }

      .two-fa-save-label {
        color: #a0a0a0;
      }

      .two-fa-save-value {
        color: #e0e0e0;
        font-weight: 500;
      }

      .two-fa-save-actions {
        display: flex;
        gap: 8px;
      }

      .two-fa-save-btn {
        flex: 1;
        padding: 10px 12px;
        border: none;
        border-radius: 6px;
        font-size: 13px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s;
      }

      .two-fa-save-not-now {
        background: #3d3d3d;
        color: #e0e0e0;
      }

      .two-fa-save-not-now:hover {
        background: #4d4d4d;
      }

      .two-fa-save-never {
        background: transparent;
        color: #a0a0a0;
        border: 1px solid #404040;
      }

      .two-fa-save-never:hover {
        background: #3d3d3d;
        color: #e0e0e0;
      }

      .two-fa-save-confirm {
        background: #4CAF50;
        color: white;
      }

      .two-fa-save-confirm:hover {
        background: #388E3C;
      }
    `;
    document.head.appendChild(style);
  }

  document.body.appendChild(prompt);

  // Close button
  const closeBtn = prompt.querySelector('.two-fa-save-close');
  closeBtn.addEventListener('click', () => {
    prompt.remove();
    submittedCredentials = null;
    chrome.storage.local.remove('pending_save_credentials');
  });

  // Not now button
  const notNowBtn = prompt.querySelector('.two-fa-save-not-now');
  notNowBtn.addEventListener('click', () => {
    prompt.remove();
    submittedCredentials = null;
    chrome.storage.local.remove('pending_save_credentials');
  });

  // Never button
  const neverBtn = prompt.querySelector('.two-fa-save-never');
  neverBtn.addEventListener('click', () => {
    // Store domain in "never save" list
    chrome.runtime.sendMessage({
      type: 'ADD_TO_NEVER_SAVE',
      domain: originalDomain
    });
    prompt.remove();
    submittedCredentials = null;
    chrome.storage.local.remove('pending_save_credentials');
  });

  // Save button
  const saveBtn = prompt.querySelector('.two-fa-save-confirm');
  saveBtn.addEventListener('click', () => {
    saveCredentials(submittedCredentials);
    prompt.remove();
    chrome.storage.local.remove('pending_save_credentials');
  });

  // Auto-hide after 30 seconds
  setTimeout(() => {
    if (document.body.contains(prompt)) {
      prompt.remove();
      submittedCredentials = null;
      chrome.storage.local.remove('pending_save_credentials');
    }
  }, 30000);
}

/**
 * Save credentials to vault
 */
async function saveCredentials(credentials) {
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'SAVE_CREDENTIALS',
      credentials: {
        url: credentials.url,
        username: credentials.username,
        password: credentials.password
      }
    });

    if (response && response.success) {
      showNotification('Credentials saved!');
      // Clear pending credentials
      chrome.storage.local.remove('pending_save_credentials').catch(() => {});
      submittedCredentials = null;
      // Update state
      await checkPageCredentials();
    } else {
      showNotification('Failed to save: ' + (response?.error || 'Unknown error'));
    }
  } catch (error) {
    // Extension context invalidated - show error but don't crash
    showNotification('Save failed: Extension was reloaded. Please try again.');
    // Clear pending credentials to avoid repeated errors
    try {
      chrome.storage.local.remove('pending_save_credentials').catch(() => {});
    } catch {}
    submittedCredentials = null;
  }
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
 * Fill input field
 */
function fillInput(input, value) {
  if (!input || !value) return;

  input.focus();
  input.value = value;

  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  input.dispatchEvent(new Event('blur', { bubbles: true }));

  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    'value'
  )?.set;

  if (nativeInputValueSetter) {
    nativeInputValueSetter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

/**
 * Focus next field or submit button
 */
function focusNextField(formInfo) {
  if (formInfo.totpInput && !formInfo.totpInput.value) {
    formInfo.totpInput.focus();
    return;
  }

  if (formInfo.form) {
    const submitBtn = formInfo.form.querySelector(
      'button[type="submit"], input[type="submit"], button:not([type])'
    );

    if (submitBtn) {
      submitBtn.focus();
    }
  }
}

/**
 * Highlight filled fields temporarily
 */
function highlightFilledFields(formInfo) {
  const fields = [
    formInfo.usernameInput,
    formInfo.passwordInput,
    formInfo.totpInput
  ].filter(Boolean);

  fields.forEach(field => {
    field.style.transition = 'box-shadow 0.3s';
    field.style.boxShadow = '0 0 0 3px rgba(76, 175, 80, 0.3)';

    setTimeout(() => {
      field.style.boxShadow = '';
    }, 1500);
  });
}

/**
 * Show notification
 */
function showNotification(message) {
  const existing = document.querySelector('.two-fa-notification');
  if (existing) existing.remove();

  const notification = document.createElement('div');
  notification.className = 'two-fa-notification';
  notification.textContent = message;
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: #2d2d2d;
    color: #e0e0e0;
    padding: 12px 20px;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    z-index: 1000000;
    font-size: 14px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    animation: slideIn 0.3s ease;
  `;

  if (!document.querySelector('#two-fa-notification-styles')) {
    const style = document.createElement('style');
    style.id = 'two-fa-notification-styles';
    style.textContent = `
      @keyframes slideIn {
        from {
          opacity: 0;
          transform: translateX(100px);
        }
        to {
          opacity: 1;
          transform: translateX(0);
        }
      }
      @keyframes slideOut {
        from {
          opacity: 1;
          transform: translateX(0);
        }
        to {
          opacity: 0;
          transform: translateX(100px);
        }
      }
    `;
    document.head.appendChild(style);
  }

  document.body.appendChild(notification);

  setTimeout(() => {
    notification.style.animation = 'slideOut 0.3s ease';
    setTimeout(() => notification.remove(), 300);
  }, 3000);
}

/**
 * Handle messages from background/popup
 */
function handleMessage(message, sender, sendResponse) {
  (async () => {
    try {
      switch (message.type) {
        case 'AUTOFILL_CREDENTIALS':
          if (detectedForms.length > 0) {
            const formInfo = detectedForms[0];

            if (formInfo.usernameInput && message.data.username) {
              fillInput(formInfo.usernameInput, message.data.username);
            }

            if (formInfo.passwordInput && message.data.password) {
              fillInput(formInfo.passwordInput, message.data.password);
            }

            if (formInfo.totpInput && message.data.totpCode) {
              setTimeout(() => {
                show2FAQuickPrompt(formInfo.totpInput);
              }, 500);
            }

            focusNextField(formInfo);
            highlightFilledFields(formInfo);
            showNotification('Credentials filled!');
          }
          sendResponse({ success: true });
          break;

        case 'GET_PAGE_INFO':
          sendResponse({
            success: true,
            data: {
              url: window.location.href,
              domain: window.location.hostname,
              title: document.title,
              hasForms: detectedForms.length > 0
            }
          });
          break;

        case 'TRIGGER_AUTOFILL':
          if (hasCredentialsForPage) {
            await autofillCredentials();
          }
          sendResponse({ success: true });
          break;

        default:
          sendResponse({ success: false, error: 'Unknown message type' });
      }
    } catch (error) {
      sendResponse({ success: false, error: error.message });
    }

    return true;
  })();

  return true;
}

// Initialize
init();
