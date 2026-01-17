import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MessagesModule } from './messages.module';
import { CryptoModule } from '../crypto/crypto.module';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';

describe('Messages E2E - Multi-Device Support', () => {
  let app: INestApplication;
  let user1Token: string;
  let user2Token: string;
  let user1Id: string;
  let user2Id: string;
  let user1Device1Id: number;
  let user1Device2Id: number;
  let user2Device1Id: number;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: 'postgres',
          host: process.env.DB_HOST || 'localhost',
          port: parseInt(process.env.DB_PORT || '5432'),
          username: process.env.DB_USER || 'railgun',
          password: process.env.DB_PASSWORD || 'railgun',
          database: process.env.DB_NAME || 'railgun_test',
          autoLoadEntities: true,
          synchronize: true,
        }),
        AuthModule,
        UsersModule,
        CryptoModule,
        MessagesModule,
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Device Registration', () => {
    it('should register user1 device1 with server-assigned deviceId', async () => {
      // Register user1
      const registerRes = await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          username: 'user1',
          email: 'user1@test.com',
          password: 'password123',
        })
        .expect(201);

      user1Token = registerRes.body.access_token;
      user1Id = registerRes.body.user.id;

      // Register device with deviceId=0 (server assigns)
      const deviceRes = await request(app.getHttpServer())
        .post('/keys/register')
        .set('Authorization', `Bearer ${user1Token}`)
        .send({
          deviceId: 0,
          deviceType: 'desktop',
          identityKey: 'mock_identity_key_user1_dev1',
          registrationId: 12345,
          signedPreKey: {
            keyId: 1,
            publicKey: 'mock_signed_prekey',
            signature: 'mock_signature',
          },
          preKeys: [
            { keyId: 1, publicKey: 'mock_prekey_1' },
            { keyId: 2, publicKey: 'mock_prekey_2' },
          ],
        })
        .expect(201);

      user1Device1Id = deviceRes.body.deviceId;
      expect(user1Device1Id).toBeGreaterThan(0);
    });

    it('should register user1 device2 with different server-assigned deviceId', async () => {
      const deviceRes = await request(app.getHttpServer())
        .post('/keys/register')
        .set('Authorization', `Bearer ${user1Token}`)
        .send({
          deviceId: 0,
          deviceType: 'mobile',
          identityKey: 'mock_identity_key_user1_dev2',
          registrationId: 12346,
          signedPreKey: {
            keyId: 1,
            publicKey: 'mock_signed_prekey_2',
            signature: 'mock_signature_2',
          },
          preKeys: [
            { keyId: 1, publicKey: 'mock_prekey_3' },
            { keyId: 2, publicKey: 'mock_prekey_4' },
          ],
        })
        .expect(201);

      user1Device2Id = deviceRes.body.deviceId;
      expect(user1Device2Id).toBeGreaterThan(user1Device1Id);
      expect(user1Device2Id).toBe(user1Device1Id + 1);
    });

    it('should register user2 device1', async () => {
      const registerRes = await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          username: 'user2',
          email: 'user2@test.com',
          password: 'password123',
        })
        .expect(201);

      user2Token = registerRes.body.access_token;
      user2Id = registerRes.body.user.id;

      const deviceRes = await request(app.getHttpServer())
        .post('/keys/register')
        .set('Authorization', `Bearer ${user2Token}`)
        .send({
          deviceId: 0,
          deviceType: 'desktop',
          identityKey: 'mock_identity_key_user2_dev1',
          registrationId: 12347,
          signedPreKey: {
            keyId: 1,
            publicKey: 'mock_signed_prekey_3',
            signature: 'mock_signature_3',
          },
          preKeys: [
            { keyId: 1, publicKey: 'mock_prekey_5' },
            { keyId: 2, publicKey: 'mock_prekey_6' },
          ],
        })
        .expect(201);

      user2Device1Id = deviceRes.body.deviceId;
      expect(user2Device1Id).toBeGreaterThan(0);
    });

    it('should fetch all devices for user1', async () => {
      const res = await request(app.getHttpServer())
        .get(`/keys/devices/${user1Id}`)
        .set('Authorization', `Bearer ${user2Token}`)
        .expect(200);

      expect(res.body.devices).toHaveLength(2);
      expect(res.body.devices).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ deviceId: user1Device1Id }),
          expect.objectContaining({ deviceId: user1Device2Id }),
        ]),
      );
    });
  });

  describe('V2 Multi-Device Messaging', () => {
    let messageId: string;

    it('should send V2 message with per-device envelopes', async () => {
      const res = await request(app.getHttpServer())
        .post('/messages')
        .set('Authorization', `Bearer ${user2Token}`)
        .send({
          recipientId: user1Id,
          protocolVersion: 2,
          deviceEnvelopes: [
            {
              deviceId: user1Device1Id,
              encryptedEnvelope: 'mock_encrypted_envelope_for_device1',
            },
            {
              deviceId: user1Device2Id,
              encryptedEnvelope: 'mock_encrypted_envelope_for_device2',
            },
          ],
          clientNonce: 'test-nonce-123',
        })
        .expect(201);

      messageId = res.body.message.id;
      expect(res.body.message.senderId).toBe(user2Id);
      expect(res.body.message.recipientId).toBe(user1Id);
    });

    it('should retrieve envelope for user1 device1', async () => {
      const res = await request(app.getHttpServer())
        .get(`/messages/${messageId}/envelope`)
        .set('Authorization', `Bearer ${user1Token}`)
        .query({ deviceId: user1Device1Id })
        .expect(200);

      expect(res.body.encryptedEnvelope).toBe(
        'mock_encrypted_envelope_for_device1',
      );
      expect(res.body.recipientDeviceId).toBe(user1Device1Id);
    });

    it('should retrieve envelope for user1 device2', async () => {
      const res = await request(app.getHttpServer())
        .get(`/messages/${messageId}/envelope`)
        .set('Authorization', `Bearer ${user1Token}`)
        .query({ deviceId: user1Device2Id })
        .expect(200);

      expect(res.body.encryptedEnvelope).toBe(
        'mock_encrypted_envelope_for_device2',
      );
      expect(res.body.recipientDeviceId).toBe(user1Device2Id);
    });

    it('should mark envelope delivered for device1', async () => {
      await request(app.getHttpServer())
        .post(`/messages/${messageId}/delivered`)
        .set('Authorization', `Bearer ${user1Token}`)
        .send({ deviceId: user1Device1Id })
        .expect(200);

      // Verify delivered status
      const res = await request(app.getHttpServer())
        .get(`/messages/${messageId}/envelope`)
        .set('Authorization', `Bearer ${user1Token}`)
        .query({ deviceId: user1Device1Id })
        .expect(200);

      expect(res.body.delivered).toBe(true);
    });

    it('should not allow other users to access envelopes', async () => {
      await request(app.getHttpServer())
        .get(`/messages/${messageId}/envelope`)
        .set('Authorization', `Bearer ${user2Token}`)
        .query({ deviceId: user1Device1Id })
        .expect(403);
    });
  });

  describe('Backward Compatibility - V1 Messages', () => {
    it('should accept V1 message format', async () => {
      const res = await request(app.getHttpServer())
        .post('/messages')
        .set('Authorization', `Bearer ${user2Token}`)
        .send({
          recipientId: user1Id,
          encryptedEnvelope: 'legacy_single_envelope',
          clientNonce: 'test-nonce-v1',
        })
        .expect(201);

      expect(res.body.message.id).toBeDefined();
    });
  });

  describe('Channel Sender-Key Per-Device', () => {
    let communityId: string;
    let channelId: string;

    it('should create community and channel', async () => {
      const communityRes = await request(app.getHttpServer())
        .post('/communities')
        .set('Authorization', `Bearer ${user1Token}`)
        .send({
          name: 'Test Community',
          description: 'For testing multi-device sender keys',
        })
        .expect(201);

      communityId = communityRes.body.id;

      const channelRes = await request(app.getHttpServer())
        .post(`/communities/${communityId}/channels`)
        .set('Authorization', `Bearer ${user1Token}`)
        .send({
          name: 'test-channel',
          description: 'Test channel',
        })
        .expect(201);

      channelId = channelRes.body.id;

      // Add user2 to community
      await request(app.getHttpServer())
        .post(`/communities/${communityId}/members`)
        .set('Authorization', `Bearer ${user1Token}`)
        .send({ userId: user2Id })
        .expect(201);
    });

    it('should send sender-key to specific device', async () => {
      await request(app.getHttpServer())
        .post(`/channels/${channelId}/sender-key`)
        .set('Authorization', `Bearer ${user1Token}`)
        .send({
          recipientUserId: user2Id,
          recipientDeviceId: user2Device1Id,
          distribution: 'mock_sender_key_distribution',
        })
        .query({ deviceId: user1Device1Id })
        .expect(201);
    });

    it('should retrieve sender-keys for specific device', async () => {
      const res = await request(app.getHttpServer())
        .get(`/channels/${channelId}/sender-key`)
        .set('Authorization', `Bearer ${user2Token}`)
        .query({ deviceId: user2Device1Id })
        .expect(200);

      expect(res.body.distributions).toHaveLength(1);
      expect(res.body.distributions[0].distribution).toBe(
        'mock_sender_key_distribution',
      );
      expect(res.body.distributions[0].senderDeviceId).toBe(user1Device1Id);
    });
  });
});
