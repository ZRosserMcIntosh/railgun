import { describe, it, expect } from 'vitest';
import {
  ConversationType,
  PresenceStatus,
  WSEventType,
  MessageStatus,
  Permission,
  DeviceType,
  KeyType,
  PROTOCOL_VERSION,
} from '../enums.js';

describe('Enums', () => {
  describe('ConversationType', () => {
    it('should have DM and CHANNEL types', () => {
      expect(ConversationType.DM).toBe('DM');
      expect(ConversationType.CHANNEL).toBe('CHANNEL');
    });
  });

  describe('PresenceStatus', () => {
    it('should have all presence states', () => {
      expect(PresenceStatus.ONLINE).toBe('ONLINE');
      expect(PresenceStatus.AWAY).toBe('AWAY');
      expect(PresenceStatus.DO_NOT_DISTURB).toBe('DND');
      expect(PresenceStatus.INVISIBLE).toBe('INVISIBLE');
      expect(PresenceStatus.OFFLINE).toBe('OFFLINE');
    });
  });

  describe('WSEventType', () => {
    it('should have message events', () => {
      expect(WSEventType.MESSAGE_SEND).toBe('message:send');
      expect(WSEventType.MESSAGE_RECEIVED).toBe('message:received');
    });

    it('should have auth events', () => {
      expect(WSEventType.AUTHENTICATE).toBe('authenticate');
      expect(WSEventType.AUTHENTICATED).toBe('authenticated');
    });
  });

  describe('MessageStatus', () => {
    it('should have all delivery states', () => {
      expect(MessageStatus.SENDING).toBe('SENDING');
      expect(MessageStatus.SENT).toBe('SENT');
      expect(MessageStatus.DELIVERED).toBe('DELIVERED');
      expect(MessageStatus.READ).toBe('READ');
      expect(MessageStatus.FAILED).toBe('FAILED');
    });
  });

  describe('Permission', () => {
    it('should have community management permissions', () => {
      expect(Permission.MANAGE_COMMUNITY).toBe('MANAGE_COMMUNITY');
      expect(Permission.MANAGE_CHANNELS).toBe('MANAGE_CHANNELS');
      expect(Permission.MANAGE_ROLES).toBe('MANAGE_ROLES');
    });

    it('should have message permissions', () => {
      expect(Permission.READ_MESSAGES).toBe('READ_MESSAGES');
      expect(Permission.SEND_MESSAGES).toBe('SEND_MESSAGES');
    });
  });

  describe('DeviceType', () => {
    it('should have all device types', () => {
      expect(DeviceType.DESKTOP).toBe('DESKTOP');
      expect(DeviceType.MOBILE).toBe('MOBILE');
      expect(DeviceType.WEB).toBe('WEB');
    });
  });

  describe('KeyType', () => {
    it('should have all key types', () => {
      expect(KeyType.IDENTITY).toBe('IDENTITY');
      expect(KeyType.SIGNED_PREKEY).toBe('SIGNED_PREKEY');
      expect(KeyType.ONE_TIME_PREKEY).toBe('ONE_TIME_PREKEY');
    });
  });

  describe('PROTOCOL_VERSION', () => {
    it('should be version 1', () => {
      expect(PROTOCOL_VERSION).toBe(1);
    });
  });
});
