/**
 * Stub mediasoup types for builds without native mediasoup
 * 
 * Voice features are disabled when mediasoup is not installed.
 * This allows the rest of the API to function normally.
 */

export namespace types {
  export interface RtpCapabilities {
    codecs?: any[];
    headerExtensions?: any[];
  }

  export interface DtlsParameters {
    fingerprints: any[];
    role?: string;
  }

  export interface IceCandidate {
    foundation: string;
    priority: number;
    ip: string;
    protocol: string;
    port: number;
    type: string;
  }

  export interface IceParameters {
    usernameFragment: string;
    password: string;
    iceLite?: boolean;
  }

  export interface RtpParameters {
    mid?: string;
    codecs: any[];
    headerExtensions?: any[];
    encodings?: any[];
    rtcp?: any;
  }

  export interface SctpStreamParameters {
    streamId: number;
    ordered?: boolean;
    maxPacketLifeTime?: number;
    maxRetransmits?: number;
  }

  export type MediaKind = 'audio' | 'video';

  export interface Worker {
    close(): void;
    on(event: string, handler: (...args: any[]) => void): void;
    createRouter(options: any): Promise<Router>;
  }

  export interface Router {
    id: string;
    rtpCapabilities: RtpCapabilities;
    close(): void;
    createWebRtcTransport(options: any): Promise<WebRtcTransport>;
    canConsume(options: { producerId: string; rtpCapabilities: RtpCapabilities }): boolean;
  }

  export interface WebRtcTransport {
    id: string;
    iceParameters: IceParameters;
    iceCandidates: IceCandidate[];
    dtlsParameters: DtlsParameters;
    sctpParameters?: any;
    close(): void;
    connect(options: { dtlsParameters: DtlsParameters }): Promise<void>;
    produce(options: any): Promise<Producer>;
    consume(options: any): Promise<Consumer>;
  }

  export interface Producer {
    id: string;
    kind: MediaKind;
    close(): void;
    pause(): Promise<void>;
    resume(): Promise<void>;
  }

  export interface Consumer {
    id: string;
    producerId: string;
    kind: MediaKind;
    rtpParameters: RtpParameters;
    close(): void;
    pause(): Promise<void>;
    resume(): Promise<void>;
  }

  export type WorkerLogLevel = 'debug' | 'warn' | 'error' | 'none';
  export type WorkerLogTag = 'info' | 'ice' | 'dtls' | 'rtp' | 'srtp' | 'rtcp' | 'rtx' | 'bwe' | 'score' | 'simulcast' | 'svc' | 'sctp' | 'message';
}

// Default export for `import * as mediasoup from 'mediasoup'` pattern
export async function createWorker(_options?: any): Promise<types.Worker> {
  throw new Error(
    'mediasoup native module not installed. Voice features are disabled. ' +
    'Install with: pnpm add mediasoup (requires Python and build tools)'
  );
}
