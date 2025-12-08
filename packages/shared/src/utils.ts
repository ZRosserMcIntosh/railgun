/**
 * Rail Gun - Utility Functions
 * Shared utility functions used across the application
 */

import { VALIDATION } from './constants.js';

/**
 * Generates a random invite code
 */
export function generateInviteCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 8; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * Validates a username against the allowed pattern
 */
export function isValidUsername(username: string): boolean {
  return VALIDATION.USERNAME.test(username);
}

/**
 * Validates a channel name against the allowed pattern
 */
export function isValidChannelName(name: string): boolean {
  return VALIDATION.CHANNEL_NAME.test(name);
}

/**
 * Validates an invite code
 */
export function isValidInviteCode(code: string): boolean {
  return VALIDATION.INVITE_CODE.test(code);
}

/**
 * Normalizes a channel name (lowercase, replace spaces with hyphens)
 */
export function normalizeChannelName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .slice(0, 100);
}

/**
 * Creates a safe delay promise
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Generates a UUID v4
 * Note: In production, use crypto.randomUUID() or a proper library
 */
export function generateUUID(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback for environments without crypto.randomUUID
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Truncates a string to a maximum length with ellipsis
 */
export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 3) + '...';
}

/**
 * Formats a timestamp for display
 */
export function formatTimestamp(timestamp: number | Date): string {
  const date = typeof timestamp === 'number' ? new Date(timestamp) : timestamp;
  const now = new Date();
  const diff = now.getTime() - date.getTime();

  // Less than a minute
  if (diff < 60000) {
    return 'Just now';
  }

  // Less than an hour
  if (diff < 3600000) {
    const minutes = Math.floor(diff / 60000);
    return `${minutes}m ago`;
  }

  // Less than a day
  if (diff < 86400000) {
    const hours = Math.floor(diff / 3600000);
    return `${hours}h ago`;
  }

  // Same year
  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  // Different year
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Safely parses JSON, returning undefined on failure
 */
export function safeJsonParse<T>(json: string): T | undefined {
  try {
    return JSON.parse(json) as T;
  } catch {
    return undefined;
  }
}

/**
 * Creates a fingerprint display string from raw bytes
 * Groups into 6 groups of 5 digits for easy comparison
 */
export function formatFingerprint(fingerprint: string): string {
  // Assume fingerprint is a hex string, convert to groups of 5 digits
  const clean = fingerprint.replace(/[^0-9a-fA-F]/g, '').toLowerCase();
  const groups: string[] = [];
  for (let i = 0; i < 30 && i < clean.length; i += 5) {
    groups.push(clean.slice(i, i + 5));
  }
  return groups.join(' ');
}

/**
 * Compare two arrays for equality
 */
export function arraysEqual<T>(a: T[], b: T[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
