/**
 * Downloads Page
 * 
 * Allows users to download Rail Gun installers for different platforms.
 * Downloads are served as zip files for easy sharing.
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

// Icons as inline SVGs to avoid dependency issues
const BackIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
  </svg>
);

const DownloadIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
  </svg>
);

const MonitorIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
  </svg>
);

const AppleIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="currentColor" viewBox="0 0 24 24">
    <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/>
  </svg>
);

const TerminalIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
  </svg>
);

const CheckCircleIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);

const LoaderIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
  </svg>
);

const GlobeIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
  </svg>
);

// GitHub repository info for download URLs
const GITHUB_REPO = 'ZRosserMcIntosh/railgun';
const VERSION = import.meta.env.VITE_APP_VERSION || '0.1.0';
const RELEASES_BASE = `https://github.com/${GITHUB_REPO}/releases`;

// Get download URL for a platform - points to GitHub Releases
function getDownloadUrl(platformId: string): string | null {
  const urls: Record<string, string> = {
    // Universal package with all platforms
    'universal': `${RELEASES_BASE}/download/v${VERSION}/Rail-Gun-${VERSION}-Universal.zip`,
    // Individual platform downloads
    'windows': `${RELEASES_BASE}/download/v${VERSION}/Rail-Gun-${VERSION}-win-x64.exe`,
    'mac-arm': `${RELEASES_BASE}/download/v${VERSION}/Rail-Gun-${VERSION}-mac-universal.dmg`,
    'mac-intel': `${RELEASES_BASE}/download/v${VERSION}/Rail-Gun-${VERSION}-mac-universal.dmg`,
    'linux': `${RELEASES_BASE}/download/v${VERSION}/Rail-Gun-${VERSION}-linux-x86_64.AppImage`,
    // Latest release page as fallback
    'latest': `${RELEASES_BASE}/latest`,
  };
  return urls[platformId] || `${RELEASES_BASE}/latest`;
}

interface DownloadOption {
  id: string;
  name: string;
  platform: string;
  icon: React.ReactNode;
  filename: string;
  size: string;
  available: boolean;
}

const downloadOptions: DownloadOption[] = [
  {
    id: 'universal',
    name: 'Universal Package',
    platform: 'Windows + macOS + Linux (All-in-One)',
    icon: <GlobeIcon className="w-8 h-8" />,
    filename: 'Rail-Gun-Universal.zip',
    size: '~280 MB',
    available: true,
  },
  {
    id: 'windows',
    name: 'Windows',
    platform: 'Windows 10/11 (64-bit)',
    icon: <MonitorIcon className="w-8 h-8" />,
    filename: 'Rail-Gun-Windows-Setup.zip',
    size: '~90 MB',
    available: true,
  },
  {
    id: 'mac-arm',
    name: 'macOS (Apple Silicon)',
    platform: 'macOS 11+ (M1/M2/M3)',
    icon: <AppleIcon className="w-8 h-8" />,
    filename: 'Rail-Gun-macOS-ARM.zip',
    size: '~95 MB',
    available: true,
  },
  {
    id: 'mac-intel',
    name: 'macOS (Intel)',
    platform: 'macOS 10.15+ (Intel)',
    icon: <AppleIcon className="w-8 h-8" />,
    filename: 'Rail-Gun-macOS-Intel.zip',
    size: '~95 MB',
    available: false, // Requires additional build setup
  },
  {
    id: 'linux',
    name: 'Linux',
    platform: 'Ubuntu/Debian (64-bit)',
    icon: <TerminalIcon className="w-8 h-8" />,
    filename: 'Rail-Gun-Linux.zip',
    size: '~85 MB',
    available: false, // Requires additional build setup
  },
];

export function DownloadsPage() {
  const [downloading, setDownloading] = useState<string | null>(null);
  const [downloaded, setDownloaded] = useState<Set<string>>(new Set());
  const navigate = useNavigate();

  const handleDownload = async (option: DownloadOption) => {
    if (!option.available || downloading) return;

    setDownloading(option.id);

    try {
      // In production, this would fetch from a CDN or server
      // For now, we'll trigger a download from the local release folder
      // or show instructions for self-hosting
      
      // Check if we're in Electron and can trigger a download
      // For now, open the download URL directly
      const downloadUrl = getDownloadUrl(option.id);
      
      if (downloadUrl) {
        // Create a temporary link to trigger download
        const link = document.createElement('a');
        link.href = downloadUrl;
        link.download = option.filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setDownloaded(prev => new Set(prev).add(option.id));
      } else {
        alert('Download not available yet. Check back soon!');
      }
    } catch (error) {
      console.error('Download failed:', error);
      alert('Download failed. Please try again or download from GitHub releases.');
    } finally {
      setDownloading(null);
    }
  };

  return (
    <div className="flex-1 bg-surface-tertiary overflow-auto">
      <div className="max-w-4xl mx-auto px-6 py-12">
        {/* Back Button */}
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-2 text-text-secondary hover:text-text-primary mb-8 transition-colors"
        >
          <BackIcon className="w-5 h-5" />
          <span>Back</span>
        </button>

        {/* Header */}
        <div className="text-center mb-12">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-accent rounded-2xl mb-4">
            <DownloadIcon className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-text-primary mb-3">
            Download Rail Gun
          </h1>
          <p className="text-text-secondary text-lg max-w-2xl mx-auto">
            Get the <strong className="text-accent-light">Universal Package</strong> to share with anyone - 
            it contains installers for Windows, macOS, and Linux all in one zip file. 
            Share via email, USB, cloud storage, or any method!
          </p>
        </div>

        {/* Download Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-12">
          {downloadOptions.map((option) => (
            <div
              key={option.id}
              className={`
                relative bg-surface-elevated rounded-xl p-6 border-2 transition-all
                ${option.available 
                  ? 'border-border hover:border-accent cursor-pointer' 
                  : 'border-surface-elevated opacity-50 cursor-not-allowed'}
              `}
              onClick={() => handleDownload(option)}
            >
              {/* Coming Soon Badge */}
              {!option.available && (
                <div className="absolute top-3 right-3 bg-surface-hover text-text-secondary text-xs px-2 py-1 rounded">
                  Coming Soon
                </div>
              )}

              {/* Downloaded Badge */}
              {downloaded.has(option.id) && (
                <div className="absolute top-3 right-3 bg-status-online text-white text-xs px-2 py-1 rounded flex items-center gap-1">
                  <CheckCircleIcon className="w-3 h-3" />
                  Downloaded
                </div>
              )}

              <div className="flex items-start gap-4">
                <div className={`
                  p-3 rounded-lg
                  ${option.available ? 'bg-accent text-white' : 'bg-surface-hover text-text-muted'}
                `}>
                  {option.icon}
                </div>
                
                <div className="flex-1">
                  <h3 className="text-lg font-semibold text-text-primary mb-1">
                    {option.name}
                  </h3>
                  <p className="text-sm text-text-secondary mb-3">
                    {option.platform}
                  </p>
                  
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-text-muted">
                      {option.filename} • {option.size}
                    </span>
                    
                    {option.available && (
                      <button
                        disabled={downloading === option.id}
                        className={`
                          flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium
                          ${downloading === option.id
                            ? 'bg-surface-hover text-text-muted'
                            : 'bg-accent hover:bg-accent-hover text-white'}
                          transition-colors
                        `}
                      >
                        {downloading === option.id ? (
                          <>
                            <LoaderIcon className="w-4 h-4 animate-spin" />
                            Downloading...
                          </>
                        ) : (
                          <>
                            <DownloadIcon className="w-4 h-4" />
                            Download
                          </>
                        )}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Instructions */}
        <div className="bg-surface-elevated rounded-xl p-6 border border-border">
          <h2 className="text-lg font-semibold text-text-primary mb-4">
            Installation Instructions
          </h2>
          
          <div className="space-y-4 text-text-secondary">
            <div>
              <h3 className="font-medium text-text-primary mb-1">Windows</h3>
              <ol className="list-decimal list-inside text-sm space-y-1 text-text-secondary">
                <li>Download the .zip file</li>
                <li>Extract the zip to get the .exe installer</li>
                <li>Run the installer (you may need to click "More info" → "Run anyway" if Windows SmartScreen appears)</li>
                <li>Follow the installation wizard</li>
              </ol>
            </div>
            
            <div>
              <h3 className="font-medium text-text-primary mb-1">macOS</h3>
              <ol className="list-decimal list-inside text-sm space-y-1 text-text-secondary">
                <li>Download the .zip file for your Mac type (Intel or Apple Silicon)</li>
                <li>Extract the zip to get the .dmg file</li>
                <li>Open the .dmg and drag Rail Gun to Applications</li>
                <li>Right-click the app and select "Open" the first time (to bypass Gatekeeper)</li>
              </ol>
            </div>
            
            <div>
              <h3 className="font-medium text-text-primary mb-1">Linux</h3>
              <ol className="list-decimal list-inside text-sm space-y-1 text-text-secondary">
                <li>Download the .zip file</li>
                <li>Extract to get the .AppImage or .deb file</li>
                <li>For AppImage: Make it executable with <code className="bg-surface-hover px-1 rounded">chmod +x</code> and run</li>
                <li>For .deb: Install with <code className="bg-surface-hover px-1 rounded">sudo dpkg -i</code></li>
              </ol>
            </div>
          </div>
        </div>

        {/* Share Section */}
        <div className="mt-8 text-center">
          <p className="text-text-secondary mb-2">
            Share Rail Gun with your friends!
          </p>
          <p className="text-sm text-text-muted">
            The zip files can be shared via email, USB drives, cloud storage (Dropbox, Google Drive, OneDrive), 
            messaging apps, or any file transfer method.
          </p>
        </div>
      </div>
    </div>
  );
}

export default DownloadsPage;
