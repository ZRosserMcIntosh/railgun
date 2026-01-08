# Railgun Doctrine

**Version:** 1.0  
**Effective:** January 8, 2026  
**Status:** CANONICAL

---

## The Ten Principles

### 1. Protocol Over Platform
The core protocol is an open standard that survives any operator, including its creators. No single entity controls execution. The protocol is the product; the business sells the bridge.

### 2. Layer Separation is Non-Negotiable
```
Layer 3: User Sovereignty    → Client-side encryption, user-held keys
Layer 2: Business Services   → Optional paid services, can die without killing core
Layer 1: Sovereign Core      → Open protocol, decentralized, survives all operators
```
Each layer can fail independently. The business layer is not the protocol.

### 3. User Keys, User Data
All content is encrypted client-side with keys the user holds. The system is **cryptographically incapable** of reading user content. This is not policy—it is architecture.

### 4. Business Layer is Optional
Paid services (hosting, compliance tooling, enterprise features) are value-add bridges, not gatekeepers. The protocol works without them. A user can operate entirely on the P2P layer with zero company involvement.

### 5. Minimal Retention, Standard Deletion
Retain only what's operationally necessary. Delete on schedule. No "nuclear options"—just defensible, boring data practices. When in doubt, don't store it.

### 6. No Central Content Authority
The protocol has no content moderation capability at the core. It cannot be added. Business layer offers optional moderation-as-a-service for enterprise clients who want it—operating on data they hold.

### 7. Multi-Jurisdiction Resilience
Bootstrap nodes, relay infrastructure, and corporate entities distributed across jurisdictions. No single legal venue can terminate the network. No single government can issue an order that kills the system.

### 8. Compliance Without Compromise
Enterprise customers get compliance interfaces (audit logs, admin controls, retention policies) that operate on **their** data, not the protocol's data. We sell tools; customers choose how to use them.

### 9. Monetize the Bridge, Not the Rail
Revenue comes from performance, reliability, tooling, and support—**never** from gatekeeping access to the core protocol. Free users are not second-class; they're future customers.

### 10. Boring to Explain, Painful to Remove
Design for infrastructure status—deeply embedded, standards-compliant, and operationally essential to customers. We want to be plumbing, not a feature.

---

## The Three Laws

1. **Plaintext never leaves the client.** If plaintext touches a server, we failed.

2. **The protocol survives the company.** If Railgun Inc. dies tomorrow, users keep communicating.

3. **Architecture over policy.** Don't promise what you could technically violate. Build systems that can't violate.

---

## Tradeoff Framework

When facing architectural decisions, apply this hierarchy:

```
1. Does it preserve user sovereignty?        → Non-negotiable
2. Does it maintain protocol independence?   → Non-negotiable  
3. Does it enable business viability?        → Required
4. Does it improve user experience?          → Desired
5. Does it reduce operational cost?          → Nice to have
```

If a feature requires compromising #1 or #2, the answer is **no**.

---

## What We Are / What We Are Not

### We Are
- Infrastructure for secure communication
- A protocol that anyone can implement
- A business that sells performance, reliability, and tooling
- Boring plumbing that works

### We Are Not
- A content platform
- A social network
- A cryptocurrency project
- A privacy brand that profits from fear

---

## The Survivability Test

Before any major decision, ask:

1. **If AWS terminates us tomorrow**, does the network survive?
2. **If the US government issues a takedown**, does the network survive?
3. **If I (the founder) am unavailable**, does the network survive?
4. **If our largest customer leaves**, does the business survive?
5. **If a competitor clones our client**, does our business model survive?

If any answer is "no," fix it before proceeding.

---

## Canonical References

- **Protocol Specification:** `/docs/PROTOCOL_SPECIFICATION_V1.md`
- **Architecture Guide:** `/docs/HYBRID_TRANSPORT_ARCHITECTURE.md`
- **Security Model:** `/docs/SECURITY.md`

---

*This document is the operating doctrine. It is not aspirational—it is descriptive of how we build. Any code or decision that violates these principles is a bug.*
