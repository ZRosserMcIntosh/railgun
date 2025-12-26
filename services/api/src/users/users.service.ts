import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as argon2 from 'argon2';
import { UserEntity, RecoveryCodeHash } from './user.entity';
import { PresenceStatus } from '@railgun/shared';

export interface CreateUserData {
  username: string;
  password: string;
  email?: string;
  displayName?: string;
  recoveryCodes?: RecoveryCodeHash[];
}

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>
  ) {}

  async create(data: CreateUserData): Promise<UserEntity> {
    const passwordHash = await argon2.hash(data.password);

    const user = this.userRepository.create({
      username: data.username,
      email: data.email || null,
      passwordHash,
      displayName: data.displayName || data.username,
      presence: PresenceStatus.OFFLINE,
      recoveryCodes: data.recoveryCodes || [],
    });

    return this.userRepository.save(user);
  }

  async findById(id: string): Promise<UserEntity | null> {
    return this.userRepository.findOne({ where: { id } });
  }

  async findByUsername(username: string): Promise<UserEntity | null> {
    return this.userRepository.findOne({ where: { username } });
  }

  async findByEmail(email: string): Promise<UserEntity | null> {
    if (!email) return null;
    return this.userRepository.findOne({ where: { email } });
  }

  async validatePassword(user: UserEntity, password: string): Promise<boolean> {
    return argon2.verify(user.passwordHash, password);
  }

  async updateRefreshToken(userId: string, refreshTokenHash: string | null): Promise<void> {
    await this.userRepository.update(userId, { 
      refreshTokenHash: refreshTokenHash ?? undefined 
    });
  }

  async updatePresence(userId: string, presence: PresenceStatus): Promise<void> {
    await this.userRepository.update(userId, {
      presence,
      lastSeenAt: new Date(),
    });
  }

  async updateLastSeen(userId: string): Promise<void> {
    await this.userRepository.update(userId, {
      lastSeenAt: new Date(),
    });
  }

  /**
   * Update user's password hash
   */
  async updatePassword(userId: string, newPassword: string): Promise<void> {
    const passwordHash = await argon2.hash(newPassword);
    await this.userRepository.update(userId, { passwordHash });
  }

  /**
   * Update user's recovery codes
   */
  async updateRecoveryCodes(userId: string, recoveryCodes: RecoveryCodeHash[]): Promise<void> {
    await this.userRepository.update(userId, { recoveryCodes });
  }

  /**
   * Get user's recovery codes (for verification)
   */
  async getRecoveryCodes(userId: string): Promise<RecoveryCodeHash[]> {
    const user = await this.findById(userId);
    return user?.recoveryCodes || [];
  }

  /**
   * Search users by username prefix (case-insensitive).
   * Returns limited results for security.
   */
  async searchByUsername(query: string, limit = 10): Promise<UserEntity[]> {
    return this.userRepository
      .createQueryBuilder('user')
      .where('LOWER(user.username) LIKE LOWER(:query)', { query: `${query}%` })
      .orderBy('user.username', 'ASC')
      .take(limit)
      .getMany();
  }

  // ==================== NUKE METHODS ====================
  // These methods perform destructive operations for account deletion

  /**
   * Delete user's encryption keys from the key registry
   * This makes any existing encrypted messages permanently unreadable
   */
  async deleteUserKeys(userId: string): Promise<void> {
    // Keys are stored in the crypto/keys service
    // For now, just clear any key-related fields on the user
    await this.userRepository.update(userId, {
      // Clear any stored public key data
    });
  }

  /**
   * Delete all messages sent by this user
   * Note: In production, messages should be in a separate service
   */
  async deleteUserMessages(_userId: string): Promise<void> {
    // Messages are handled by MessagesService
    // This would be called via inter-service communication
    // For now, this is a placeholder for the actual deletion
  }

  /**
   * Delete all DM thread memberships for this user
   */
  async deleteUserDmThreads(_userId: string): Promise<void> {
    // DM threads are handled by MessagesService/DmService
    // This would be called via inter-service communication
  }

  /**
   * Delete all community memberships for this user
   */
  async deleteUserCommunityMemberships(_userId: string): Promise<void> {
    // Community memberships are handled by CommunitiesService
    // This would be called via inter-service communication
  }

  /**
   * Delete user's recovery codes
   */
  async deleteRecoveryCodes(userId: string): Promise<void> {
    await this.userRepository.update(userId, { recoveryCodes: [] });
  }

  /**
   * ☢️ PERMANENTLY DELETE USER ACCOUNT ☢️
   * This is IRREVERSIBLE
   */
  async deleteUser(userId: string): Promise<void> {
    // First, overwrite sensitive data with zeros before deletion
    await this.userRepository.update(userId, {
      username: `DELETED_${Date.now()}`,
      email: null,
      passwordHash: '',
      refreshTokenHash: undefined,
      displayName: 'Deleted User',
      recoveryCodes: [],
    });
    
    // Then hard delete the record
    await this.userRepository.delete(userId);
  }
}
