import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
// Stub mediasoup types - native module requires build tools
// Install mediasoup when deploying SFU: pnpm add mediasoup
import * as mediasoup from './mediasoup-stub';
import type * as mediasoupTypes from './mediasoup-stub';

import { VoiceRoomService } from './voice-room.service';
import {
  CreateTransportParams,
  ConnectTransportParams,
  ProduceParams,
  ConsumeParams,
  CloseSessionParams,
  TransportCreatedPayload,
  ConsumedPayload,
} from './types';

/**
 * mediasoup configuration
 * Matches spec in docs/VOICE_CHAT.md
 */
const MEDIASOUP_CONFIG = {
  worker: {
    rtcMinPort: 40000,
    rtcMaxPort: 49999,
    logLevel: 'warn' as mediasoupTypes.WorkerLogLevel,
    logTags: ['info', 'ice', 'dtls', 'rtp', 'srtp', 'rtcp'] as mediasoupTypes.WorkerLogTag[],
  },
  router: {
    mediaCodecs: [
      // Mono voice - matches channelCount: 1 capture constraint
      {
        kind: 'audio' as const,
        mimeType: 'audio/opus',
        clockRate: 48000,
        channels: 1,
        parameters: {
          useinbandfec: 1,
          usedtx: 1,
          maxaveragebitrate: 64000,
        },
      },
      // Video codecs
      {
        kind: 'video' as const,
        mimeType: 'video/VP8',
        clockRate: 90000,
        parameters: {
          'x-google-start-bitrate': 1000,
        },
      },
      {
        kind: 'video' as const,
        mimeType: 'video/VP9',
        clockRate: 90000,
        parameters: {
          'profile-id': 2,
          'x-google-start-bitrate': 1000,
        },
      },
      {
        kind: 'video' as const,
        mimeType: 'video/H264',
        clockRate: 90000,
        parameters: {
          'packetization-mode': 1,
          'profile-level-id': '4d0032',
          'level-asymmetry-allowed': 1,
          'x-google-start-bitrate': 1000,
        },
      },
    ] as mediasoupTypes.RtpCodecCapability[],
  },
  webRtcTransport: {
    listenIps: [
      {
        ip: '0.0.0.0',
        announcedIp: undefined as string | undefined, // Set from env
      },
    ],
    enableUdp: true,
    enableTcp: true,
    preferUdp: true,
    initialAvailableOutgoingBitrate: 1000000,
    minimumAvailableOutgoingBitrate: 600000,
    maxSctpMessageSize: 262144,
    maxIncomingBitrate: 1500000,
  },
};

/**
 * VoiceSfuService
 * 
 * Wraps mediasoup workers, routers, transports, producers, and consumers.
 * Handles worker lifecycle and cleanup.
 */
@Injectable()
export class VoiceSfuService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(VoiceSfuService.name);

  // mediasoup workers (one per CPU, max 4)
  private workers: mediasoupTypes.Worker[] = [];
  private nextWorkerIndex = 0;

  // Router per room (channel)
  private routers = new Map<string, mediasoupTypes.Router>();

  // Transport registry: socketId -> transportId -> transport
  private transports = new Map<string, Map<string, mediasoupTypes.WebRtcTransport>>();

  // Producer registry: socketId -> producerId -> producer
  private producers = new Map<string, Map<string, mediasoupTypes.Producer>>();

  // Consumer registry: socketId -> consumerId -> consumer
  private consumers = new Map<string, Map<string, mediasoupTypes.Consumer>>();

  constructor(
    private readonly configService: ConfigService,
    private readonly rooms: VoiceRoomService,
  ) {
    // Set announced IP from environment
    const announcedIp = this.configService.get<string>('MEDIASOUP_ANNOUNCED_IP');
    if (announcedIp) {
      MEDIASOUP_CONFIG.webRtcTransport.listenIps[0].announcedIp = announcedIp;
    }
  }

  async onModuleInit(): Promise<void> {
    // Skip mediasoup initialization if VOICE_ENABLED is not true
    const voiceEnabled = this.configService.get<string>('VOICE_ENABLED', 'false');
    if (voiceEnabled !== 'true') {
      this.logger.warn('Voice chat disabled (VOICE_ENABLED != true). Skipping mediasoup initialization.');
      return;
    }

    try {
      await this.createWorkers();
    } catch (error) {
      this.logger.warn(
        `Failed to initialize mediasoup: ${error?.message || 'Unknown error'}. ` +
        'Voice chat will not be available. Install mediasoup with: pnpm add mediasoup',
      );
      // Continue without voice functionality
    }
  }

  async onModuleDestroy(): Promise<void> {
    for (const worker of this.workers) {
      worker.close();
    }
    this.workers = [];
    this.routers.clear();
    this.transports.clear();
    this.producers.clear();
    this.consumers.clear();
  }

  // ===========================================================================
  // Workers
  // ===========================================================================

  /**
   * Create mediasoup workers (one per CPU, max 4).
   */
  private async createWorkers(): Promise<void> {
    const numWorkers = Math.min(require('os').cpus().length, 4);
    this.logger.log(`Creating ${numWorkers} mediasoup workers...`);

    for (let i = 0; i < numWorkers; i++) {
      const worker = await mediasoup.createWorker({
        logLevel: MEDIASOUP_CONFIG.worker.logLevel,
        logTags: MEDIASOUP_CONFIG.worker.logTags,
        rtcMinPort: MEDIASOUP_CONFIG.worker.rtcMinPort,
        rtcMaxPort: MEDIASOUP_CONFIG.worker.rtcMaxPort,
      });

      worker.on('died', (error: Error) => {
        this.logger.error(`Worker ${i} died: ${error?.message}`);
        // In production: alert, attempt restart, or graceful degradation
        // For now, remove from pool
        const index = this.workers.indexOf(worker);
        if (index !== -1) {
          this.workers.splice(index, 1);
        }
      });

      this.workers.push(worker);
      this.logger.log(`Worker ${i} created (PID: ${worker.pid})`);
    }
  }

  /**
   * Get next available worker (round-robin).
   */
  private getNextWorker(): mediasoupTypes.Worker {
    if (this.workers.length === 0) {
      throw new Error('No mediasoup workers available');
    }
    const worker = this.workers[this.nextWorkerIndex];
    this.nextWorkerIndex = (this.nextWorkerIndex + 1) % this.workers.length;
    return worker;
  }

  // ===========================================================================
  // Routers
  // ===========================================================================

  /**
   * Ensure a router exists for a channel.
   * Returns router RTP capabilities.
   */
  async ensureRouter(channelId: string): Promise<mediasoupTypes.RtpCapabilities> {
    let router = this.routers.get(channelId);

    if (!router) {
      const worker = this.getNextWorker();
      router = await worker.createRouter({
        mediaCodecs: MEDIASOUP_CONFIG.router.mediaCodecs,
      });

      router.on('workerclose', () => {
        this.logger.warn(`Router for ${channelId} closed due to worker close`);
        this.routers.delete(channelId);
      });

      this.routers.set(channelId, router);
      this.logger.log(`Router created for channel ${channelId}`);
    }

    return router.rtpCapabilities;
  }

  /**
   * Get router RTP capabilities (for client Device.load).
   */
  async getRouterRtpCapabilities(params: { channelId: string }): Promise<mediasoupTypes.RtpCapabilities> {
    const router = this.routers.get(params.channelId);
    if (!router) {
      throw new Error('Router not found for channel');
    }
    return router.rtpCapabilities;
  }

  /**
   * Close a router (when room is empty).
   */
  closeRouter(channelId: string): void {
    const router = this.routers.get(channelId);
    if (router) {
      router.close();
      this.routers.delete(channelId);
      this.logger.log(`Router closed for channel ${channelId}`);
    }
  }

  // ===========================================================================
  // Transports
  // ===========================================================================

  /**
   * Create a WebRTC transport for a participant.
   */
  async createWebRtcTransport(params: CreateTransportParams): Promise<TransportCreatedPayload> {
    const { channelId, socketId, direction } = params;

    const router = this.routers.get(channelId);
    if (!router) {
      throw new Error('Router not found');
    }

    const transport = await router.createWebRtcTransport({
      ...MEDIASOUP_CONFIG.webRtcTransport,
      appData: { socketId, direction },
    });

    // Track in registry
    if (!this.transports.has(socketId)) {
      this.transports.set(socketId, new Map());
    }
    this.transports.get(socketId)!.set(transport.id, transport);

    transport.on('routerclose', () => {
      this.transports.get(socketId)?.delete(transport.id);
    });

    this.logger.debug(`Transport created: ${transport.id} for socket ${socketId} (${direction})`);

    return {
      transportId: transport.id,
      iceParameters: transport.iceParameters,
      iceCandidates: transport.iceCandidates,
      dtlsParameters: transport.dtlsParameters,
    };
  }

  /**
   * Connect a transport (complete DTLS handshake).
   */
  async connectTransport(params: ConnectTransportParams): Promise<void> {
    const { socketId, transportId, dtlsParameters } = params;

    const transport = this.transports.get(socketId)?.get(transportId);
    if (!transport) {
      throw new Error('Transport not found');
    }

    await transport.connect({ dtlsParameters });
    this.logger.debug(`Transport connected: ${transportId}`);
  }

  // ===========================================================================
  // Producers
  // ===========================================================================

  /**
   * Create a producer on a transport.
   */
  async produce(params: ProduceParams): Promise<{ producerId: string }> {
    const { channelId, userId, socketId, transportId, kind, rtpParameters, appData } = params;

    const transport = this.transports.get(socketId)?.get(transportId);
    if (!transport) {
      throw new Error('Transport not found');
    }

    const producer = await transport.produce({
      kind,
      rtpParameters,
      appData: { ...appData, userId, socketId },
    });

    // Track in registry
    if (!this.producers.has(socketId)) {
      this.producers.set(socketId, new Map());
    }
    this.producers.get(socketId)!.set(producer.id, producer);

    // Track in room state
    this.rooms.addProducer(channelId, userId, {
      producerId: producer.id,
      kind,
      appData,
    });

    // Finalize video slot if applicable
    if (kind === 'video') {
      this.rooms.finalizeVideoSlot(channelId, userId, producer.id, appData.source);
    }

    producer.on('transportclose', () => {
      this.producers.get(socketId)?.delete(producer.id);
    });

    this.logger.debug(`Producer created: ${producer.id} (${kind}) for socket ${socketId}`);

    return { producerId: producer.id };
  }

  /**
   * Pause a producer.
   */
  async pauseProducer(params: { channelId: string; socketId: string; producerId: string }): Promise<void> {
    const producer = this.producers.get(params.socketId)?.get(params.producerId);
    if (!producer) {
      throw new Error('Producer not found');
    }
    await producer.pause();
  }

  /**
   * Resume a producer.
   */
  async resumeProducer(params: { channelId: string; socketId: string; producerId: string }): Promise<void> {
    const producer = this.producers.get(params.socketId)?.get(params.producerId);
    if (!producer) {
      throw new Error('Producer not found');
    }
    await producer.resume();
  }

  /**
   * Close a producer.
   */
  async closeProducer(params: { channelId: string; socketId: string; producerId: string }): Promise<void> {
    const producer = this.producers.get(params.socketId)?.get(params.producerId);
    if (!producer) return;

    producer.close();
    this.producers.get(params.socketId)?.delete(params.producerId);

    // Remove from room state
    const userId = producer.appData?.userId as string;
    if (userId) {
      this.rooms.removeProducer(params.channelId, userId, params.producerId);
    }

    this.logger.debug(`Producer closed: ${params.producerId}`);
  }

  // ===========================================================================
  // Consumers
  // ===========================================================================

  /**
   * Create a consumer (subscribe to a producer).
   */
  async consume(params: ConsumeParams): Promise<ConsumedPayload> {
    const { channelId, socketId, transportId, producerId, rtpCapabilities } = params;

    const router = this.routers.get(channelId);
    if (!router) {
      throw new Error('Router not found');
    }

    // Find the producer
    let producer: mediasoupTypes.Producer | undefined;
    for (const [, producerMap] of this.producers) {
      if (producerMap.has(producerId)) {
        producer = producerMap.get(producerId);
        break;
      }
    }

    if (!producer) {
      throw new Error('Producer not found');
    }

    // Check if can consume
    if (!router.canConsume({ producerId, rtpCapabilities })) {
      throw new Error('Cannot consume: incompatible RTP capabilities');
    }

    const transport = this.transports.get(socketId)?.get(transportId);
    if (!transport) {
      throw new Error('Transport not found');
    }

    const consumer = await transport.consume({
      producerId,
      rtpCapabilities,
      paused: true, // Start paused, client will resume
    });

    // Track in registry
    if (!this.consumers.has(socketId)) {
      this.consumers.set(socketId, new Map());
    }
    this.consumers.get(socketId)!.set(consumer.id, consumer);

    consumer.on('transportclose', () => {
      this.consumers.get(socketId)?.delete(consumer.id);
    });

    consumer.on('producerclose', () => {
      this.consumers.get(socketId)?.delete(consumer.id);
    });

    this.logger.debug(`Consumer created: ${consumer.id} for producer ${producerId}`);

    return {
      consumerId: consumer.id,
      producerId,
      kind: consumer.kind as 'audio' | 'video',
      rtpParameters: consumer.rtpParameters,
      appData: producer.appData as any,
    };
  }

  /**
   * Pause a consumer.
   */
  async pauseConsumer(params: { channelId: string; socketId: string; consumerId: string }): Promise<void> {
    const consumer = this.consumers.get(params.socketId)?.get(params.consumerId);
    if (!consumer) {
      throw new Error('Consumer not found');
    }
    await consumer.pause();
  }

  /**
   * Resume a consumer.
   */
  async resumeConsumer(params: { channelId: string; socketId: string; consumerId: string }): Promise<void> {
    const consumer = this.consumers.get(params.socketId)?.get(params.consumerId);
    if (!consumer) {
      throw new Error('Consumer not found');
    }
    await consumer.resume();
  }

  // ===========================================================================
  // Session Cleanup
  // ===========================================================================

  /**
   * Close all mediasoup objects for a session.
   * Called on disconnect or leave.
   */
  async closeAllForSession(params: CloseSessionParams): Promise<void> {
    const { channelId, socketId, transports, producers, consumers } = params;

    // Close consumers first
    for (const consumerId of consumers) {
      try {
        const consumer = this.consumers.get(socketId)?.get(consumerId);
        if (consumer) {
          consumer.close();
          this.consumers.get(socketId)?.delete(consumerId);
        }
      } catch (e) {
        this.logger.error(`Error closing consumer ${consumerId}: ${(e as Error).message}`);
      }
    }

    // Close producers
    for (const producerId of producers) {
      try {
        await this.closeProducer({ channelId, socketId, producerId });
      } catch (e) {
        this.logger.error(`Error closing producer ${producerId}: ${(e as Error).message}`);
      }
    }

    // Close transports
    for (const transportId of transports) {
      try {
        const transport = this.transports.get(socketId)?.get(transportId);
        if (transport) {
          transport.close();
          this.transports.get(socketId)?.delete(transportId);
        }
      } catch (e) {
        this.logger.error(`Error closing transport ${transportId}: ${(e as Error).message}`);
      }
    }

    // Clean up empty maps
    if (this.transports.get(socketId)?.size === 0) {
      this.transports.delete(socketId);
    }
    if (this.producers.get(socketId)?.size === 0) {
      this.producers.delete(socketId);
    }
    if (this.consumers.get(socketId)?.size === 0) {
      this.consumers.delete(socketId);
    }

    // Check if room is empty, close router if so
    const room = this.rooms.getRoom(channelId);
    if (room && room.participants.size === 0) {
      this.closeRouter(channelId);
    }

    this.logger.debug(`Session cleanup complete for socket ${socketId}`);
  }

  // ===========================================================================
  // Monitoring
  // ===========================================================================

  /**
   * Get worker stats (for health checks).
   */
  async getWorkerStats(): Promise<unknown[]> {
    const stats = await Promise.all(
      this.workers.map(async (worker, index) => {
        const usage = await worker.getResourceUsage();
        return {
          workerId: index,
          pid: worker.pid,
          usage,
        };
      }),
    );
    return stats;
  }

  /**
   * Get counts (for metrics).
   */
  getCounts(): { routers: number; transports: number; producers: number; consumers: number } {
    let transportCount = 0;
    let producerCount = 0;
    let consumerCount = 0;

    for (const map of this.transports.values()) {
      transportCount += map.size;
    }
    for (const map of this.producers.values()) {
      producerCount += map.size;
    }
    for (const map of this.consumers.values()) {
      consumerCount += map.size;
    }

    return {
      routers: this.routers.size,
      transports: transportCount,
      producers: producerCount,
      consumers: consumerCount,
    };
  }
}
