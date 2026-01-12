# Railgun Node Mode - Threat Model

**Version:** 1.0.0  
**Date:** January 12, 2026  
**Status:** Security Review

---

## 1. Executive Summary

This document analyzes the security threats specific to Railgun Node Mode mesh networking. It identifies attack vectors, assesses risks, and specifies mitigations.

**Trust Assumptions:**
1. End-to-end encryption (E2EE) protects message contents
2. Node operators may be malicious
3. Network links are untrusted
4. Physical device access by attackers is possible

---

## 2. Assets Under Protection

| Asset | Confidentiality | Integrity | Availability |
|-------|-----------------|-----------|--------------|
| Message content | CRITICAL | CRITICAL | HIGH |
| User identity | HIGH | HIGH | MEDIUM |
| Node identity | MEDIUM | HIGH | MEDIUM |
| Social graph (who talks to whom) | HIGH | MEDIUM | LOW |
| Location data | HIGH | MEDIUM | LOW |
| Message metadata (timing, size) | MEDIUM | LOW | LOW |
| Routing tables | LOW | MEDIUM | MEDIUM |

---

## 3. Threat Actors

### 3.1 Passive Adversary

**Capabilities:**
- Observe network traffic
- Deploy sniffer nodes
- Analyze timing patterns

**Goals:**
- Learn who communicates with whom
- Correlate node movements
- Build social graph

**Risk Level:** HIGH (easy to deploy)

### 3.2 Active Local Adversary

**Capabilities:**
- Operate malicious nodes
- Inject/modify/drop messages
- Perform DoS attacks
- Impersonate nodes

**Goals:**
- Disrupt communications
- Isolate targets
- Inject false messages

**Risk Level:** HIGH

### 3.3 Global Adversary (Nation-State)

**Capabilities:**
- Compromise multiple nodes
- Long-term traffic analysis
- Physical device seizure
- Compel cooperation

**Goals:**
- Identify all users
- Decrypt historical messages
- Map entire network

**Risk Level:** MEDIUM (high impact, harder to execute)

### 3.4 Malicious Node Operator

**Capabilities:**
- Full access to their node
- See routing metadata
- Store/forward selectively

**Goals:**
- Spy on users
- Sell metadata
- Censor messages

**Risk Level:** HIGH

---

## 4. Attack Vectors

### 4.1 Sybil Attack

**Description:** Attacker creates many fake node identities to gain disproportionate influence.

**Impact:**
- Dominate routing decisions
- Increase traffic analysis success
- Perform eclipse attacks

**Likelihood:** HIGH

**Mitigations:**
| Mitigation | Effectiveness | Implementation Cost |
|------------|---------------|---------------------|
| Rate limiting per node | MEDIUM | LOW |
| Proof-of-work for node registration | HIGH | MEDIUM |
| Social graph verification | HIGH | HIGH |
| Reputation system | MEDIUM | MEDIUM |

**Recommended Implementation:**
```
NodeRegistration {
    // Require computational proof
    proof_of_work: ProofOfWork {
        challenge: [u8; 32],
        nonce: u64,
        difficulty: u32  // Leading zero bits required
    },
    
    // Or social vouching
    vouches: Vec<Vouch> {
        voucher_node_id: [u8; 32],
        signature: [u8; 64]
    },
    min_vouches_required: 2
}
```

### 4.2 Eclipse Attack

**Description:** Attacker surrounds victim node with malicious nodes, isolating it from honest network.

**Impact:**
- Complete isolation of target
- All messages intercepted
- False view of network

**Likelihood:** MEDIUM (requires many nodes near target)

**Mitigations:**
| Mitigation | Effectiveness | Implementation Cost |
|------------|---------------|---------------------|
| Diverse peer selection | HIGH | LOW |
| Geographic diversity requirements | MEDIUM | MEDIUM |
| Out-of-band verification | HIGH | HIGH |

**Recommended Implementation:**
```
PeerSelection {
    // Don't connect to too many nodes from same "region"
    max_peers_per_subnet: 2,
    
    // Require diversity in peer set
    min_unique_first_hops: 3,
    
    // Randomly rotate peers
    peer_rotation_interval: 1h
}
```

### 4.3 Traffic Analysis

**Description:** Adversary observes message timing, size, and routing to infer communication patterns.

**Impact:**
- Social graph reconstruction
- Activity pattern analysis
- Target identification

**Likelihood:** HIGH (passive attack)

**Mitigations:**
| Mitigation | Effectiveness | Implementation Cost |
|------------|---------------|---------------------|
| Constant-rate traffic | HIGH | HIGH (bandwidth) |
| Random delays | MEDIUM | LOW |
| Message padding | MEDIUM | LOW |
| Onion routing | HIGH | MEDIUM |
| Mix networks | VERY HIGH | HIGH |

**Recommended Implementation:**
```
TrafficObfuscation {
    // Pad all bundles to fixed sizes
    bundle_size_classes: [1KB, 4KB, 16KB, 64KB],
    
    // Random forwarding delay
    forward_delay: Uniform(100ms, 5s),
    
    // Dummy traffic generation
    dummy_traffic_rate: 0.1,  // 10% dummy bundles
    
    // Onion routing (optional)
    onion_layers: 3,
    onion_path_length: 3
}
```

### 4.4 Message Replay Attack

**Description:** Attacker re-injects previously captured bundles.

**Impact:**
- Wasted resources
- Potential message duplication
- DoS via storage exhaustion

**Likelihood:** HIGH (trivial to execute)

**Mitigations:**
| Mitigation | Effectiveness | Implementation Cost |
|------------|---------------|---------------------|
| Bloom filter for seen bundles | HIGH | LOW |
| Timestamp validation | MEDIUM | LOW |
| Nonce per bundle | HIGH | LOW |

**Recommended Implementation:**
```
ReplayPrevention {
    // Bloom filter parameters
    bloom_filter_size: 100KB,
    bloom_fpr: 0.001,
    bloom_rotation_interval: 24h,
    
    // Timestamp window
    max_clock_skew: 5min,
    max_future_timestamp: 1min,
    
    // Bundle uniqueness
    bundle_id: UUID_v4,  // Random, not guessable
}
```

### 4.5 Denial of Service (DoS)

**Description:** Attacker overwhelms nodes with traffic or malformed data.

**Impact:**
- Node unavailability
- Battery drain
- Network congestion

**Likelihood:** HIGH

**Attack Variants:**
1. **Storage exhaustion** - Fill victim's bundle store
2. **CPU exhaustion** - Force expensive crypto operations
3. **Battery drain** - Keep radios active
4. **Bandwidth flooding** - Saturate connections

**Mitigations:**
| Mitigation | Effectiveness | Implementation Cost |
|------------|---------------|---------------------|
| Per-peer rate limiting | HIGH | LOW |
| Storage quotas | HIGH | LOW |
| Priority queuing | MEDIUM | LOW |
| Proof-of-work | HIGH | MEDIUM |
| Reputation gating | HIGH | MEDIUM |

**Recommended Implementation:**
```
DoSPrevention {
    // Rate limits
    max_bundles_per_peer_per_min: 100,
    max_bytes_per_peer_per_min: 1MB,
    max_connections_per_min: 10,
    
    // Storage limits
    max_relay_storage: 100MB,
    max_bundles_per_destination: 100,
    
    // Priority queuing
    priority_queue_sizes: {
        CRITICAL: unlimited,
        URGENT: 1000,
        NORMAL: 10000,
        BULK: 1000
    },
    
    // Require PoW for strangers
    pow_difficulty_for_unknown_nodes: 16  // bits
}
```

### 4.6 Node Impersonation

**Description:** Attacker claims to be a different node or user.

**Impact:**
- Message interception
- False message injection
- Reputation theft

**Likelihood:** MEDIUM (requires key theft or protocol flaw)

**Mitigations:**
| Mitigation | Effectiveness | Implementation Cost |
|------------|---------------|---------------------|
| Ed25519 signatures on all bundles | HIGH | LOW |
| TLS mutual authentication | HIGH | LOW |
| User-node binding | HIGH | MEDIUM |

**Recommended Implementation:**
```
Authentication {
    // Every bundle is signed
    bundle_signature: Ed25519(node_private_key, bundle_data),
    
    // TLS with client certs
    tls_version: 1.3,
    require_client_cert: true,
    
    // Optional user binding
    user_node_binding: {
        user_identity_key: [u8; 32],
        user_signature_of_node_id: [u8; 64]
    }
}
```

### 4.7 Routing Manipulation

**Description:** Attacker provides false routing information to misdirect traffic.

**Impact:**
- Message loss
- Traffic interception
- Network partitioning

**Likelihood:** MEDIUM

**Mitigations:**
| Mitigation | Effectiveness | Implementation Cost |
|------------|---------------|---------------------|
| Sign routing updates | HIGH | LOW |
| Verify routes empirically | HIGH | MEDIUM |
| Reputation-weighted routing | MEDIUM | MEDIUM |

**Recommended Implementation:**
```
SecureRouting {
    // Sign routing updates
    routing_update_signature: Ed25519(node_key, update_data),
    
    // Verify delivery success
    track_delivery_success_rate: true,
    penalize_failed_routes: true,
    
    // Don't trust routing info from low-reputation nodes
    min_reputation_for_routing: 0.3
}
```

### 4.8 Timing Attacks

**Description:** Attacker correlates message injection with delivery times.

**Impact:**
- Communication pair identification
- Activity pattern analysis

**Likelihood:** HIGH (passive)

**Mitigations:**
| Mitigation | Effectiveness | Implementation Cost |
|------------|---------------|---------------------|
| Random delays | MEDIUM | LOW |
| Batch processing | MEDIUM | LOW |
| Cover traffic | HIGH | HIGH |

### 4.9 Physical Device Compromise

**Description:** Attacker gains physical access to a device.

**Impact:**
- Key extraction
- Message history access
- Node impersonation

**Likelihood:** MEDIUM

**Mitigations:**
| Mitigation | Effectiveness | Implementation Cost |
|------------|---------------|---------------------|
| Encrypted storage | HIGH | LOW |
| Secure enclave for keys | HIGH | LOW (platform support) |
| Remote wipe capability | HIGH | MEDIUM |
| Key rotation | MEDIUM | MEDIUM |

### 4.10 Metadata Leakage via Bundle Headers

**Description:** Bundle headers reveal source, destination, timing.

**Impact:**
- Communication graph
- User activity patterns

**Likelihood:** HIGH (fundamental to routing)

**Mitigations:**
| Mitigation | Effectiveness | Implementation Cost |
|------------|---------------|---------------------|
| Onion routing | HIGH | MEDIUM |
| Destination hiding (bloom filters) | MEDIUM | MEDIUM |
| Source hiding (indirection) | MEDIUM | MEDIUM |

**Recommended Implementation:**
```
OnionRouting {
    // Wrap bundle in encryption layers
    layers: 3,
    
    // Each layer only reveals next hop
    layer_encryption: XChaCha20-Poly1305,
    
    // Path selection
    path_length: 3,
    select_from_reputation_above: 0.5,
    avoid_same_geographic_region: true
}
```

---

## 5. Risk Matrix

| Threat | Likelihood | Impact | Risk Score | Priority |
|--------|------------|--------|------------|----------|
| Sybil Attack | HIGH | HIGH | CRITICAL | P0 |
| Traffic Analysis | HIGH | MEDIUM | HIGH | P1 |
| DoS | HIGH | MEDIUM | HIGH | P1 |
| Message Replay | HIGH | LOW | MEDIUM | P2 |
| Eclipse Attack | MEDIUM | HIGH | HIGH | P1 |
| Node Impersonation | MEDIUM | HIGH | HIGH | P1 |
| Routing Manipulation | MEDIUM | MEDIUM | MEDIUM | P2 |
| Physical Compromise | MEDIUM | HIGH | HIGH | P1 |
| Timing Attacks | HIGH | MEDIUM | HIGH | P1 |
| Metadata Leakage | HIGH | MEDIUM | HIGH | P1 |

---

## 6. Security Requirements

### 6.1 MUST Have (MVP)

- [ ] Ed25519 signatures on all bundles
- [ ] Bloom filter duplicate detection
- [ ] Per-peer rate limiting
- [ ] Storage quotas
- [ ] TLS 1.3 for all connections
- [ ] Encrypted local storage
- [ ] Timestamp validation

### 6.2 SHOULD Have (v1.1)

- [ ] Proof-of-work for unknown nodes
- [ ] Reputation system
- [ ] Random forwarding delays
- [ ] Message size padding
- [ ] Peer diversity requirements

### 6.3 MAY Have (Future)

- [ ] Full onion routing
- [ ] Mix network support
- [ ] Social graph verification
- [ ] Cover traffic generation
- [ ] Geographic diversity enforcement

---

## 7. Security Monitoring

### 7.1 Metrics to Track

```
SecurityMetrics {
    // Attack detection
    duplicate_bundles_rejected: Counter,
    invalid_signatures_rejected: Counter,
    rate_limited_peers: Counter,
    storage_quota_exceeded: Counter,
    
    // Network health
    peer_churn_rate: Gauge,
    average_reputation: Gauge,
    routing_success_rate: Gauge,
    
    // Anomaly indicators
    unusual_traffic_patterns: Alerts,
    reputation_drops: Alerts,
    isolation_indicators: Alerts
}
```

### 7.2 Alerting Conditions

```
Alerts:
- Peer reputation drops below 0.2
- More than 10% of bundles rejected in 5 min
- Fewer than 3 diverse peers for 10 min
- Storage 90% full
- Unusual bundle size distribution
- Timing correlation detected
```

---

## 8. Incident Response

### 8.1 Suspected Sybil Attack

1. Increase proof-of-work difficulty
2. Require vouches for new connections
3. Rotate peers aggressively
4. Alert user to potential compromise

### 8.2 Suspected Eclipse Attack

1. Use out-of-band channel to verify connectivity
2. Force connection to known-good peers
3. Use internet gateway if available
4. Alert user about potential isolation

### 8.3 Key Compromise

1. Generate new node identity
2. Notify contacts of key change
3. Blacklist old node_id
4. Revoke user-node binding if present

---

## 9. Residual Risks

After all mitigations, these risks remain:

| Residual Risk | Severity | Acceptance Rationale |
|---------------|----------|----------------------|
| Timing correlation by global adversary | MEDIUM | Cost prohibitive to fully prevent |
| First-hop knows your node_id | LOW | Unavoidable in P2P network |
| Message existence is revealed | LOW | Encrypted content protects |
| Long-term traffic analysis | MEDIUM | Users should rotate identities |

---

## 10. Security Checklist for Implementation

### 10.1 Cryptographic Implementation

- [ ] Use audited crypto libraries (libsodium)
- [ ] No custom crypto algorithms
- [ ] Constant-time comparisons
- [ ] Secure random number generation
- [ ] Key derivation uses HKDF

### 10.2 Network Implementation

- [ ] TLS 1.3 only, no downgrades
- [ ] Certificate pinning where applicable
- [ ] No cleartext fallback
- [ ] Connection timeout enforcement
- [ ] Input validation on all messages

### 10.3 Storage Implementation

- [ ] Encrypted at rest (platform keychain)
- [ ] Secure deletion where possible
- [ ] No sensitive data in logs
- [ ] Memory zeroization after use

### 10.4 Operational Security

- [ ] No debug flags in production
- [ ] Rate limiting enabled by default
- [ ] Quotas enforced by default
- [ ] Monitoring and alerting active

---

## Appendix A: Cryptographic Primitives

| Purpose | Algorithm | Key Size | Notes |
|---------|-----------|----------|-------|
| Node identity | Ed25519 | 256-bit | Signing only |
| Bundle signature | Ed25519 | 256-bit | |
| Key exchange | X25519 | 256-bit | For onion routing |
| Symmetric encryption | XChaCha20-Poly1305 | 256-bit | AEAD |
| Hashing | BLAKE2b | 256/512-bit | |
| KDF | HKDF-SHA256 | - | |
| Bloom filter hash | SipHash-2-4 | 128-bit | Non-cryptographic OK |

---

## Appendix B: References

1. "A Survey of Routing Attacks in Mobile Ad Hoc Networks" - Karlof & Wagner
2. "Sybil Attack" - Douceur, 2002
3. "Eclipse Attacks on Bitcoin's Peer-to-Peer Network" - Heilman et al.
4. "Traffic Analysis Attacks and Trade-Offs in Anonymity Providing Systems" - Shmatikov
5. "The Tor Project - Design Document"
6. "Signal Protocol Technical Documentation"
