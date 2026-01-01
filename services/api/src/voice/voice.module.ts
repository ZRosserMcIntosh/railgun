import { Module, forwardRef, OnModuleInit } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ModuleRef } from '@nestjs/core';

import { BillingModule } from '../billing/billing.module';
import { CommunitiesModule } from '../communities/communities.module';
import { CommunitiesService } from '../communities/communities.service';

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
 * - CommunitiesModule: Channel permission validation
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
    forwardRef(() => CommunitiesModule),
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
export class VoiceModule implements OnModuleInit {
  constructor(
    private readonly moduleRef: ModuleRef,
    private readonly voiceService: VoiceService,
  ) {}

  /**
   * Wire up CommunitiesService to VoiceService for permission validation.
   * Done in onModuleInit to avoid circular dependency issues.
   */
  onModuleInit() {
    const communitiesService = this.moduleRef.get(CommunitiesService, { strict: false });
    if (communitiesService) {
      this.voiceService.setChannelValidationService(communitiesService);
    }
  }
}
