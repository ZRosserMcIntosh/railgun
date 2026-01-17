import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { MessageEntity } from './message.entity';

/**
 * MessageEnvelope Entity
 * 
 * Stores per-device encrypted envelopes for Protocol V2 multi-device support.
 * Each DM message can have multiple envelopes, one for each recipient device.
 * 
 * For channel messages, the single encrypted envelope remains in MessageEntity
 * since sender keys allow any member to decrypt.
 */
@Entity('message_envelopes')
@Index(['recipientUserId', 'recipientDeviceId', 'delivered'])
@Index(['messageId'])
export class MessageEnvelopeEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** The parent message this envelope belongs to */
  @Column({ type: 'uuid' })
  messageId!: string;

  @ManyToOne(() => MessageEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'messageId' })
  message!: MessageEntity;

  /** Recipient user ID */
  @Column({ type: 'uuid' })
  recipientUserId!: string;

  /** Recipient device ID */
  @Column({ type: 'int' })
  recipientDeviceId!: number;

  /** Full encrypted envelope JSON for this device */
  @Column({ type: 'text' })
  encryptedEnvelope!: string;

  /** Whether this envelope has been delivered to the device */
  @Column({ type: 'boolean', default: false })
  delivered!: boolean;

  /** When the envelope was delivered */
  @Column({ type: 'timestamp', nullable: true })
  deliveredAt?: Date;

  @CreateDateColumn()
  createdAt!: Date;
}
