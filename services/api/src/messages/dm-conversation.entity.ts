import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/**
 * Direct Message Conversation Entity.
 * 
 * Represents a DM thread between two users.
 * The conversationId is deterministically generated from sorted user IDs
 * to ensure uniqueness and prevent duplicates.
 */
@Entity('dm_conversations')
export class DmConversationEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /**
   * Deterministic conversation ID from sorted user IDs.
   * Format: userId1:userId2 where userId1 < userId2 alphabetically.
   */
  @Column({ type: 'varchar', length: 100, unique: true })
  @Index()
  conversationId!: string;

  /** First user in the conversation (alphabetically by ID) */
  @Column({ type: 'uuid' })
  @Index()
  user1Id!: string;

  /** Second user in the conversation (alphabetically by ID) */
  @Column({ type: 'uuid' })
  @Index()
  user2Id!: string;

  /** Timestamp of the last message in this conversation */
  @Column({ type: 'timestamp', nullable: true })
  lastMessageAt?: Date;

  /** Preview of the last message (encrypted envelope, for list display metadata only) */
  @Column({ type: 'text', nullable: true })
  lastMessagePreview?: string;

  @CreateDateColumn()
  createdAt!: string;

  @UpdateDateColumn()
  updatedAt!: Date;
}
