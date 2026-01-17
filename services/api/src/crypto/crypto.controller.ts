import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { CryptoService, RegisterKeysDto } from './crypto.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UserEntity } from '../users/user.entity';

interface AuthRequest extends Request {
  user: UserEntity;
}

@Controller('keys')
@UseGuards(JwtAuthGuard)
export class CryptoController {
  constructor(private readonly cryptoService: CryptoService) {}

  /**
   * Register device keys for E2E encryption.
   * POST /keys/register
   */
  @Post('register')
  async registerKeys(@Request() req: AuthRequest, @Body() dto: RegisterKeysDto) {
    console.log(`[CryptoController] Registering keys for user ${req.user.id}, deviceId: ${dto.deviceId}`);
    const device = await this.cryptoService.registerDevice(req.user.id, dto);
    console.log(`[CryptoController] Keys registered successfully for device ${device.deviceId}`);
    return {
      deviceId: device.deviceId,
      message: 'Keys registered successfully',
    };
  }

  /**
   * Get pre-key bundle for a user's device(s).
   * GET /keys/bundle/:userId
   */
  @Get('bundle/:userId')
  async getPreKeyBundle(
    @Param('userId') userId: string,
    @Query('deviceId') deviceId?: string,
  ) {
    const bundles = await this.cryptoService.getPreKeyBundle(
      userId,
      deviceId ? parseInt(deviceId, 10) : undefined,
    );
    return { bundles };
  }

  /**
   * Upload additional one-time pre-keys.
   * POST /keys/prekeys
   */
  @Post('prekeys')
  async uploadPreKeys(
    @Request() req: AuthRequest,
    @Body() body: { deviceId: number; preKeys: Array<{ keyId: number; publicKey: string }> },
  ) {
    await this.cryptoService.uploadPreKeys(
      req.user.id,
      body.deviceId,
      body.preKeys,
    );
    return { message: 'Pre-keys uploaded successfully' };
  }

  /**
   * Get the count of available pre-keys.
   * GET /keys/prekeys/count
   */
  @Get('prekeys/count')
  async getPreKeyCount(
    @Request() req: AuthRequest,
    @Query('deviceId') deviceId: string,
  ) {
    const count = await this.cryptoService.getPreKeyCount(
      req.user.id,
      parseInt(deviceId, 10),
    );
    return { count };
  }

  /**
   * Get all devices for the current user.
   * GET /keys/devices
   */
  @Get('devices')
  async getDevices(@Request() req: AuthRequest) {
    const devices = await this.cryptoService.getUserDevices(req.user.id);
    return {
      devices: devices.map((d) => ({
        id: d.id,
        deviceId: d.deviceId,
        deviceType: d.deviceType,
        deviceName: d.deviceName,
        lastActiveAt: d.lastActiveAt,
        createdAt: d.createdAt,
      })),
    };
  }

  /**
   * Get all active devices for a specific user (for DM encryption).
   * GET /keys/devices/:userId
   */
  @Get('devices/:userId')
  async getUserDevices(@Param('userId') userId: string) {
    const devices = await this.cryptoService.getUserDevices(userId);
    return {
      devices: devices
        .filter((d) => d.isActive)
        .map((d) => ({
          deviceId: d.deviceId,
          deviceType: d.deviceType,
        })),
    };
  }

  /**
   * Deactivate a device.
   * DELETE /keys/devices/:deviceId
   */
  @Delete('devices/:deviceId')
  async deactivateDevice(
    @Request() req: AuthRequest,
    @Param('deviceId') deviceId: string,
  ) {
    await this.cryptoService.deactivateDevice(
      req.user.id,
      parseInt(deviceId, 10),
    );
    return { message: 'Device deactivated successfully' };
  }
}
