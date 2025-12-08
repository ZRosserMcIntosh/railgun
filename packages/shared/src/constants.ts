/**
 * Rail Gun - Constants
 * Shared constants used across the application
 */

/** API configuration */
export const API = {
  /** Default API port */
  DEFAULT_PORT: 3001,
  /** API version prefix */
  VERSION: 'v1',
  /** API base path */
  BASE_PATH: '/api/v1',
  /** WebSocket path */
  WS_PATH: '/ws',
} as const;

/** Token configuration */
export const TOKEN = {
  /** Access token expiry in seconds (15 minutes) */
  ACCESS_EXPIRY: 15 * 60,
  /** Refresh token expiry in seconds (7 days) */
  REFRESH_EXPIRY: 7 * 24 * 60 * 60,
  /** Token issuer */
  ISSUER: 'railgun',
} as const;

/** Crypto configuration */
export const CRYPTO = {
  /** Minimum prekeys to keep uploaded */
  MIN_PREKEYS: 10,
  /** Number of prekeys to upload at once */
  PREKEY_BATCH_SIZE: 100,
  /** Maximum prekey ID before wrapping */
  MAX_PREKEY_ID: 0xffffff,
  /** Signed prekey rotation interval (7 days) */
  SIGNED_PREKEY_ROTATION_MS: 7 * 24 * 60 * 60 * 1000,
} as const;

/** WebSocket configuration */
export const WS = {
  /** Heartbeat interval in ms */
  HEARTBEAT_INTERVAL: 30000,
  /** Reconnection delay in ms */
  RECONNECT_DELAY: 1000,
  /** Max reconnection delay in ms */
  MAX_RECONNECT_DELAY: 30000,
  /** Reconnection backoff multiplier */
  RECONNECT_BACKOFF: 1.5,
} as const;

/** Message configuration */
export const MESSAGE = {
  /** Maximum message content length */
  MAX_LENGTH: 4000,
  /** Maximum attachments per message */
  MAX_ATTACHMENTS: 10,
  /** Maximum attachment size in bytes (25MB) */
  MAX_ATTACHMENT_SIZE: 25 * 1024 * 1024,
} as const;

/** Community configuration */
export const COMMUNITY = {
  /** Maximum name length */
  MAX_NAME_LENGTH: 100,
  /** Maximum description length */
  MAX_DESCRIPTION_LENGTH: 1000,
  /** Maximum channels per community */
  MAX_CHANNELS: 500,
  /** Maximum roles per community */
  MAX_ROLES: 250,
} as const;

/** Presence configuration */
export const PRESENCE = {
  /** How often to update presence (ms) */
  UPDATE_INTERVAL: 60000,
  /** How long before user is considered away (ms) */
  AWAY_TIMEOUT: 5 * 60 * 1000,
  /** How long before user is considered offline (ms) */
  OFFLINE_TIMEOUT: 10 * 60 * 1000,
} as const;

/** Validation patterns */
export const VALIDATION = {
  /** Username pattern: 3-32 chars, alphanumeric and underscores */
  USERNAME: /^[a-zA-Z0-9_]{3,32}$/,
  /** Channel name pattern: 1-100 chars, lowercase, numbers, hyphens */
  CHANNEL_NAME: /^[a-z0-9-]{1,100}$/,
  /** Community invite code pattern */
  INVITE_CODE: /^[A-Za-z0-9]{8}$/,
} as const;
