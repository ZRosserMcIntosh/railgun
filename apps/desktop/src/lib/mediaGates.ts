/**
 * Rail Gun Pro - Media Gate Hooks
 * 
 * React hooks for integrating Pro capability gates into media handling.
 * These hooks handle checking capabilities and showing the paywall when needed.
 */

import { useCallback } from 'react';
import { useBillingStore } from '../stores/billingStore';
import {
  Capability,
  FREE_TIER_LIMITS,
  formatFileSize,
  formatDuration,
} from '../billing';

// ============================================================================
// TYPES
// ============================================================================

export interface MediaCheckResult {
  allowed: boolean;
  requiresPro: boolean;
  capability?: Capability;
  /** If an alternative is available (e.g., downscale) */
  canDowngrade?: boolean;
  /** Human-readable message for UI */
  message?: string;
}

export interface ImageCheckOptions {
  /** Show paywall if blocked */
  showPaywall?: boolean;
  /** Offer to downscale */
  offerDownscale?: boolean;
}

export interface VideoCheckOptions {
  /** Show paywall if blocked */
  showPaywall?: boolean;
}

export interface FileCheckOptions {
  /** Show paywall if blocked */
  showPaywall?: boolean;
}

// ============================================================================
// IMAGE GATE
// ============================================================================

/**
 * Hook for checking if an image can be sent.
 * Returns a function that checks dimensions and optionally shows paywall.
 */
export function useImageGate() {
  const { checkImage, openPaywall, hasCapability } = useBillingStore();
  
  const check = useCallback((
    width: number,
    height: number,
    options: ImageCheckOptions = {}
  ): MediaCheckResult => {
    const result = checkImage(width, height);
    
    if (result.allowed) {
      return { allowed: true, requiresPro: false };
    }
    
    const maxDimension = Math.max(width, height);
    const limit = FREE_TIER_LIMITS.MAX_IMAGE_DIMENSION;
    
    // Show paywall if requested
    if (options.showPaywall) {
      openPaywall({
        capability: Capability.HD_MEDIA,
        action: 'send high-resolution image',
        details: { width, height, maxDimension, limit },
      });
    }
    
    return {
      allowed: false,
      requiresPro: true,
      capability: Capability.HD_MEDIA,
      canDowngrade: options.offerDownscale ?? true,
      message: `Image exceeds ${limit}px limit. Upgrade to Pro or downscale.`,
    };
  }, [checkImage, openPaywall]);
  
  /**
   * Calculate target dimensions for downscaling an image to fit free tier.
   */
  const getDownscaleDimensions = useCallback((
    width: number,
    height: number
  ): { width: number; height: number } | null => {
    const maxDimension = Math.max(width, height);
    const limit = FREE_TIER_LIMITS.MAX_IMAGE_DIMENSION;
    
    if (maxDimension <= limit) {
      return null; // No downscale needed
    }
    
    const scale = limit / maxDimension;
    return {
      width: Math.floor(width * scale),
      height: Math.floor(height * scale),
    };
  }, []);
  
  /**
   * Check if user can send HD images.
   */
  const canSendHD = useCallback((): boolean => {
    return hasCapability(Capability.HD_MEDIA);
  }, [hasCapability]);
  
  return {
    check,
    getDownscaleDimensions,
    canSendHD,
    maxFreeDimension: FREE_TIER_LIMITS.MAX_IMAGE_DIMENSION,
  };
}

// ============================================================================
// VIDEO GATE
// ============================================================================

/**
 * Hook for checking if a video can be sent.
 */
export function useVideoGate() {
  const { checkVideo, openPaywall, hasCapability } = useBillingStore();
  
  const check = useCallback((
    durationSeconds: number,
    options: VideoCheckOptions = {}
  ): MediaCheckResult => {
    const result = checkVideo(durationSeconds);
    
    if (result.allowed) {
      return { allowed: true, requiresPro: false };
    }
    
    const limit = FREE_TIER_LIMITS.MAX_VIDEO_SECONDS;
    
    // Show paywall if requested
    if (options.showPaywall) {
      openPaywall({
        capability: Capability.LONG_VIDEO,
        action: 'send long video',
        details: { durationSeconds, limit },
      });
    }
    
    return {
      allowed: false,
      requiresPro: true,
      capability: Capability.LONG_VIDEO,
      canDowngrade: false, // Can't easily trim videos client-side
      message: `Video exceeds ${formatDuration(limit)} limit. Upgrade to Pro.`,
    };
  }, [checkVideo, openPaywall]);
  
  /**
   * Check if user can send long videos.
   */
  const canSendLongVideo = useCallback((): boolean => {
    return hasCapability(Capability.LONG_VIDEO);
  }, [hasCapability]);
  
  return {
    check,
    canSendLongVideo,
    maxFreeSeconds: FREE_TIER_LIMITS.MAX_VIDEO_SECONDS,
  };
}

// ============================================================================
// FILE GATE
// ============================================================================

/**
 * Hook for checking if a file can be sent.
 */
export function useFileGate() {
  const { checkFile, openPaywall, hasCapability } = useBillingStore();
  
  const check = useCallback((
    sizeBytes: number,
    options: FileCheckOptions = {}
  ): MediaCheckResult => {
    const result = checkFile(sizeBytes);
    
    if (result.allowed) {
      return { allowed: true, requiresPro: false };
    }
    
    const limit = FREE_TIER_LIMITS.MAX_FILE_BYTES;
    
    // Show paywall if requested
    if (options.showPaywall) {
      openPaywall({
        capability: Capability.LARGE_FILES,
        action: 'send large file',
        details: { sizeBytes, limit },
      });
    }
    
    return {
      allowed: false,
      requiresPro: true,
      capability: Capability.LARGE_FILES,
      canDowngrade: false,
      message: `File exceeds ${formatFileSize(limit)} limit. Upgrade to Pro.`,
    };
  }, [checkFile, openPaywall]);
  
  /**
   * Check if user can send large files.
   */
  const canSendLargeFiles = useCallback((): boolean => {
    return hasCapability(Capability.LARGE_FILES);
  }, [hasCapability]);
  
  return {
    check,
    canSendLargeFiles,
    maxFreeBytes: FREE_TIER_LIMITS.MAX_FILE_BYTES,
    maxFreeBytesFormatted: formatFileSize(FREE_TIER_LIMITS.MAX_FILE_BYTES),
  };
}

// ============================================================================
// VIDEO CALL GATE
// ============================================================================

/**
 * Hook for checking if video calling is allowed.
 */
export function useVideoCallGate() {
  const { checkVideoCall, openPaywall, hasCapability } = useBillingStore();
  
  const check = useCallback((showPaywall: boolean = false): MediaCheckResult => {
    const result = checkVideoCall();
    
    if (result.allowed) {
      return { allowed: true, requiresPro: false };
    }
    
    // Show paywall if requested
    if (showPaywall) {
      openPaywall({
        capability: Capability.VIDEO_CALLING,
        action: 'start video call',
      });
    }
    
    return {
      allowed: false,
      requiresPro: true,
      capability: Capability.VIDEO_CALLING,
      canDowngrade: true, // Can use voice-only
      message: 'Video calling requires Pro. Voice calls are always free.',
    };
  }, [checkVideoCall, openPaywall]);
  
  /**
   * Check if user can make video calls.
   */
  const canVideoCall = useCallback((): boolean => {
    return hasCapability(Capability.VIDEO_CALLING);
  }, [hasCapability]);
  
  return {
    check,
    canVideoCall,
  };
}

// ============================================================================
// SCREEN SHARE GATE
// ============================================================================

/**
 * Hook for checking if screen sharing is allowed.
 */
export function useScreenShareGate() {
  const { checkScreenShare, openPaywall, hasCapability } = useBillingStore();
  
  const check = useCallback((showPaywall: boolean = false): MediaCheckResult => {
    const result = checkScreenShare();
    
    if (result.allowed) {
      return { allowed: true, requiresPro: false };
    }
    
    // Show paywall if requested
    if (showPaywall) {
      openPaywall({
        capability: Capability.SCREEN_SHARE,
        action: 'share screen',
      });
    }
    
    return {
      allowed: false,
      requiresPro: true,
      capability: Capability.SCREEN_SHARE,
      canDowngrade: false,
      message: 'Screen sharing requires Pro.',
    };
  }, [checkScreenShare, openPaywall]);
  
  /**
   * Check if user can share screen.
   */
  const canScreenShare = useCallback((): boolean => {
    return hasCapability(Capability.SCREEN_SHARE);
  }, [hasCapability]);
  
  return {
    check,
    canScreenShare,
  };
}

// ============================================================================
// COMBINED GATE FOR MEDIA SELECTION
// ============================================================================

/**
 * Combined hook for checking any media type.
 * Useful for file upload handlers that need to check various file types.
 */
export function useMediaGate() {
  const imageGate = useImageGate();
  const videoGate = useVideoGate();
  const fileGate = useFileGate();
  
  /**
   * Check if a media item can be sent based on its type and properties.
   */
  const checkMedia = useCallback((options: {
    type: 'image' | 'video' | 'file';
    width?: number;
    height?: number;
    durationSeconds?: number;
    sizeBytes?: number;
    showPaywall?: boolean;
  }): MediaCheckResult => {
    const { type, width, height, durationSeconds, sizeBytes, showPaywall } = options;
    
    switch (type) {
      case 'image':
        if (width && height) {
          return imageGate.check(width, height, { showPaywall, offerDownscale: true });
        }
        break;
      
      case 'video':
        if (durationSeconds !== undefined) {
          return videoGate.check(durationSeconds, { showPaywall });
        }
        break;
      
      case 'file':
        if (sizeBytes !== undefined) {
          return fileGate.check(sizeBytes, { showPaywall });
        }
        break;
    }
    
    // Default: allowed if we don't have enough info to check
    return { allowed: true, requiresPro: false };
  }, [imageGate, videoGate, fileGate]);
  
  return {
    checkMedia,
    imageGate,
    videoGate,
    fileGate,
  };
}
