/**
 * Simple QR Code Scanner for 2FA Manager
 * Uses BarcodeDetector API when available, falls back to jsQR library approach
 */

class QRScanner {
  constructor() {
    this.scanning = false;
    this.video = null;
    this.canvas = null;
    this.context = null;
    this.onDetect = null;
    this.scanInterval = null;
  }

  /**
   * Check if BarcodeDetector API is available
   */
  static isBarcodeDetectorSupported() {
    return 'BarcodeDetector' in window;
  }

  /**
   * Initialize scanner with video element
   */
  async init(videoElement) {
    this.video = videoElement;
    this.canvas = document.createElement('canvas');
    this.context = this.canvas.getContext('2d');
  }

  /**
   * Start scanning
   */
  async start(onDetectCallback) {
    this.onDetect = onDetectCallback;
    this.scanning = true;

    if (QRScanner.isBarcodeDetectorSupported()) {
      this.startBarcodeDetector();
    } else {
      console.warn('BarcodeDetector not supported, QR scanning limited');
      // In production, include a library like jsQR
      this.showUnsupportedMessage();
    }
  }

  /**
   * Start scanning using BarcodeDetector API
   */
  async startBarcodeDetector() {
    const barcodeDetector = new BarcodeDetector({ formats: ['qr_code'] });

    const scan = async () => {
      if (!this.scanning || !this.video) return;

      try {
        const barcodes = await barcodeDetector.detect(this.video);

        if (barcodes.length > 0) {
          this.stop();
          if (this.onDetect) {
            this.onDetect(barcodes[0].rawValue);
          }
          return;
        }
      } catch (error) {
        console.error('Barcode detection error:', error);
      }

      this.scanInterval = requestAnimationFrame(scan);
    };

    scan();
  }

  /**
   * Scan from image file
   */
  async scanFromFile(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);

      img.onload = async () => {
        try {
          if (QRScanner.isBarcodeDetectorSupported()) {
            const barcodeDetector = new BarcodeDetector({ formats: ['qr_code'] });
            const barcodes = await barcodeDetector.detect(img);

            URL.revokeObjectURL(url);

            if (barcodes.length > 0) {
              resolve(barcodes[0].rawValue);
            } else {
              reject(new Error('No QR code found in image'));
            }
          } else {
            URL.revokeObjectURL(url);
            reject(new Error('QR scanning not supported in this browser'));
          }
        } catch (error) {
          URL.revokeObjectURL(url);
          reject(error);
        }
      };

      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Failed to load image'));
      };

      img.src = url;
    });
  }

  /**
   * Scan from image element
   */
  async scanFromImage(imageElement) {
    if (!QRScanner.isBarcodeDetectorSupported()) {
      throw new Error('BarcodeDetector not supported');
    }

    const barcodeDetector = new BarcodeDetector({ formats: ['qr_code'] });
    const barcodes = await barcodeDetector.detect(imageElement);

    if (barcodes.length > 0) {
      return barcodes[0].rawValue;
    }

    throw new Error('No QR code found');
  }

  /**
   * Stop scanning
   */
  stop() {
    this.scanning = false;

    if (this.scanInterval) {
      cancelAnimationFrame(this.scanInterval);
      this.scanInterval = null;
    }
  }

  /**
   * Show unsupported message
   */
  showUnsupportedMessage() {
    if (this.onDetect) {
      this.onDetect(null, 'QR scanning requires BarcodeDetector API or external library');
    }
  }

  /**
   * Parse otpauth URL
   */
  static parseOTPAuth(url) {
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
}

// Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { QRScanner };
}
