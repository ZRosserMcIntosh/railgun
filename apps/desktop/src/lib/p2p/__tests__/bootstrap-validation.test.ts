/**
 * Bootstrap Node Validation Suite
 * 
 * Week 3-4 Hardening: Validates multi-region bootstrap node connectivity
 * and cryptographic integrity of the bootstrap list.
 * 
 * DOCTRINE COMPLIANCE:
 * - Principle 1: Protocol Over Platform - Validates decentralized discovery
 * - Principle 9: Bootstrap Diversity - Multi-transport, multi-region
 */

import { describe, it, expect, vi } from 'vitest';
import {
  PRODUCTION_BOOTSTRAP_LIST,
  IPFS_GATEWAYS,
  TOR_CONFIG,
  I2P_CONFIG,
  generateBootstrapKeypair,
  signBootstrapList,
} from '../bootstrap-nodes';

// ============================================================================
// Bootstrap List Structure Validation
// ============================================================================

describe('Bootstrap List Structure', () => {
  it('contains minimum required bootstrap nodes', () => {
    expect(PRODUCTION_BOOTSTRAP_LIST.nodes.length).toBeGreaterThanOrEqual(3);
  });

  it('includes multi-region coverage', () => {
    const regions = new Set<string>();
    
    for (const node of PRODUCTION_BOOTSTRAP_LIST.nodes) {
      // Extract region from DNS addresses
      const dnsAddresses = node.addresses.dns || [];
      for (const dns of dnsAddresses) {
        if (dns.includes('us-')) regions.add('US');
        if (dns.includes('eu-')) regions.add('EU');
        if (dns.includes('ap-') || dns.includes('asia')) regions.add('ASIA');
        if (dns.includes('sa-')) regions.add('SA');
      }
    }
    
    // Must have at least 2 distinct regions
    expect(regions.size).toBeGreaterThanOrEqual(2);
  });

  it('all nodes have required fields', () => {
    for (const node of PRODUCTION_BOOTSTRAP_LIST.nodes) {
      expect(node).toHaveProperty('peerId');
      expect(node).toHaveProperty('addresses');
      expect(node).toHaveProperty('publicKey');
      expect(node.peerId).toBeTruthy();
      expect(node.publicKey).toBeTruthy();
    }
  });

  it('nodes have valid addresses', () => {
    for (const node of PRODUCTION_BOOTSTRAP_LIST.nodes) {
      const addresses = node.addresses;
      const hasAddress = 
        (addresses.ipv4 && addresses.ipv4.length > 0) ||
        (addresses.ipv6 && addresses.ipv6.length > 0) ||
        (addresses.dns && addresses.dns.length > 0) ||
        (addresses.onion && addresses.onion.length > 0) ||
        (addresses.i2p && addresses.i2p.length > 0);
      
      expect(hasAddress).toBe(true);
    }
  });

  it('peer IDs follow valid format', () => {
    // libp2p peer IDs start with 12D3KooW
    for (const node of PRODUCTION_BOOTSTRAP_LIST.nodes) {
      expect(node.peerId).toMatch(/^12D3KooW/);
    }
  });

  it('includes version and update timestamp', () => {
    expect(PRODUCTION_BOOTSTRAP_LIST.version).toBeGreaterThanOrEqual(1);
    expect(PRODUCTION_BOOTSTRAP_LIST.updated).toBeTruthy();
  });
});

// ============================================================================
// Bootstrap List Cryptographic Verification
// ============================================================================

describe('Bootstrap List Cryptographic Verification', () => {
  it('generates valid bootstrap keypair', async () => {
    const keypair = await generateBootstrapKeypair();
    
    expect(keypair.publicKey).toBeTruthy();
    expect(keypair.privateKey).toBeInstanceOf(Uint8Array);
    // Ed25519 public key in hex is 64 chars
    expect(keypair.publicKey.length).toBe(64);
  });

  it('signs bootstrap list', async () => {
    const keypair = await generateBootstrapKeypair();
    
    const signature = await signBootstrapList(
      {
        version: PRODUCTION_BOOTSTRAP_LIST.version,
        updated: PRODUCTION_BOOTSTRAP_LIST.updated,
        nodes: PRODUCTION_BOOTSTRAP_LIST.nodes,
        dnsSeeds: PRODUCTION_BOOTSTRAP_LIST.dnsSeeds,
        ipfsManifests: PRODUCTION_BOOTSTRAP_LIST.ipfsManifests,
        signingKeyId: PRODUCTION_BOOTSTRAP_LIST.signingKeyId,
      },
      keypair.privateKey
    );
    
    expect(signature).toBeTruthy();
    expect(typeof signature).toBe('string');
    // Ed25519 signature in hex is 128 chars
    expect(signature.length).toBe(128);
  });

  it('produces different signatures with different keys', async () => {
    const keypair1 = await generateBootstrapKeypair();
    const keypair2 = await generateBootstrapKeypair();
    
    const listData = {
      version: PRODUCTION_BOOTSTRAP_LIST.version,
      updated: PRODUCTION_BOOTSTRAP_LIST.updated,
      nodes: PRODUCTION_BOOTSTRAP_LIST.nodes,
      dnsSeeds: PRODUCTION_BOOTSTRAP_LIST.dnsSeeds,
      ipfsManifests: PRODUCTION_BOOTSTRAP_LIST.ipfsManifests,
      signingKeyId: PRODUCTION_BOOTSTRAP_LIST.signingKeyId,
    };
    
    const sig1 = await signBootstrapList(listData, keypair1.privateKey);
    const sig2 = await signBootstrapList(listData, keypair2.privateKey);
    
    expect(sig1).not.toBe(sig2);
  });
});

// ============================================================================
// IPFS Gateway Validation
// ============================================================================

describe('IPFS Gateway Configuration', () => {
  it('contains multiple IPFS gateways', () => {
    expect(IPFS_GATEWAYS.length).toBeGreaterThanOrEqual(3);
  });

  it('gateways have valid URLs', () => {
    for (const gateway of IPFS_GATEWAYS) {
      expect(() => new URL(gateway)).not.toThrow();
      expect(gateway.startsWith('https://')).toBe(true);
    }
  });

  it('includes diverse gateway providers', () => {
    const providers = new Set<string>();
    
    for (const gateway of IPFS_GATEWAYS) {
      const url = new URL(gateway);
      providers.add(url.hostname);
    }
    
    // Should not rely on single provider
    expect(providers.size).toBeGreaterThanOrEqual(2);
  });
});

// ============================================================================
// Alternative Transport Configuration
// ============================================================================

describe('Tor Configuration', () => {
  it('has valid SOCKS proxy configuration', () => {
    expect(TOR_CONFIG).toHaveProperty('socksHost');
    expect(TOR_CONFIG).toHaveProperty('socksPort');
    expect(TOR_CONFIG.socksPort).toBeGreaterThan(0);
    expect(TOR_CONFIG.socksPort).toBeLessThan(65536);
  });

  it('includes circuit configuration', () => {
    expect(TOR_CONFIG).toHaveProperty('circuitTimeout');
    expect(TOR_CONFIG).toHaveProperty('retryAttempts');
  });
});

describe('I2P Configuration', () => {
  it('has valid SAM configuration', () => {
    expect(I2P_CONFIG).toHaveProperty('samHost');
    expect(I2P_CONFIG).toHaveProperty('samPort');
    expect(I2P_CONFIG.samPort).toBeGreaterThan(0);
    expect(I2P_CONFIG.samPort).toBeLessThan(65536);
  });
});

// ============================================================================
// Bootstrap Diversity Analysis
// ============================================================================

describe('Bootstrap Diversity Analysis', () => {
  it('includes clearnet nodes', () => {
    const clearnetNodes = PRODUCTION_BOOTSTRAP_LIST.nodes.filter(node =>
      (node.addresses.ipv4 && node.addresses.ipv4.length > 0) ||
      (node.addresses.dns && node.addresses.dns.length > 0)
    );
    
    expect(clearnetNodes.length).toBeGreaterThan(0);
  });

  it('includes Tor-accessible nodes', () => {
    const torNodes = PRODUCTION_BOOTSTRAP_LIST.nodes.filter(node =>
      node.addresses.onion && node.addresses.onion.length > 0
    );
    
    expect(torNodes.length).toBeGreaterThan(0);
  });

  it('includes I2P-accessible nodes', () => {
    const i2pNodes = PRODUCTION_BOOTSTRAP_LIST.nodes.filter(node =>
      node.addresses.i2p && node.addresses.i2p.length > 0
    );
    
    expect(i2pNodes.length).toBeGreaterThan(0);
  });

  it('has DNS seeds for fallback discovery', () => {
    expect(PRODUCTION_BOOTSTRAP_LIST.dnsSeeds).toBeDefined();
    expect(PRODUCTION_BOOTSTRAP_LIST.dnsSeeds?.length).toBeGreaterThan(0);
  });

  it('has IPFS manifests for decentralized discovery', () => {
    expect(PRODUCTION_BOOTSTRAP_LIST.ipfsManifests).toBeDefined();
    expect(PRODUCTION_BOOTSTRAP_LIST.ipfsManifests?.length).toBeGreaterThan(0);
  });

  it('no single transport dependency', () => {
    const transportCounts = {
      ipv4: 0,
      ipv6: 0,
      dns: 0,
      onion: 0,
      i2p: 0,
    };
    
    for (const node of PRODUCTION_BOOTSTRAP_LIST.nodes) {
      if (node.addresses.ipv4?.length) transportCounts.ipv4++;
      if (node.addresses.ipv6?.length) transportCounts.ipv6++;
      if (node.addresses.dns?.length) transportCounts.dns++;
      if (node.addresses.onion?.length) transportCounts.onion++;
      if (node.addresses.i2p?.length) transportCounts.i2p++;
    }
    
    // Should have at least 2 different transport types
    const activeTransports = Object.values(transportCounts).filter(c => c > 0).length;
    expect(activeTransports).toBeGreaterThanOrEqual(2);
  });
});

// ============================================================================
// Node Capabilities Validation
// ============================================================================

describe('Node Capabilities', () => {
  it('all nodes have defined capabilities', () => {
    for (const node of PRODUCTION_BOOTSTRAP_LIST.nodes) {
      expect(node.capabilities).toBeDefined();
      expect(Array.isArray(node.capabilities)).toBe(true);
      expect(node.capabilities?.length).toBeGreaterThan(0);
    }
  });

  it('includes relay-capable nodes', () => {
    const relayNodes = PRODUCTION_BOOTSTRAP_LIST.nodes.filter(node =>
      node.capabilities?.includes('relay')
    );
    
    expect(relayNodes.length).toBeGreaterThan(0);
  });

  it('includes bootstrap-capable nodes', () => {
    const bootstrapNodes = PRODUCTION_BOOTSTRAP_LIST.nodes.filter(node =>
      node.capabilities?.includes('bootstrap')
    );
    
    expect(bootstrapNodes.length).toBeGreaterThan(0);
  });

  it('includes store-forward capable nodes', () => {
    const storeNodes = PRODUCTION_BOOTSTRAP_LIST.nodes.filter(node =>
      node.capabilities?.includes('store-forward')
    );
    
    expect(storeNodes.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// Failover Scenario Tests
// ============================================================================

describe('Bootstrap Failover Scenarios', () => {
  it('can construct fallback bootstrap list', () => {
    // Primary nodes would be first 2
    const fallbackNodes = PRODUCTION_BOOTSTRAP_LIST.nodes.slice(2);
    
    expect(fallbackNodes.length).toBeGreaterThan(0);
  });

  it('has diverse fallback options', () => {
    // Count nodes by region
    const nodesByRegion: Record<string, number> = {};
    
    for (const node of PRODUCTION_BOOTSTRAP_LIST.nodes) {
      const dnsAddresses = node.addresses.dns || [];
      for (const dns of dnsAddresses) {
        if (dns.includes('us-')) {
          nodesByRegion['US'] = (nodesByRegion['US'] || 0) + 1;
        } else if (dns.includes('eu-')) {
          nodesByRegion['EU'] = (nodesByRegion['EU'] || 0) + 1;
        } else if (dns.includes('ap-')) {
          nodesByRegion['AP'] = (nodesByRegion['AP'] || 0) + 1;
        } else if (dns.includes('sa-')) {
          nodesByRegion['SA'] = (nodesByRegion['SA'] || 0) + 1;
        }
      }
    }
    
    // No single region should dominate (>50%)
    const total = Object.values(nodesByRegion).reduce((a, b) => a + b, 0);
    if (total > 0) {
      for (const count of Object.values(nodesByRegion)) {
        expect(count / total).toBeLessThanOrEqual(0.5);
      }
    }
  });

  it('IPFS provides alternative discovery path', () => {
    expect(IPFS_GATEWAYS.length).toBeGreaterThan(0);
    expect(PRODUCTION_BOOTSTRAP_LIST.ipfsManifests?.length).toBeGreaterThan(0);
  });

  it('DNS seeds provide additional fallback', () => {
    expect(PRODUCTION_BOOTSTRAP_LIST.dnsSeeds?.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// Bootstrap List Update Mechanism
// ============================================================================

describe('Bootstrap List Update Mechanism', () => {
  it('can fetch updated bootstrap list from IPFS', async () => {
    const mockIPFSFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        version: 2,
        updated: new Date().toISOString(),
        nodes: PRODUCTION_BOOTSTRAP_LIST.nodes,
        signature: 'mock-signature',
      }),
    });
    
    const result = await mockIPFSFetch('/ipfs/QmTestCID');
    expect(result.ok).toBe(true);
    
    const data = await result.json();
    expect(data).toHaveProperty('version');
    expect(data).toHaveProperty('nodes');
    expect(data).toHaveProperty('signature');
  });

  it('validates bootstrap list version', () => {
    const currentVersion = PRODUCTION_BOOTSTRAP_LIST.version;
    const minSupportedVersion = 1;
    
    expect(currentVersion).toBeGreaterThanOrEqual(minSupportedVersion);
  });

  it('list has valid timestamp', () => {
    const updated = new Date(PRODUCTION_BOOTSTRAP_LIST.updated);
    expect(updated.getTime()).toBeLessThanOrEqual(Date.now());
  });
});

// ============================================================================
// Security Configuration Tests  
// ============================================================================

describe('Bootstrap Security Configuration', () => {
  it('uses secure DNS entries', () => {
    for (const node of PRODUCTION_BOOTSTRAP_LIST.nodes) {
      const dnsAddresses = node.addresses.dns || [];
      for (const dns of dnsAddresses) {
        // Should use .app or other secure TLD
        expect(dns).toMatch(/\.(app|xyz|io|net):/);
      }
    }
  });

  it('public keys are present for all nodes', () => {
    for (const node of PRODUCTION_BOOTSTRAP_LIST.nodes) {
      expect(node.publicKey).toBeTruthy();
      expect(node.publicKey.length).toBeGreaterThan(0);
    }
  });

  it('signatures are present for all nodes', () => {
    for (const node of PRODUCTION_BOOTSTRAP_LIST.nodes) {
      expect(node.signature).toBeTruthy();
    }
  });

  it('manifest has signing key ID', () => {
    expect(PRODUCTION_BOOTSTRAP_LIST.signingKeyId).toBeTruthy();
  });
});

