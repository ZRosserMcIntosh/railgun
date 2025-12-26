# Security Policy

Rail Gun is an end-to-end encrypted messaging application. Security is our top priority.

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |

## Security Model

### End-to-End Encryption
- All messages are encrypted using the **Signal Protocol** via `libsignal`
- Private keys never leave the client device
- The server only stores encrypted ciphertext - it cannot read message contents
- Trust On First Use (TOFU) model with identity key verification

### Client Security
- Authentication tokens stored in OS keychain via Electron `safeStorage`
- Local key stores (identity, pre-key, signed pre-key, sender key) encrypted at rest
- No plaintext message content is ever transmitted to or stored on the server

### Server Security
- Server treats all message payloads as opaque encrypted blobs
- No logging or inspection of message contents
- Rate limiting on all endpoints
- WebSocket connections authenticated and session-bound

## Reporting a Vulnerability

We take all security reports seriously. If you discover a security vulnerability, please report it responsibly.

### How to Report

**DO NOT** open a public GitHub issue for security vulnerabilities.

Instead, please email: **security@[your-domain].com**

Include the following in your report:
1. **Description** of the vulnerability
2. **Steps to reproduce** the issue
3. **Potential impact** assessment
4. **Suggested fix** (if any)
5. Your **contact information** for follow-up

### What to Expect

| Timeline | Action |
| -------- | ------ |
| 24 hours | Initial acknowledgment of your report |
| 72 hours | Preliminary assessment and severity rating |
| 7 days   | Status update on fix progress |
| 90 days  | Maximum disclosure timeline (coordinated) |

### Scope

**In Scope:**
- End-to-end encryption implementation
- Authentication and session management
- Key exchange and storage
- Client-side security (Electron, React)
- API security (authentication, authorization, rate limiting)
- WebSocket security
- Data storage and transmission

**Out of Scope:**
- Social engineering attacks
- Physical attacks on user devices
- Denial of Service (unless application-level vulnerability)
- Issues in third-party dependencies (report upstream, notify us)
- Self-XSS or issues requiring physical device access

### Safe Harbor

We consider security research conducted in good faith to be authorized. We will not pursue legal action against researchers who:

- Make a good faith effort to avoid privacy violations and data destruction
- Do not access or modify other users' data
- Report findings promptly and do not disclose publicly before fix
- Do not exploit vulnerabilities beyond proof-of-concept

## Security Best Practices for Users

### Verify Safety Numbers
When starting a conversation with a new contact, verify their safety number through an out-of-band channel (in person, phone call, etc.) to prevent man-in-the-middle attacks.

### Device Security
- Keep your operating system and Rail Gun updated
- Use strong device passwords/biometrics
- Be cautious of running Rail Gun in untrusted environments

### Key Security
- Your identity key is generated locally and never leaves your device
- If you lose your device, revoke it immediately from another logged-in device
- Periodically review your linked devices

## Security Features

### Implemented
- [x] Signal Protocol encryption (X3DH + Double Ratchet)
- [x] Local key storage with OS keychain integration
- [x] TOFU identity verification
- [x] Signed pre-key rotation
- [x] Rate limiting on API endpoints
- [x] Session-bound WebSocket authentication
- [x] Secure token storage via Electron safeStorage

### Planned
- [ ] Safety number verification UI
- [ ] Device management and revocation
- [ ] Key change notifications
- [ ] Certificate pinning
- [ ] Disappearing messages (cryptographic deletion)
- [ ] Sealed sender (metadata protection)

## Cryptographic Details

### Key Exchange
- X3DH (Extended Triple Diffie-Hellman) for initial key agreement
- Curve25519 for DH operations
- Ed25519 for identity key signatures

### Message Encryption
- Double Ratchet Algorithm for forward secrecy
- AES-256-GCM for symmetric encryption
- HMAC-SHA256 for authentication

### Key Storage
- Identity keys: Permanent, backed up to OS keychain
- Signed pre-keys: Rotated periodically (recommended: 30 days)
- One-time pre-keys: Single use, replenished automatically
- Sender keys: Group messaging, per-group

## Audit Status

- [ ] Independent security audit (planned)
- [x] Internal code review
- [x] Automated dependency scanning (Dependabot)
- [x] Static analysis (CodeQL)

---

**Last Updated:** December 2024

For general questions about security (not vulnerabilities), open a GitHub Discussion.
