/**
 * QR Auth Bridge Types
 * 
 * Types for the QR-based authentication bridge between web/desktop and mobile.
 */

/**
 * Session status values
 */
export enum QRAuthSessionStatus {
  /** Session created, waiting for scan */
  PENDING = 'pending',
  /** QR code scanned, awaiting confirmation */
  SCANNED = 'scanned',
  /** Session completed successfully */
  COMPLETED = 'completed',
  /** Session expired */
  EXPIRED = 'expired',
  /** Session cancelled */
  CANCELLED = 'cancelled',
}

/**
 * QR code payload structure
 */
export interface QRAuthPayload {
  type: 'railgun-auth';
  version: number;
  sessionId: string;
  secret: string;
  expiresAt: string;
}

/**
 * Session creation response
 */
export interface CreateSessionResponse {
  sessionId: string;
  qrPayload: string;
  expiresAt: string;
  pollUrl: string;
}

/**
 * Session status response
 */
export interface SessionStatusResponse {
  sessionId: string;
  status: QRAuthSessionStatus;
  expiresAt: string;
  ready: boolean;
}

/**
 * Token exchange response
 */
export interface TokenExchangeResponse {
  token: string;
  expiresIn: number;
}

/**
 * WebSocket events
 */
export interface SessionScannedEvent {
  sessionId: string;
  status: 'scanned';
}

export interface SessionCompletedEvent {
  sessionId: string;
  status: 'completed';
  ready: boolean;
}

export interface SessionCancelledEvent {
  sessionId: string;
  status: 'cancelled';
}

export type SessionEvent = SessionScannedEvent | SessionCompletedEvent | SessionCancelledEvent;
