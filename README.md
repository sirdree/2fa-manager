# 2FA Manager & Autofill

A secure Chrome extension for managing 2FA TOTP codes with autofill capabilities. Store credentials, generate time-based one-time passwords, and autofill login forms with username, password, and 2FA codes.

**Version:** 1.1.0
**Created by:** Ervin (dev@bit2soft.com)

[![Buy me a coffee](https://img.shields.io/badge/Donate-PayPal-blue.svg)](https://www.paypal.com/donate/?hosted_button_id=GJGXEPFP2SWFW)

## Features

- **🔒 Secure Storage** - Accounts encrypted with AES-256-GCM using your master password
- **⚡ Smart Autofill** - Automatically detect and fill login forms with username, password, and 2FA codes
- **📱 QR Code Support** - Scan QR codes to quickly add 2FA accounts
- **🔄 Auto-Refresh** - TOTP codes refresh automatically with visual countdown timers
- **☁️ Chrome Sync** - Optional cloud sync across devices using Chrome's built-in sync storage
- **🎯 Domain Matching** - Intelligent matching of accounts to websites
- **💾 Backup & Restore** - Export/import encrypted vault backups
- **🌐 Framework Compatible** - Works with React, Vue, Angular, and vanilla JavaScript forms

## How It Works

1. **Create Master Password** - Set up a master password to encrypt your vault
2. **Add Accounts** - Manually enter account details or scan QR codes
3. **Store Credentials** - Save usernames, passwords, and 2FA secrets (all optional)
4. **Autofill Forms** - Extension detects login forms and shows autofill button
5. **Generate TOTP Codes** - Time-based one-time passwords generated locally following RFC 6238

## Encryption & Security

Your data security is paramount. The extension uses industry-standard encryption:

### Encryption Algorithms

- **Vault Encryption:** AES-256-GCM (Advanced Encryption Standard, 256-bit key)
- **Key Derivation:** PBKDF2 with 100,000 iterations using SHA-256
- **Master Password Hash:** SHA-256 with salt for verification
- **TOTP Generation:** HMAC-SHA1 following RFC 6238 and RFC 4226 standards

### Security Features

- **Client-Side Only** - All encryption/decryption happens locally in your browser
- **No Password Recovery** - Master password hash cannot be reversed (use backup files)
- **In-Memory Cache** - Decrypted accounts stored in memory only while vault is unlocked
- **Auto-Lock** - Optional automatic vault locking after inactivity
- **Clipboard Timeout** - Automatic clipboard clearing after copying codes

### Encryption Details

```
Encryption: AES-256-GCM
├── Algorithm: AES (Advanced Encryption Standard)
├── Key Size: 256 bits
├── Mode: GCM (Galois/Counter Mode) - provides authentication
├── IV: 12 random bytes per encryption (unique per operation)
└── Salt: PBKDF2 with 100,000 iterations

Master Password Verification:
└── SHA-256(password + "2fa-manager-salt")
```

## Installation

### From Source

1. Clone this repository or download ZIP
   ```bash
   git clone https://github.com/sirdree/2fa-manager.git
   ```

2. Open Chrome and navigate to `chrome://extensions/`

3. Enable "Developer mode" (toggle in top right)

4. Click "Load unpacked" and select the extension directory

5. The extension icon will appear in your toolbar

## Usage

### Adding Accounts

**Method 1: QR Code (Recommended)**
1. Click extension icon → "Add Account"
2. Click "Scan QR Code"
3. Click "Open Camera" and scan the QR code
4. Account is automatically configured

**Method 2: Manual Entry**
1. Click extension icon → "Add Account"
2. Enter account details:
   - Issuer/Service (e.g., "Google", "GitHub")
   - Account Name (e.g., "user@example.com")
   - Username (optional - for autofill)
   - Password (optional - for autofill)
   - 2FA Secret Key (Base32 format)

### Autofilling Forms

1. Navigate to a login page
2. Extension automatically detects forms
3. Green button appears if account match found
4. Click the button or use keyboard shortcut: `Ctrl+Shift+Y` (Windows/Linux) or `Cmd+Shift+Y` (Mac)
5. Fields are filled automatically

### Cloud Sync (Optional)

Sync your encrypted vault across devices using Chrome's built-in sync:

1. Go to extension Settings → Cloud Sync
2. Click "Enable Sync"
3. Click "Upload to Cloud" to backup
4. On other devices, click "Download from Cloud" to restore

**Features:**
- Uses Chrome Sync Storage (100KB limit)
- Automatic compression for large vaults
- Configurable auto-sync intervals (5m to 24h)
- Intelligent merge when conflicts detected
- End-to-end encrypted with your master password

## Technical Stack

- **Vanilla JavaScript** - No build step required
- **Chrome Extension Manifest V3** - Latest extension platform
- **Web Crypto API** - Native browser cryptography
- **Chrome BarcodeDetector API** - QR code scanning
- **Chrome Storage API** - Local and sync storage

## Permissions Required

- `storage` - Save encrypted vault locally and to Chrome sync
- `activeTab` - Detect and fill forms on current tab
- `scripting` - Inject autofill functionality
- `tabs` - Access tab information for domain matching
- `alarms` - Schedule auto-sync operations
- `<all_urls>` - Access all websites for autofill (content script)

## Browser Compatibility

- **Chrome:** 89+ (required for BarcodeDetector API)
- **Edge:** 89+ (Chromium-based)
- **Brave:** 89+ (Chromium-based)
- **Firefox:** Not supported (uses Chrome-specific APIs)

## Data Storage

All data is stored locally using Chrome's storage APIs:

- **chrome.storage.local** - Encrypted vault and settings (unlimited size)
- **chrome.storage.sync** - Optional cloud backup (100KB limit)

No external servers or third-party services are used.

## Privacy

- **No Data Collection** - Extension does not collect or transmit any data
- **No Analytics** - No tracking, no telemetry
- **No External Requests** - All operations are local
- **Open Source** - Code is publicly auditable

### Testing

1. Load extension in Chrome (see Installation)
2. Make changes to code
3. Go to `chrome://extensions/` and click reload icon
4. Test changes in popup or on websites

### Debugging

- **Popup:** Right-click extension icon → Inspect popup
- **Background:** chrome://extensions/ → Service worker → Inspect
- **Content Script:** Page DevTools → Console
- **Storage:** Service worker → Application tab → Storage

## Known Limitations

1. **QR Scanning:** Requires BarcodeDetector API (Chrome 89+)
2. **Form Detection:** Heuristic-based, may miss highly customized forms
3. **Service Worker:** May terminate after 30s inactivity (extension includes keep-alive)
4. **Chrome Sync Limit:** 100KB for cloud backups (≈200-500 accounts depending on data)

## Contributing

Contributions are welcome! Please feel free to submit issues or pull requests.

## Support

If you find this extension helpful, consider supporting development:

[![Donate with PayPal](https://img.shields.io/badge/Donate-PayPal-blue.svg)](https://www.paypal.com/donate/?hosted_button_id=GJGXEPFP2SWFW)

## License

This project is open source. See repository for license details.

## Links

- **GitHub Repository:** https://github.com/sirdree/2fa-manager
- **Report Issues:** https://github.com/sirdree/2fa-manager/issues
- **Donate:** https://www.paypal.com/donate/?hosted_button_id=GJGXEPFP2SWFW

---

**⚠️ Important Security Notice**

Never share your master password or backup files. The extension has no password recovery mechanism. If you forget your master password, you will need to reset the extension and lose all data. Always keep encrypted backups in a safe location.
