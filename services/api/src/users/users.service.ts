import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as argon2 from 'argon2';
import { UserEntity } from './user.entity';
import { PresenceStatus } from '@railgun/shared';

export interface CreateUserData {
  username: string;
  email: string;
  password: string;
  displayName?: string;
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
      email: data.email,
      passwordHash,
      displayName: data.displayName || data.username,
      presence: PresenceStatus.OFFLINE,
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
}
