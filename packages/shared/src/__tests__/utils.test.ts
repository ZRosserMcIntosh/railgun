import { describe, it, expect } from 'vitest';
import {
  generateInviteCode,
  isValidUsername,
  isValidChannelName,
  normalizeChannelName,
  truncate,
  formatFingerprint,
  arraysEqual,
  generateUUID,
} from '../utils.js';

describe('Utils', () => {
  describe('generateInviteCode', () => {
    it('should generate an 8-character code', () => {
      const code = generateInviteCode();
      expect(code).toHaveLength(8);
    });

    it('should only contain alphanumeric characters', () => {
      const code = generateInviteCode();
      expect(code).toMatch(/^[A-Za-z0-9]+$/);
    });

    it('should generate unique codes', () => {
      const codes = new Set<string>();
      for (let i = 0; i < 100; i++) {
        codes.add(generateInviteCode());
      }
      expect(codes.size).toBe(100);
    });
  });

  describe('isValidUsername', () => {
    it('should accept valid usernames', () => {
      expect(isValidUsername('john')).toBe(true);
      expect(isValidUsername('john_doe')).toBe(true);
      expect(isValidUsername('JohnDoe123')).toBe(true);
      expect(isValidUsername('abc')).toBe(true);
    });

    it('should reject invalid usernames', () => {
      expect(isValidUsername('ab')).toBe(false); // too short
      expect(isValidUsername('john doe')).toBe(false); // spaces
      expect(isValidUsername('john-doe')).toBe(false); // hyphens
      expect(isValidUsername('john@doe')).toBe(false); // special chars
      expect(isValidUsername('')).toBe(false); // empty
    });
  });

  describe('isValidChannelName', () => {
    it('should accept valid channel names', () => {
      expect(isValidChannelName('general')).toBe(true);
      expect(isValidChannelName('off-topic')).toBe(true);
      expect(isValidChannelName('channel-123')).toBe(true);
    });

    it('should reject invalid channel names', () => {
      expect(isValidChannelName('General')).toBe(false); // uppercase
      expect(isValidChannelName('off topic')).toBe(false); // spaces
      expect(isValidChannelName('')).toBe(false); // empty
    });
  });

  describe('normalizeChannelName', () => {
    it('should lowercase the name', () => {
      expect(normalizeChannelName('GENERAL')).toBe('general');
    });

    it('should replace spaces with hyphens', () => {
      expect(normalizeChannelName('off topic')).toBe('off-topic');
    });

    it('should remove special characters', () => {
      expect(normalizeChannelName('test@channel!')).toBe('testchannel');
    });

    it('should trim whitespace', () => {
      expect(normalizeChannelName('  general  ')).toBe('general');
    });
  });

  describe('truncate', () => {
    it('should not truncate short strings', () => {
      expect(truncate('hello', 10)).toBe('hello');
    });

    it('should truncate long strings with ellipsis', () => {
      expect(truncate('hello world', 8)).toBe('hello...');
    });

    it('should handle exact length', () => {
      expect(truncate('hello', 5)).toBe('hello');
    });
  });

  describe('formatFingerprint', () => {
    it('should format fingerprint into groups of 5', () => {
      const fingerprint = '1234567890abcdef1234567890';
      const formatted = formatFingerprint(fingerprint);
      expect(formatted).toBe('12345 67890 abcde f1234 56789 0');
    });
  });

  describe('arraysEqual', () => {
    it('should return true for equal arrays', () => {
      expect(arraysEqual([1, 2, 3], [1, 2, 3])).toBe(true);
      expect(arraysEqual([], [])).toBe(true);
    });

    it('should return false for different arrays', () => {
      expect(arraysEqual([1, 2, 3], [1, 2, 4])).toBe(false);
      expect(arraysEqual([1, 2], [1, 2, 3])).toBe(false);
    });
  });

  describe('generateUUID', () => {
    it('should generate a valid UUID format', () => {
      const uuid = generateUUID();
      expect(uuid).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      );
    });

    it('should generate unique UUIDs', () => {
      const uuids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        uuids.add(generateUUID());
      }
      expect(uuids.size).toBe(100);
    });
  });
});
