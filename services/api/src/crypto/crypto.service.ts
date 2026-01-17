import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { DeviceEntity } from './device.entity';
import { IdentityKeyEntity } from './identity-key.entity';
import { SignedPreKeyEntity } from './signed-prekey.entity';
import { PreKeyEntity } from './prekey.entity';
import { DeviceType } from '@railgun/shared';

/** DTO for registering device keys */
export interface RegisterKeysDto {
  deviceId: number;
  deviceType: DeviceType;
  deviceName?: string;
  identityKey: string;
  registrationId: number;
  signedPreKey: {
    keyId: number;
    publicKey: string;
    signature: string;
  };
  preKeys: Array<{
    keyId: number;
    publicKey: string;
  }>;
}

/** DTO for pre-key bundle response */
export interface PreKeyBundleDto {
  deviceId: number;
  registrationId: number;
  identityKey: string;
  signedPreKey: {
    keyId: number;
    publicKey: string;
    signature: string;
  };
  preKey?: {
    keyId: number;
    publicKey: string;
  };
}

@Injectable()
export class CryptoService {
  constructor(
    @InjectRepository(DeviceEntity)
    private readonly deviceRepository: Repository<DeviceEntity>,
    @InjectRepository(IdentityKeyEntity)
    private readonly identityKeyRepository: Repository<IdentityKeyEntity>,
    @InjectRepository(SignedPreKeyEntity)
    private readonly signedPreKeyRepository: Repository<SignedPreKeyEntity>,
    @InjectRepository(PreKeyEntity)
    private readonly preKeyRepository: Repository<PreKeyEntity>,
  ) {}

  /**
   * Register a new device with its Signal protocol keys.
   * Supports server-assigned device IDs when client passes deviceId=0.
   */
  async registerDevice(userId: string, dto: RegisterKeysDto): Promise<DeviceEntity> {
    let assignedDeviceId = dto.deviceId;

    // Server-assigned device ID when client passes 0
    if (dto.deviceId === 0) {
      // Find the highest existing deviceId for this user
      const existingDevices = await this.deviceRepository.find({
        where: { userId },
        order: { deviceId: 'DESC' },
        take: 1,
      });
      assignedDeviceId = existingDevices.length > 0 
        ? existingDevices[0].deviceId + 1 
        : 1;
    }

    // Check if device already exists
    let device = await this.deviceRepository.findOne({
      where: { userId, deviceId: assignedDeviceId },
    });

    if (device) {
      // Update existing device
      device.deviceType = dto.deviceType;
      device.deviceName = dto.deviceName;
      device.lastActiveAt = new Date();
      device.isActive = true;
    } else {
      // Create new device
      device = this.deviceRepository.create({
        userId,
        deviceId: assignedDeviceId,
        deviceType: dto.deviceType,
        deviceName: dto.deviceName,
        lastActiveAt: new Date(),
        isActive: true,
      });
    }

    device = await this.deviceRepository.save(device);

    // Store identity key
    await this.identityKeyRepository.upsert(
      {
        deviceId: device.id,
        publicKey: dto.identityKey,
        registrationId: dto.registrationId,
      },
      ['deviceId'],
    );

    // Store signed pre-key
    const signedPreKeyExpiry = new Date();
    signedPreKeyExpiry.setDate(signedPreKeyExpiry.getDate() + 30); // 30 days

    // Deactivate old signed pre-keys
    await this.signedPreKeyRepository.update(
      { deviceId: device.id },
      { isActive: false },
    );

    // Upsert signed pre-key (handles re-registration with same keyId)
    await this.signedPreKeyRepository.upsert(
      {
        deviceId: device.id,
        keyId: dto.signedPreKey.keyId,
        publicKey: dto.signedPreKey.publicKey,
        signature: dto.signedPreKey.signature,
        expiresAt: signedPreKeyExpiry,
        isActive: true,
      },
      ['deviceId', 'keyId'],
    );

    // Delete ALL existing pre-keys for this device before inserting new ones
    // When re-registering, old keys are invalid anyway
    await this.preKeyRepository.delete({
      deviceId: device.id,
    });

    // Store one-time pre-keys
    const preKeys = dto.preKeys.map((pk) =>
      this.preKeyRepository.create({
        deviceId: device!.id,
        keyId: pk.keyId,
        publicKey: pk.publicKey,
        isUsed: false,
      }),
    );

    await this.preKeyRepository.save(preKeys);

    return device;
  }

  /**
   * Get a pre-key bundle for initiating a session with a user's device.
   */
  async getPreKeyBundle(userId: string, deviceId?: number): Promise<PreKeyBundleDto[]> {
    // Find user's devices
    const whereClause: { userId: string; deviceId?: number; isActive: boolean } = {
      userId,
      isActive: true,
    };
    if (deviceId !== undefined) {
      whereClause.deviceId = deviceId;
    }

    const devices = await this.deviceRepository.find({
      where: whereClause,
    });

    if (devices.length === 0) {
      throw new NotFoundException('No active devices found for user');
    }

    const bundles: PreKeyBundleDto[] = [];

    for (const device of devices) {
      // Get identity key
      const identityKey = await this.identityKeyRepository.findOne({
        where: { deviceId: device.id },
      });

      if (!identityKey) {
        continue; // Skip devices without identity keys
      }

      // Get active signed pre-key
      const signedPreKey = await this.signedPreKeyRepository.findOne({
        where: { deviceId: device.id, isActive: true },
        order: { createdAt: 'DESC' },
      });

      if (!signedPreKey) {
        continue; // Skip devices without signed pre-keys
      }

      // Get an unused one-time pre-key (and mark it as used)
      const preKey = await this.preKeyRepository.findOne({
        where: { deviceId: device.id, isUsed: false },
        order: { keyId: 'ASC' },
      });

      if (preKey) {
        preKey.isUsed = true;
        preKey.usedAt = new Date();
        await this.preKeyRepository.save(preKey);
      }

      bundles.push({
        deviceId: device.deviceId,
        registrationId: identityKey.registrationId,
        identityKey: identityKey.publicKey,
        signedPreKey: {
          keyId: signedPreKey.keyId,
          publicKey: signedPreKey.publicKey,
          signature: signedPreKey.signature,
        },
        preKey: preKey
          ? {
              keyId: preKey.keyId,
              publicKey: preKey.publicKey,
            }
          : undefined,
      });
    }

    if (bundles.length === 0) {
      throw new NotFoundException('No valid key bundles found for user');
    }

    return bundles;
  }

  /**
   * Upload additional one-time pre-keys.
   */
  async uploadPreKeys(
    userId: string,
    deviceId: number,
    preKeys: Array<{ keyId: number; publicKey: string }>,
  ): Promise<void> {
    const device = await this.deviceRepository.findOne({
      where: { userId, deviceId },
    });

    if (!device) {
      throw new NotFoundException('Device not found');
    }

    const newPreKeys = preKeys.map((pk) =>
      this.preKeyRepository.create({
        deviceId: device.id,
        keyId: pk.keyId,
        publicKey: pk.publicKey,
        isUsed: false,
      }),
    );

    await this.preKeyRepository.save(newPreKeys);
  }

  /**
   * Get the count of available (unused) pre-keys for a device.
   */
  async getPreKeyCount(userId: string, deviceId: number): Promise<number> {
    const device = await this.deviceRepository.findOne({
      where: { userId, deviceId },
    });

    if (!device) {
      throw new NotFoundException('Device not found');
    }

    return this.preKeyRepository.count({
      where: { deviceId: device.id, isUsed: false },
    });
  }

  /**
   * Get all devices for a user.
   */
  async getUserDevices(userId: string): Promise<DeviceEntity[]> {
    return this.deviceRepository.find({
      where: { userId, isActive: true },
      order: { lastActiveAt: 'DESC' },
    });
  }

  /**
   * Get a specific device by user ID and device ID.
   */
  async getDeviceByUserAndDeviceId(userId: string, deviceId: number): Promise<DeviceEntity | null> {
    return this.deviceRepository.findOne({
      where: { userId, deviceId, isActive: true },
    });
  }

  /**
   * Deactivate a device.
   */
  async deactivateDevice(userId: string, deviceId: number): Promise<void> {
    const result = await this.deviceRepository.update(
      { userId, deviceId },
      { isActive: false },
    );

    if (result.affected === 0) {
      throw new NotFoundException('Device not found');
    }
  }

  /**
   * Clean up expired signed pre-keys.
   */
  async cleanupExpiredKeys(): Promise<void> {
    // Delete used pre-keys older than 7 days
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    await this.preKeyRepository.delete({
      isUsed: true,
      usedAt: LessThan(sevenDaysAgo),
    });

    // Deactivate expired signed pre-keys (where expiresAt is in the past)
    await this.signedPreKeyRepository.update(
      { expiresAt: LessThan(new Date()), isActive: true },
      { isActive: false },
    );
  }
}
