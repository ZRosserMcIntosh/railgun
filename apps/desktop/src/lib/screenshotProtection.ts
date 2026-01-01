/**
 * Screenshot Protection
 * 
 * Detects screenshot attempts and displays a warning overlay.
 * On macOS, captures Cmd+Shift+3/4/5 shortcuts.
 */

let overlayElement: HTMLDivElement | null = null;
let overlayTimeout: NodeJS.Timeout | null = null;

/**
 * Show the screenshot protection overlay
 */
function showProtectionOverlay(): void {
  // Remove existing overlay if present
  if (overlayElement) {
    overlayElement.remove();
  }

  // Clear existing timeout
  if (overlayTimeout) {
    clearTimeout(overlayTimeout);
  }

  // Create overlay element
  overlayElement = document.createElement('div');
  overlayElement.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background: #0a0a0a;
    z-index: 999999;
    display: flex;
    align-items: center;
    justify-content: center;
    animation: fadeIn 0.2s ease-out;
  `;

  // Add the warning image
  const img = document.createElement('img');
  img.src = '/screenshot-warning.png'; // We'll add this image
  img.alt = 'Screenshot Protection';
  img.style.cssText = `
    max-width: 90%;
    max-height: 90%;
    filter: drop-shadow(0 0 50px rgba(255, 255, 255, 0.3));
    animation: glow 2s ease-in-out infinite;
  `;

  overlayElement.appendChild(img);
  document.body.appendChild(overlayElement);

  // Remove overlay after 3 seconds
  overlayTimeout = setTimeout(() => {
    if (overlayElement) {
      overlayElement.style.animation = 'fadeOut 0.3s ease-out';
      setTimeout(() => {
        overlayElement?.remove();
        overlayElement = null;
      }, 300);
    }
  }, 3000);

  console.warn('🚨 [Screenshot Protection] Screenshot attempt detected');
}

/**
 * Initialize screenshot protection
 */
export function initScreenshotProtection(): void {
  // Add CSS animations
  const style = document.createElement('style');
  style.textContent = `
    @keyframes fadeIn {
      from {
        opacity: 0;
        transform: scale(0.9);
      }
      to {
        opacity: 1;
        transform: scale(1);
      }
    }

    @keyframes fadeOut {
      from {
        opacity: 1;
        transform: scale(1);
      }
      to {
        opacity: 0;
        transform: scale(0.9);
      }
    }

    @keyframes glow {
      0%, 100% {
        filter: drop-shadow(0 0 30px rgba(255, 255, 255, 0.3));
      }
      50% {
        filter: drop-shadow(0 0 60px rgba(255, 255, 255, 0.6));
      }
    }
  `;
  document.head.appendChild(style);

  // Listen for screenshot keyboard shortcuts (macOS)
  document.addEventListener('keydown', (event) => {
    const isMac = navigator.platform.toLowerCase().includes('mac');
    
    if (isMac && event.metaKey && event.shiftKey) {
      // Cmd+Shift+3 (full screen)
      // Cmd+Shift+4 (selection)
      // Cmd+Shift+5 (screenshot utility)
      if (event.key === '3' || event.key === '4' || event.key === '5') {
        showProtectionOverlay();
      }
    } else if (!isMac && event.key === 'PrintScreen') {
      // Windows/Linux Print Screen key
      showProtectionOverlay();
    }
  });

  // Listen for Electron screenshot events (if available)
  if (typeof window !== 'undefined' && (window as any).electronAPI) {
    // Listen for screenshot attempts from main process
    window.addEventListener('message', (event) => {
      if (event.data === 'screenshot:attempt') {
        showProtectionOverlay();
      }
    });
  }

  // Listen for visibility change (may indicate screen recording)
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      // Could be minimized or screen recording started
      // We won't show overlay for this, just log
      console.warn('🔒 [Screenshot Protection] Window visibility changed');
    }
  });

  console.log('🔒 [Screenshot Protection] Initialized');
}

/**
 * Disable screenshot protection (for testing)
 */
export function disableScreenshotProtection(): void {
  if (overlayElement) {
    overlayElement.remove();
    overlayElement = null;
  }
  if (overlayTimeout) {
    clearTimeout(overlayTimeout);
    overlayTimeout = null;
  }
  console.log('🔓 [Screenshot Protection] Disabled');
}
