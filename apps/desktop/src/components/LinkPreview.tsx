import { useState, useEffect } from 'react';
import { LinkPreview as LinkPreviewType } from '../stores/chatStore';

interface LinkPreviewProps {
  url: string;
  preview?: LinkPreviewType;
  onPreviewLoad?: (preview: LinkPreviewType) => void;
}

// Regex to extract URLs from text
export const URL_REGEX = /https?:\/\/[^\s<]+[^<.,:;"')\]\s]/g;

export function extractUrls(text: string): string[] {
  const matches = text.match(URL_REGEX);
  return matches ? [...new Set(matches)] : [];
}

// Mock function to fetch link preview (in production, this would call a backend service)
async function fetchLinkPreview(url: string): Promise<LinkPreviewType | null> {
  try {
    // In a real app, this would call a backend service to fetch OG tags
    // For now, we'll just create a basic preview from the URL
    const urlObj = new URL(url);
    const domain = urlObj.hostname.replace('www.', '');
    
    return {
      url,
      siteName: domain,
      title: `Link to ${domain}`,
      description: url,
    };
  } catch {
    return null;
  }
}

export default function LinkPreview({ url, preview, onPreviewLoad }: LinkPreviewProps) {
  const [localPreview, setLocalPreview] = useState<LinkPreviewType | null>(preview || null);
  const [loading, setLoading] = useState(!preview);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (preview) {
      setLocalPreview(preview);
      setLoading(false);
      return;
    }

    const loadPreview = async () => {
      setLoading(true);
      const result = await fetchLinkPreview(url);
      if (result) {
        setLocalPreview(result);
        onPreviewLoad?.(result);
      } else {
        setError(true);
      }
      setLoading(false);
    };

    loadPreview();
  }, [url, preview, onPreviewLoad]);

  if (error || (!loading && !localPreview)) {
    return null;
  }

  if (loading) {
    return (
      <div className="mt-2 p-3 bg-surface-primary/30 rounded-lg border border-dark-700 animate-pulse">
        <div className="h-4 w-2/3 bg-surface-primary rounded mb-2" />
        <div className="h-3 w-full bg-surface-primary rounded" />
      </div>
    );
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-2 flex gap-3 p-3 bg-surface-primary/30 rounded-lg border border-dark-700 hover:border-dark-600 transition-colors group"
    >
      {localPreview?.imageUrl && (
        <div className="w-20 h-20 rounded overflow-hidden flex-shrink-0">
          <img
            src={localPreview.imageUrl}
            alt=""
            className="w-full h-full object-cover"
          />
        </div>
      )}
      <div className="flex-1 min-w-0">
        {localPreview?.siteName && (
          <p className="text-xs text-text-muted mb-0.5">{localPreview.siteName}</p>
        )}
        {localPreview?.title && (
          <p className="text-sm font-medium text-text-primary group-hover:text-primary-400 transition-colors line-clamp-1">
            {localPreview.title}
          </p>
        )}
        {localPreview?.description && (
          <p className="text-xs text-text-muted mt-0.5 line-clamp-2">
            {localPreview.description}
          </p>
        )}
      </div>
      <svg className="w-4 h-4 text-text-muted flex-shrink-0 group-hover:text-primary-400 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
      </svg>
    </a>
  );
}
