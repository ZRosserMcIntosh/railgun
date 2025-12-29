import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { BillingModule } from '../billing/billing.module';

import { VoiceGateway } from './voice.gateway';
import { VoiceService } from './voice.service';
import { VoiceAuthService } from './voice-auth.service';
import { VoiceRoomService } from './voice-room.service';
import { VoiceSfuService } from './voice-sfu.service';

/**
 * VoiceModule
 * 
 * Provides voice/video calling functionality.
 * 
 * Dependencies:
 * - mediasoup: SFU for WebRTC
 * - Redis: Room-to-SFU stickiness
 * - BillingModule: Pro status checks
 * 
 * Before using, install:
 * ```
 * pnpm add mediasoup@3
 * ```
 */
@Module({
  imports: [
    ConfigModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET'),
        signOptions: { expiresIn: '7d' },
      }),
    }),
    BillingModule,
  ],
  providers: [
    VoiceGateway,
    VoiceService,
    VoiceAuthService,
    VoiceRoomService,
    VoiceSfuService,
  ],
  exports: [
    VoiceService,
    VoiceRoomService,
  ],
})
export class VoiceModule {}
