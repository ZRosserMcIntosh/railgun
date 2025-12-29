import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { BillingService } from '../billing/billing.service';

interface AuthResult {
  userId: string;
  deviceId: string;
  isPro: boolean;
}

/**
 * VoiceAuthService
 * 
 * Handles authentication and entitlement verification for voice sockets.
 * Validates JWT from socket handshake and checks Pro status.
 */
@Injectable()
export class VoiceAuthService {
  private readonly logger = new Logger(VoiceAuthService.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly billingService: BillingService,
  ) {}

  /**
   * Authenticate a socket connection.
   * JWT can be in query param or auth header.
   */
  async authenticateSocket(socket: Socket): Promise<AuthResult> {
    // Extract token from handshake
    const token = this.extractToken(socket);
    if (!token) {
      throw new Error('No authentication token provided');
    }

    // Verify JWT
    let payload: { sub: string; deviceId?: string };
    try {
      payload = this.jwtService.verify(token, {
        secret: this.configService.get<string>('JWT_SECRET'),
      });
    } catch (e) {
      throw new Error(`Invalid token: ${(e as Error).message}`);
    }

    if (!payload.sub) {
      throw new Error('Invalid token: missing user ID');
    }

    const userId = payload.sub;
    const deviceId = payload.deviceId || socket.id; // Fallback to socket ID

    // Check Pro status
    const isPro = await this.checkProStatus(userId);

    return {
      userId,
      deviceId,
      isPro,
    };
  }

  /**
   * Extract JWT from socket handshake.
   * Checks query param first, then auth header.
   */
  private extractToken(socket: Socket): string | undefined {
    // Try query param
    const queryToken = socket.handshake.query?.token;
    if (queryToken && typeof queryToken === 'string') {
      return queryToken;
    }

    // Try auth header
    const authHeader = socket.handshake.headers?.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      return authHeader.slice(7);
    }

    return undefined;
  }

  /**
   * Check if user has Pro subscription.
   */
  private async checkProStatus(userId: string): Promise<boolean> {
    try {
      // Use billing service to check subscription status
      const profile = await this.billingService.getProfileByUserId(userId);
      return profile?.subscriptionState === 'active' || profile?.subscriptionState === 'trialing';
    } catch (e) {
      this.logger.warn(`Failed to check Pro status for ${userId}: ${(e as Error).message}`);
      return false;
    }
  }

  /**
   * Refresh Pro status (call when entitlement might have changed).
   */
  async refreshProStatus(userId: string): Promise<boolean> {
    return this.checkProStatus(userId);
  }
}
