/**
 * TOTP (Time-based One-Time Password) Library
 * Implements RFC 6238 - TOTP: Time-based One-time Password Algorithm
 * Based on HMAC-based One-time Password Algorithm (HOTP) RFC 4226
 */

class TOTP {
  /**
   * Convert base32 string to Uint8Array
   * @param {string} base32 - Base32 encoded string
   * @returns {Uint8Array} - Decoded bytes
   */
  static base32Decode(base32) {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    let bits = '';

    for (const char of base32.toUpperCase()) {
      if (char === '=') break;
      const val = alphabet.indexOf(char);
      if (val === -1) continue;
      bits += val.toString(2).padStart(5, '0');
    }

    const bytes = new Uint8Array(Math.floor(bits.length / 8));
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = parseInt(bits.substr(i * 8, 8), 2);
    }

    return bytes;
  }

  /**
   * Generate HMAC-SHA1 hash
   * @param {Uint8Array} key - Secret key
   * @param {Uint8Array} message - Message to authenticate
   * @returns {Promise<Uint8Array>} - HMAC hash
   */
  static async hmacSHA1(key, message) {
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      key,
      { name: 'HMAC', hash: 'SHA-1' },
      false,
      ['sign']
    );

    const signature = await crypto.subtle.sign('HMAC', cryptoKey, message);
    return new Uint8Array(signature);
  }

  /**
   * Generate HOTP (HMAC-based One-Time Password)
   * @param {string} secret - Base32 encoded secret
   * @param {number} counter - Counter value
   * @param {number} digits - Number of digits (default: 6)
   * @returns {Promise<string>} - HOTP code
   */
  static async generateHOTP(secret, counter, digits = 6) {
    const key = this.base32Decode(secret);

    // Convert counter to 8-byte big-endian array
    const counterBytes = new Uint8Array(8);
    for (let i = 7; i >= 0; i--) {
      counterBytes[i] = counter & 0xff;
      counter >>= 8;
    }

    // Generate HMAC
    const hmac = await this.hmacSHA1(key, counterBytes);

    // Dynamic truncation
    const offset = hmac[hmac.length - 1] & 0x0f;
    const binary =
      ((hmac[offset] & 0x7f) << 24) |
      ((hmac[offset + 1] & 0xff) << 16) |
      ((hmac[offset + 2] & 0xff) << 8) |
      (hmac[offset + 3] & 0xff);

    const code = binary % Math.pow(10, digits);
    return code.toString().padStart(digits, '0');
  }

  /**
   * Get current time counter for TOTP
   * @param {number} timeStep - Time step in seconds (default: 30)
   * @returns {number} - Current counter value
   */
  static getTimeCounter(timeStep = 30) {
    return Math.floor(Date.now() / 1000 / timeStep);
  }

  /**
   * Get remaining time until next code
   * @param {number} timeStep - Time step in seconds (default: 30)
   * @returns {number} - Remaining seconds
   */
  static getRemainingTime(timeStep = 30) {
    return timeStep - (Math.floor(Date.now() / 1000) % timeStep);
  }

  /**
   * Generate TOTP code
   * @param {string} secret - Base32 encoded secret
   * @param {number} digits - Number of digits (default: 6)
   * @param {number} timeStep - Time step in seconds (default: 30)
   * @returns {Promise<{code: string, remainingTime: number}>} - TOTP code and remaining time
   */
  static async generateTOTP(secret, digits = 6, timeStep = 30) {
    const counter = this.getTimeCounter(timeStep);
    const code = await this.generateHOTP(secret, counter, digits);
    const remainingTime = this.getRemainingTime(timeStep);

    return { code, remainingTime };
  }

  /**
   * Validate TOTP code
   * @param {string} secret - Base32 encoded secret
   * @param {string} code - Code to validate
   * @param {number} window - Window of acceptable counters (default: 1)
   * @param {number} digits - Number of digits (default: 6)
   * @param {number} timeStep - Time step in seconds (default: 30)
   * @returns {Promise<boolean>} - True if code is valid
   */
  static async validateTOTP(secret, code, window = 1, digits = 6, timeStep = 30) {
    const counter = this.getTimeCounter(timeStep);

    for (let i = -window; i <= window; i++) {
      const validCode = await this.generateHOTP(secret, counter + i, digits);
      if (validCode === code) {
        return true;
      }
    }

    return false;
  }

  /**
   * Generate QR code data URI for otpauth:// URL
   * @param {string} secret - Base32 encoded secret
   * @param {string} accountName - Account name/email
   * @param {string} issuer - Issuer name
   * @param {number} digits - Number of digits (default: 6)
   * @param {number} period - Time period (default: 30)
   * @returns {string} - otpauth:// URL
   */
  static generateOTPAuthURL(secret, accountName, issuer, digits = 6, period = 30) {
    const label = encodeURIComponent(issuer ? `${issuer}:${accountName}` : accountName);
    const params = new URLSearchParams({
      secret: secret.toUpperCase().replace(/[^A-Z2-7]/g, ''),
      digits: digits.toString(),
      period: period.toString()
    });

    if (issuer) {
      params.append('issuer', issuer);
    }

    return `otpauth://totp/${label}?${params.toString()}`;
  }

  /**
   * Parse otpauth:// URL
   * @param {string} url - otpauth:// URL
   * @returns {object|null} - Parsed data or null
   */
  static parseOTPAuthURL(url) {
    try {
      const parsed = new URL(url);

      if (parsed.protocol !== 'otpauth:') {
        return null;
      }

      const type = parsed.hostname;
      const label = decodeURIComponent(parsed.pathname.substring(1));
      const params = new URLSearchParams(parsed.search);

      const secret = params.get('secret');
      if (!secret) {
        return null;
      }

      let issuer = params.get('issuer') || '';
      let accountName = label;

      if (label.includes(':')) {
        const parts = label.split(':');
        issuer = issuer || parts[0];
        accountName = parts.slice(1).join(':');
      }

      return {
        type,
        secret: secret.toUpperCase(),
        issuer,
        accountName,
        digits: parseInt(params.get('digits')) || 6,
        period: parseInt(params.get('period')) || 30
      };
    } catch {
      return null;
    }
  }

  /**
   * Generate random base32 secret
   * @param {number} length - Number of bytes (default: 20 for 160 bits)
   * @returns {Promise<string>} - Base32 encoded secret
   */
  static async generateSecret(length = 20) {
    const bytes = new Uint8Array(length);
    crypto.getRandomValues(bytes);

    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    let secret = '';

    for (let i = 0; i < bytes.length; i++) {
      const byte = bytes[i];
      secret += alphabet[byte >> 3 & 0x1f];
      const nextByte = bytes[i + 1] || 0;
      secret += alphabet[(byte << 2 | nextByte >> 6) & 0x1f];
    }

    return secret.substring(0, Math.ceil(length * 8 / 5));
  }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { TOTP };
}
