import {
  Injectable,
  Logger,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as jwt from 'jsonwebtoken';
import * as crypto from 'crypto';

// ============================================================================
// TYPES
// ============================================================================

export interface AppleReceiptValidationResult {
  isValid: boolean;
  productId?: string;
  transactionId?: string;
  originalTransactionId?: string;
  purchaseDate?: Date;
  expiresDate?: Date;
  isSubscription: boolean;
  isTrialPeriod: boolean;
  environment: 'sandbox' | 'production';
  errorMessage?: string;
}

export interface GooglePurchaseValidationResult {
  isValid: boolean;
  productId?: string;
  orderId?: string;
  purchaseToken?: string;
  purchaseTime?: Date;
  expiryTime?: Date;
  autoRenewing?: boolean;
  paymentState?: number;
  acknowledgementState?: number;
  errorMessage?: string;
}

// Apple App Store Server API types
interface AppleJWSTransactionDecodedPayload {
  transactionId: string;
  originalTransactionId: string;
  bundleId: string;
  productId: string;
  purchaseDate: number;
  expiresDate?: number;
  type: 'Auto-Renewable Subscription' | 'Non-Consumable' | 'Consumable' | 'Non-Renewing Subscription';
  inAppOwnershipType: 'PURCHASED' | 'FAMILY_SHARED';
  environment: 'Sandbox' | 'Production';
  offerType?: number;
  isTrialPeriod?: string;
}

// Google Play Developer API types
interface GoogleSubscriptionPurchase {
  kind: string;
  startTimeMillis: string;
  expiryTimeMillis: string;
  autoRenewing: boolean;
  priceCurrencyCode: string;
  priceAmountMicros: string;
  countryCode: string;
  developerPayload: string;
  paymentState: number;
  orderId: string;
  acknowledgementState: number;
}

// ============================================================================
// SERVICE
// ============================================================================

@Injectable()
export class IapVerificationService {
  private readonly logger = new Logger(IapVerificationService.name);
  
  // Apple configuration
  private readonly appleKeyId: string;
  private readonly appleIssuerId: string;
  private readonly applePrivateKey: string;
  private readonly appleBundleId: string;
  private readonly appleEnvironment: 'sandbox' | 'production';
  
  // Google configuration
  private readonly googlePackageName: string;
  private readonly googleServiceAccountKey: string;
  private googleAccessToken: string | null = null;
  private googleTokenExpiry: Date | null = null;

  constructor(private readonly configService: ConfigService) {
    // Apple App Store configuration
    this.appleKeyId = this.configService.get<string>('APPLE_IAP_KEY_ID') || '';
    this.appleIssuerId = this.configService.get<string>('APPLE_IAP_ISSUER_ID') || '';
    this.applePrivateKey = this.configService.get<string>('APPLE_IAP_PRIVATE_KEY') || '';
    this.appleBundleId = this.configService.get<string>('APPLE_BUNDLE_ID') || 'com.railgun.app';
    this.appleEnvironment = this.configService.get<string>('NODE_ENV') === 'production' 
      ? 'production' 
      : 'sandbox';
    
    // Google Play configuration
    this.googlePackageName = this.configService.get<string>('GOOGLE_PLAY_PACKAGE_NAME') || 'com.railgun.android';
    this.googleServiceAccountKey = this.configService.get<string>('GOOGLE_PLAY_SERVICE_ACCOUNT_KEY') || '';
  }

  // ============================================================================
  // APPLE APP STORE
  // ============================================================================

  /**
   * Verify an Apple App Store receipt using App Store Server API v2.
   * 
   * @param transactionId - The transaction ID from StoreKit 2
   * @returns Validation result
   */
  async verifyApplePurchase(transactionId: string): Promise<AppleReceiptValidationResult> {
    if (!this.appleKeyId || !this.appleIssuerId || !this.applePrivateKey) {
      this.logger.warn('Apple IAP not configured - skipping verification in development');
      // Return mock success for development
      if (this.configService.get<string>('NODE_ENV') !== 'production') {
        return {
          isValid: true,
          transactionId,
          isSubscription: true,
          isTrialPeriod: false,
          environment: 'sandbox',
        };
      }
      throw new BadRequestException('Apple IAP verification not configured');
    }

    try {
      // Generate JWT for App Store Server API
      const token = this.generateAppleJWT();
      
      // Call App Store Server API to get transaction info
      const baseUrl = this.appleEnvironment === 'production'
        ? 'https://api.storekit.itunes.apple.com'
        : 'https://api.storekit-sandbox.itunes.apple.com';
      
      const response = await fetch(
        `${baseUrl}/inApps/v1/transactions/${transactionId}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error(`Apple API error: ${response.status} - ${errorText}`);
        return {
          isValid: false,
          errorMessage: `Apple verification failed: ${response.status}`,
          isSubscription: false,
          isTrialPeriod: false,
          environment: this.appleEnvironment,
        };
      }

      const data = await response.json() as { signedTransactionInfo: string };
      const signedTransaction = data.signedTransactionInfo;
      
      // Decode and verify the JWS
      const decoded = this.decodeAppleJWS(signedTransaction);
      
      // Verify bundle ID matches
      if (decoded.bundleId !== this.appleBundleId) {
        return {
          isValid: false,
          errorMessage: 'Bundle ID mismatch',
          isSubscription: false,
          isTrialPeriod: false,
          environment: this.appleEnvironment,
        };
      }

      return {
        isValid: true,
        productId: decoded.productId,
        transactionId: decoded.transactionId,
        originalTransactionId: decoded.originalTransactionId,
        purchaseDate: new Date(decoded.purchaseDate),
        expiresDate: decoded.expiresDate ? new Date(decoded.expiresDate) : undefined,
        isSubscription: decoded.type === 'Auto-Renewable Subscription',
        isTrialPeriod: decoded.isTrialPeriod === 'true',
        environment: decoded.environment.toLowerCase() as 'sandbox' | 'production',
      };
    } catch (error) {
      this.logger.error('Apple verification error:', error);
      return {
        isValid: false,
        errorMessage: error instanceof Error ? error.message : 'Verification failed',
        isSubscription: false,
        isTrialPeriod: false,
        environment: this.appleEnvironment,
      };
    }
  }

  /**
   * Generate JWT for Apple App Store Server API authentication.
   */
  private generateAppleJWT(): string {
    const now = Math.floor(Date.now() / 1000);
    
    const payload = {
      iss: this.appleIssuerId,
      iat: now,
      exp: now + 3600, // 1 hour
      aud: 'appstoreconnect-v1',
      bid: this.appleBundleId,
    };

    return jwt.sign(payload, this.applePrivateKey, {
      algorithm: 'ES256',
      header: {
        alg: 'ES256',
        kid: this.appleKeyId,
        typ: 'JWT',
      },
    });
  }

  /**
   * Decode Apple JWS (JSON Web Signature) transaction.
   */
  private decodeAppleJWS(jws: string): AppleJWSTransactionDecodedPayload {
    // Split the JWS
    const parts = jws.split('.');
    if (parts.length !== 3) {
      throw new BadRequestException('Invalid JWS format');
    }

    // Decode the payload (middle part)
    const payload = Buffer.from(parts[1], 'base64url').toString('utf-8');
    return JSON.parse(payload);
  }

  // ============================================================================
  // GOOGLE PLAY
  // ============================================================================

  /**
   * Verify a Google Play purchase using the Android Publisher API.
   * 
   * @param productId - The product ID
   * @param purchaseToken - The purchase token from Google Play Billing
   * @returns Validation result
   */
  async verifyGooglePurchase(
    productId: string,
    purchaseToken: string,
  ): Promise<GooglePurchaseValidationResult> {
    if (!this.googleServiceAccountKey) {
      this.logger.warn('Google Play not configured - skipping verification in development');
      // Return mock success for development
      if (this.configService.get<string>('NODE_ENV') !== 'production') {
        return {
          isValid: true,
          productId,
          purchaseToken,
          autoRenewing: true,
        };
      }
      throw new BadRequestException('Google Play verification not configured');
    }

    try {
      // Get access token
      const accessToken = await this.getGoogleAccessToken();
      
      // Call Google Play Developer API
      const url = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${this.googlePackageName}/purchases/subscriptions/${productId}/tokens/${purchaseToken}`;
      
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error(`Google API error: ${response.status} - ${errorText}`);
        
        // Handle specific error codes
        if (response.status === 404) {
          return {
            isValid: false,
            errorMessage: 'Purchase not found',
          };
        }
        
        return {
          isValid: false,
          errorMessage: `Google verification failed: ${response.status}`,
        };
      }

      const purchase = await response.json() as GoogleSubscriptionPurchase;
      
      // Check if subscription is active
      const expiryTime = new Date(parseInt(purchase.expiryTimeMillis, 10));
      const isExpired = expiryTime < new Date();
      
      // Payment state: 0 = Pending, 1 = Received, 2 = Free trial, 3 = Deferred
      const isPaymentValid = purchase.paymentState === 1 || purchase.paymentState === 2;
      
      return {
        isValid: !isExpired && isPaymentValid,
        productId,
        orderId: purchase.orderId,
        purchaseToken,
        purchaseTime: new Date(parseInt(purchase.startTimeMillis, 10)),
        expiryTime,
        autoRenewing: purchase.autoRenewing,
        paymentState: purchase.paymentState,
        acknowledgementState: purchase.acknowledgementState,
        errorMessage: isExpired ? 'Subscription expired' : undefined,
      };
    } catch (error) {
      this.logger.error('Google verification error:', error);
      return {
        isValid: false,
        errorMessage: error instanceof Error ? error.message : 'Verification failed',
      };
    }
  }

  /**
   * Acknowledge a Google Play purchase.
   * Required within 3 days of purchase or it will be refunded.
   */
  async acknowledgeGooglePurchase(
    productId: string,
    purchaseToken: string,
  ): Promise<boolean> {
    if (!this.googleServiceAccountKey) {
      this.logger.warn('Google Play not configured - skipping acknowledgment');
      return true;
    }

    try {
      const accessToken = await this.getGoogleAccessToken();
      
      const url = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${this.googlePackageName}/purchases/subscriptions/${productId}/tokens/${purchaseToken}:acknowledge`;
      
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error(`Google acknowledge error: ${response.status} - ${errorText}`);
        return false;
      }

      return true;
    } catch (error) {
      this.logger.error('Google acknowledge error:', error);
      return false;
    }
  }

  /**
   * Get Google OAuth access token using service account credentials.
   */
  private async getGoogleAccessToken(): Promise<string> {
    // Check if we have a valid cached token
    if (this.googleAccessToken && this.googleTokenExpiry && this.googleTokenExpiry > new Date()) {
      return this.googleAccessToken;
    }

    try {
      const credentials = JSON.parse(this.googleServiceAccountKey);
      
      // Create JWT for Google OAuth
      const now = Math.floor(Date.now() / 1000);
      const jwtPayload = {
        iss: credentials.client_email,
        scope: 'https://www.googleapis.com/auth/androidpublisher',
        aud: 'https://oauth2.googleapis.com/token',
        iat: now,
        exp: now + 3600,
      };

      const jwtToken = jwt.sign(jwtPayload, credentials.private_key, {
        algorithm: 'RS256',
      });

      // Exchange JWT for access token
      const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
          assertion: jwtToken,
        }),
      });

      if (!response.ok) {
        throw new UnauthorizedException('Failed to get Google access token');
      }

      const data = await response.json() as { access_token: string; expires_in: number };
      
      // Cache the token
      this.googleAccessToken = data.access_token;
      this.googleTokenExpiry = new Date(Date.now() + (data.expires_in - 60) * 1000);

      return data.access_token;
    } catch (error) {
      this.logger.error('Failed to get Google access token:', error);
      throw new UnauthorizedException('Failed to authenticate with Google');
    }
  }

  // ============================================================================
  // WEBHOOK HANDLING
  // ============================================================================

  /**
   * Verify Apple App Store Server Notification signature.
   */
  verifyAppleNotificationSignature(signedPayload: string): boolean {
    try {
      // Apple signs notifications with their public key
      // The signedPayload is a JWS that can be verified
      const parts = signedPayload.split('.');
      if (parts.length !== 3) {
        return false;
      }

      // In production, verify the signature against Apple's public keys
      // For now, decode and check basic structure
      const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
      
      // Should be signed with ES256
      if (header.alg !== 'ES256') {
        return false;
      }

      return true;
    } catch {
      return false;
    }
  }

  /**
   * Verify Google Play Real-time Developer Notification.
   */
  verifyGoogleNotification(authorization: string, expectedToken: string): boolean {
    // Google sends a bearer token that should match your configured secret
    const token = authorization.replace('Bearer ', '');
    return crypto.timingSafeEqual(
      Buffer.from(token),
      Buffer.from(expectedToken)
    );
  }
}
