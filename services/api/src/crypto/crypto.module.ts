import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CryptoService } from './crypto.service';
import { DeviceEntity } from './device.entity';
import { IdentityKeyEntity } from './identity-key.entity';
import { SignedPreKeyEntity } from './signed-prekey.entity';
import { PreKeyEntity } from './prekey.entity';
import { CryptoController } from './crypto.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      DeviceEntity,
      IdentityKeyEntity,
      SignedPreKeyEntity,
      PreKeyEntity,
    ]),
  ],
  controllers: [CryptoController],
  providers: [CryptoService],
  exports: [CryptoService],
})
export class CryptoModule {}
