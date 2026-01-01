/**
 * Mediasoup Type Stubs
 * 
 * These stubs allow TypeScript compilation without the mediasoup native module.
 * mediasoup requires native compilation and will be installed when SFU is deployed.
 * 
 * For production, install mediasoup:
 *   pnpm add mediasoup
 * 
 * This requires:
 *   - Python 3
 *   - make, g++ (or Visual Studio Build Tools on Windows)
 *   - See: https://mediasoup.org/documentation/v3/mediasoup/installation/
 */

// Worker types - use string for compatibility
export type WorkerLogLevel = string;
export type WorkerLogTag = string;

export interface WorkerResourceUsage {
  ru_utime: number;
  ru_stime: number;
  ru_maxrss: number;
  ru_ixrss: number;
  ru_idrss: number;
  ru_isrss: number;
  ru_minflt: number;
  ru_majflt: number;
  ru_nswap: number;
  ru_inblock: number;
  ru_oublock: number;
  ru_msgsnd: number;
  ru_msgrcv: number;
  ru_nsignals: number;
  ru_nvcsw: number;
  ru_nivcsw: number;
}

export interface Worker {
  pid: number;
  closed: boolean;
  appData: Record<string, unknown>;
  close(): void;
  getResourceUsage(): Promise<WorkerResourceUsage>;
  createRouter(options: RouterOptions): Promise<Router>;
  on(event: string, handler: (...args: any[]) => void): this;
}

export interface WorkerSettings {
  rtcMinPort?: number;
  rtcMaxPort?: number;
  logLevel?: string;
  logTags?: string[];
}

// Router types
export interface RouterOptions {
  mediaCodecs?: RtpCodecCapability[];
  appData?: Record<string, unknown>;
}

export interface Router {
  id: string;
  closed: boolean;
  rtpCapabilities: RtpCapabilities;
  appData: Record<string, unknown>;
  close(): void;
  canConsume(options: { producerId: string; rtpCapabilities: RtpCapabilities }): boolean;
  createWebRtcTransport(options: WebRtcTransportOptions): Promise<WebRtcTransport>;
  createProducer(options: ProducerOptions): Promise<Producer>;
  on(event: string, handler: (...args: any[]) => void): this;
}

// Transport types
export interface WebRtcTransportOptions {
  listenIps: TransportListenIp[];
  enableUdp?: boolean;
  enableTcp?: boolean;
  preferUdp?: boolean;
  initialAvailableOutgoingBitrate?: number;
  appData?: Record<string, unknown>;
}

export interface TransportListenIp {
  ip: string;
  announcedIp?: string;
}

export interface WebRtcTransport {
  id: string;
  closed: boolean;
  appData: Record<string, unknown>;
  iceParameters: IceParameters;
  iceCandidates: IceCandidate[];
  dtlsParameters: DtlsParameters;
  close(): void;
  connect(options: { dtlsParameters: DtlsParameters }): Promise<void>;
  produce(options: ProducerOptions): Promise<Producer>;
  consume(options: ConsumerOptions): Promise<Consumer>;
  on(event: string, handler: (...args: any[]) => void): this;
}

export interface IceParameters {
  usernameFragment: string;
  password: string;
  iceLite?: boolean;
}

export interface IceCandidate {
  foundation: string;
  priority: number;
  ip: string;
  protocol: 'udp' | 'tcp';
  port: number;
  type: 'host' | 'srflx' | 'prflx' | 'relay';
  tcpType?: 'active' | 'passive' | 'so';
}

export interface DtlsParameters {
  fingerprints: DtlsFingerprint[];
  role?: 'auto' | 'client' | 'server';
}

export interface DtlsFingerprint {
  algorithm: string;
  value: string;
}

// RTP types
export interface RtpCapabilities {
  codecs?: RtpCodecCapability[];
  headerExtensions?: RtpHeaderExtension[];
}

export interface RtpCodecCapability {
  kind: 'audio' | 'video';
  mimeType: string;
  preferredPayloadType?: number;
  clockRate: number;
  channels?: number;
  parameters?: Record<string, unknown>;
  rtcpFeedback?: RtcpFeedback[];
}

export interface RtpHeaderExtension {
  kind: 'audio' | 'video';
  uri: string;
  preferredId: number;
  preferredEncrypt?: boolean;
  direction?: 'sendrecv' | 'sendonly' | 'recvonly' | 'inactive';
}

export interface RtcpFeedback {
  type: string;
  parameter?: string;
}

export interface RtpParameters {
  mid?: string;
  codecs: RtpCodecParameters[];
  headerExtensions?: RtpHeaderExtensionParameters[];
  encodings?: RtpEncodingParameters[];
  rtcp?: RtcpParameters;
}

export interface RtpCodecParameters {
  mimeType: string;
  payloadType: number;
  clockRate: number;
  channels?: number;
  parameters?: Record<string, unknown>;
  rtcpFeedback?: RtcpFeedback[];
}

export interface RtpHeaderExtensionParameters {
  uri: string;
  id: number;
  encrypt?: boolean;
  parameters?: Record<string, unknown>;
}

export interface RtpEncodingParameters {
  ssrc?: number;
  rid?: string;
  codecPayloadType?: number;
  rtx?: { ssrc: number };
  dtx?: boolean;
  scalabilityMode?: string;
  scaleResolutionDownBy?: number;
  maxBitrate?: number;
}

export interface RtcpParameters {
  cname?: string;
  reducedSize?: boolean;
}

// Producer types
export interface ProducerOptions {
  kind: 'audio' | 'video';
  rtpParameters: RtpParameters;
  paused?: boolean;
  keyFrameRequestDelay?: number;
  appData?: Record<string, unknown>;
}

export interface Producer {
  id: string;
  closed: boolean;
  kind: 'audio' | 'video';
  rtpParameters: RtpParameters;
  type: string;
  paused: boolean;
  score: ProducerScore[];
  appData: Record<string, unknown>;
  close(): void;
  pause(): Promise<void>;
  resume(): Promise<void>;
  on(event: string, handler: (...args: any[]) => void): this;
}

export interface ProducerScore {
  ssrc: number;
  rid?: string;
  score: number;
}

// Consumer types
export interface ConsumerOptions {
  producerId: string;
  rtpCapabilities: RtpCapabilities;
  paused?: boolean;
  preferredLayers?: ConsumerLayers;
  pipe?: boolean;
  appData?: Record<string, unknown>;
}

export interface Consumer {
  id: string;
  producerId: string;
  closed: boolean;
  kind: 'audio' | 'video';
  rtpParameters: RtpParameters;
  type: string;
  paused: boolean;
  producerPaused: boolean;
  score: ConsumerScore;
  preferredLayers: ConsumerLayers | null;
  currentLayers: ConsumerLayers | null;
  appData: Record<string, unknown>;
  close(): void;
  pause(): Promise<void>;
  resume(): Promise<void>;
  setPreferredLayers(layers: ConsumerLayers): Promise<void>;
  on(event: string, handler: (...args: any[]) => void): this;
}

export interface ConsumerScore {
  score: number;
  producerScore: number;
  producerScores: number[];
}

export interface ConsumerLayers {
  spatialLayer: number;
  temporalLayer?: number;
}

// Factory function stub
export async function createWorker(_settings?: WorkerSettings): Promise<Worker> {
  throw new Error(
    'mediasoup native module not installed. ' +
    'Install with: pnpm add mediasoup (requires build tools)'
  );
}

// Re-export all types under 'types' namespace for compatibility
export const types = {
  Worker: {} as Worker,
  Router: {} as Router,
  WebRtcTransport: {} as WebRtcTransport,
  Producer: {} as Producer,
  Consumer: {} as Consumer,
};

export default {
  createWorker,
  types,
};
