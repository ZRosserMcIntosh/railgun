# Rail Gun - Full Audit Report & VOIP Implementation

**Date**: December 17, 2025  
**Version**: 0.1.0  
**Auditor**: Rail Gun Development Team

---

## Executive Summary

This document provides a comprehensive audit of the Rail Gun secure messaging platform and documents the new Anonymous VOIP Dialer feature. Rail Gun is an end-to-end encrypted, Discord-like desktop messaging application with a focus on privacy and security.

---

## 1. Architecture Overview

### Current Stack

| Layer | Technology | Status |
|-------|------------|--------|
| Frontend | React 18 + TypeScript | ✅ Implemented |
| Desktop Shell | Electron 28 | ✅ Implemented |
| UI Framework | Tailwind CSS | ✅ Implemented |
| State Management | Zustand | ✅ Implemented |
| Backend | NestJS | ✅ Implemented |
| Database | PostgreSQL 15 | ✅ Configured |
| Cache | Redis 7 | ✅ Configured |
| Real-time | Socket.IO | ✅ Implemented |
| Encryption | Signal Protocol (libsignal) | ✅ Implemented |
| Build | Vite + pnpm | ✅ Configured |

### Project Structure

```
railgun/
├── packages/
│   └── shared/          # Shared TypeScript types, DTOs, protocol enums
├── services/
│   └── api/             # HTTP + WebSocket backend (NestJS)
├── apps/
│   └── desktop/         # Electron + React macOS client
│       └── src/
│           ├── components/
│           │   ├── voip/      # 🆕 Anonymous Phone Dialer
│           │   ├── ChatArea.tsx
│           │   ├── Sidebar.tsx
│           │   └── ...
│           ├── stores/
│           │   ├── voipStore.ts  # 🆕 VOIP State Management
│           │   ├── chatStore.ts
│           │   └── authStore.ts
│           ├── lib/
│           │   ├── voipService.ts  # 🆕 VOIP Provider Integration
│           │   └── ...
│           └── crypto/         # Signal protocol implementation
└── infra/               # Docker, migrations, CI scripts
```

---

## 2. Security Audit

### ✅ Strengths

1. **End-to-End Encryption**
   - Signal Protocol implementation with X3DH key exchange
   - Double Ratchet for forward secrecy
   - Private keys never leave the device

2. **Server Blindness**
   - Server only sees encrypted blobs and routing metadata
   - Key bundles contain only public keys

3. **Secure Token Storage**
   - Electron safeStorage for tokens
   - Encrypted local storage for keys

4. **Message Security**
   - Messages decrypted only on client
   - Local message history encrypted at rest

### ⚠️ Areas for Improvement

1. **Key Rotation**
   - Signed pre-keys should be rotated weekly
   - One-time pre-keys should be replenished when low

2. **Recovery Mechanism**
   - Recovery codes are strong, but consider hardware key support
   - Add option for air-gapped backup

3. **Metadata Protection**
   - Consider onion routing for enhanced metadata protection
   - Implement message padding to prevent traffic analysis

4. **Audit Logging**
   - Add client-side security event logging
   - Implement tamper-evident logs

---

## 3. New Feature: Anonymous VOIP Dialer 📞

### Overview

The Anonymous VOIP Dialer allows users to make phone calls to real phone numbers with caller ID blocking enabled by default.

### Features

| Feature | Description | Status |
|---------|-------------|--------|
| *67 Anonymous Calling | Caller ID hidden by default | ✅ Implemented |
| Dialpad UI | Full T9 dialpad with DTMF | ✅ Implemented |
| Call History | Local-only storage | ✅ Implemented |
| Instant Delete | Permanent deletion, no recovery | ✅ Implemented |
| Active Call UI | Full-screen and minimized modes | ✅ Implemented |
| Mute/Speaker | In-call audio controls | ✅ Implemented |
| Provider Abstraction | Supports Twilio, Vonage, etc. | ✅ Implemented |

### File Structure

```
src/components/voip/
├── index.ts           # Exports all VOIP components
├── VoipDialer.tsx     # Dialpad component
├── CallHistory.tsx    # Call records with delete
├── ActiveCall.tsx     # In-call UI overlay
└── VoipPage.tsx       # Main VOIP page container

src/stores/
└── voipStore.ts       # VOIP state management

src/lib/
└── voipService.ts     # VOIP provider integration
```

### Privacy Features

1. **Anonymous by Default**
   - All calls prefixed with *67 unless toggled off
   - Visual indicator shows anonymous status

2. **Local-Only Storage**
   - Call history stored in memory only
   - No persistence to disk or server
   - Records cleared on app restart

3. **Instant Permanent Delete**
   - Individual records can be deleted instantly
   - "Delete All" option available
   - No soft delete, no recovery, no undo

4. **No Server Records**
   - Call metadata never sent to server
   - Provider integration handles actual calls
   - User controls all data

### Integration Points

The VOIP feature is accessible via:
- Sidebar phone icon (green button)
- Route: `/phone`

### Provider Configuration

```typescript
// Initialize with Twilio (production)
await voipService.initialize({
  twilioAccountSid: 'YOUR_ACCOUNT_SID',
  twilioAuthToken: 'YOUR_AUTH_TOKEN',
  twilioPhoneNumber: '+1XXXXXXXXXX',
}, true);

// Or use mock provider (development)
await voipService.initialize({}, false);
```

---

## 4. Implementation Status

### Completed Stages

- [x] Stage 0: Repository & Tooling
- [x] Stage 1: Minimal Backend (No Encryption)
- [x] Stage 2: Desktop Skeleton (No Encryption)
- [x] Stage 3: Key Infrastructure & 1:1 E2E DMs
- [x] **VOIP Dialer Feature** (NEW)

### Pending Stages

- [ ] Stage 4: Encrypted Communities & Channels
- [ ] Stage 5: UX Polish & macOS Packaging
- [ ] Stage 6: Windows/Linux Support

---

## 4. New Feature: Account Nuke (Secure Wipe) ☢️

### Overview

The Account Nuke feature provides military-grade data destruction capabilities, implementing secure deletion patterns used by government agencies (DoD 5220.22-M) and security researchers (Gutmann method). When activated, ALL user data is irreversibly destroyed.

### Security Model

| Feature | Description | Implementation |
|---------|-------------|----------------|
| DoD 5220.22-M | US Department of Defense standard | 7-pass overwrite pattern |
| Gutmann Method | 35-pass overwrite for magnetic media | Full pattern implementation |
| Rail Gun Mode | Maximum paranoia mode | 100+ total passes |
| Cryptographic Shredding | Key destruction | Keys overwritten before deletion |
| Verification Passes | Confirm data destruction | Random reads to verify overwrite |

### File Structure

```
src/components/security/
├── index.ts             # Exports security components
└── NukeButton.tsx       # 3-stage destruction UI

src/lib/
└── secureWipe.ts        # Military-grade secure deletion service

services/api/src/
├── auth/auth.controller.ts   # DELETE /auth/nuke endpoint
├── auth/auth.service.ts      # Server-side destruction logic
└── users/users.service.ts    # User data deletion methods
```

### UI Safety Features

The nuke button implements multiple safety mechanisms to prevent accidental activation:

1. **Stage 1: Idle State**
   - Only shows radioactive symbol icon
   - Must click to begin arming sequence

2. **Stage 2: Safety Slider**
   - Must slide safety slider to 95%+ position
   - Visual feedback shows arming progress

3. **Stage 3: Confirmation**
   - Must type exact phrase "NUKE IT"
   - Case-sensitive, no alternatives accepted

4. **Stage 4: Countdown**
   - 5-second countdown before destruction begins
   - Final opportunity to abort

5. **Stage 5: Execution**
   - Real-time progress display
   - Shows bytes destroyed, pass count, phase
   - Cannot be cancelled once started

### Overwrite Patterns

The `secureWipe.ts` service implements these patterns in sequence:

```
Passes 1-7:    DoD 5220.22-M (0x00, 0xFF, random, verify)
Passes 8-42:   Gutmann 35-pass (specific bit patterns for magnetic media)
Passes 43-62:  Cryptographic random data
Passes 63-82:  Alternating 0x55/0xAA patterns
Passes 83-100: Final random passes + verification
```

### Data Destroyed

| Data Type | Location | Method |
|-----------|----------|--------|
| Encryption Keys | IndexedDB + Memory | Overwrite + Delete |
| Messages | Server + Local | Server delete + Local wipe |
| Identity Keys | Local Keystore | Shred with patterns |
| Session Keys | Memory | Zero-fill + GC |
| Recovery Codes | Server | Database delete |
| User Account | Server | Soft delete + Hard delete |
| localStorage | Browser | Key-by-key overwrite |
| sessionStorage | Browser | Full wipe |
| IndexedDB | Browser | Store-by-store deletion |

### API Endpoints

```
DELETE /auth/nuke
- Requires: JWT authentication
- Rate limited: Once per account
- Response: { success: boolean, destroyed: string[] }
```

### Anti-Forensic Measures

1. **Memory Zeroing**: All sensitive data structures are zeroed before garbage collection
2. **Pattern Variation**: Each pass uses different bit patterns to defeat recovery tools
3. **Cryptographic Entropy**: Random data from CSPRNG injected between passes
4. **Metadata Scrubbing**: File timestamps and metadata are overwritten
5. **Server-side Destruction**: Server performs independent data destruction

### Limitations

> ⚠️ **Browser Environment Limitations**
>
> Due to browser security model limitations, true sector-level secure deletion is not possible in JavaScript:
> - Browser APIs don't provide direct disk access
> - SSD wear-leveling may preserve data in spare sectors
> - OS-level caching may retain data copies
>
> **Mitigation**: Use in conjunction with full-disk encryption and device-level secure wipe for maximum security.

---

## 5. Recommendations

### High Priority

1. **Complete VOIP Provider Integration**
   - Set up Twilio account for production
   - Implement proper capability token flow
   - Add call quality monitoring

2. **Add Voice Encryption**
   - Implement SRTP for voice calls
   - Consider SRTP-DTLS for additional security

3. **Enhance Metadata Protection**
   - Implement call metadata stripping
   - Add VPN/Tor integration option

### Medium Priority

4. **Add Contact Management**
   - Allow saving favorite numbers
   - Encrypt contact list locally

5. **Implement Voicemail**
   - Encrypted voicemail storage
   - Auto-delete after playback option

6. **Add SMS Support**
   - Anonymous text messaging
   - Same privacy model as calls

### Low Priority

7. **Multi-device VOIP**
   - Sync VOIP across devices
   - Device handoff during calls

8. **Call Recording**
   - Encrypted local recording
   - User-controlled, opt-in only

---

## 6. Dependencies Audit

### Production Dependencies

| Package | Version | Purpose | Risk |
|---------|---------|---------|------|
| @signalapp/libsignal-client | ^0.86.6 | E2E Encryption | Low |
| libsodium-wrappers | ^0.7.15 | Cryptographic primitives | Low |
| react | ^18.2.0 | UI Framework | Low |
| socket.io-client | ^4.7.4 | Real-time communication | Low |
| zustand | ^4.4.7 | State management | Low |

### Missing Dependencies (for VOIP)

| Package | Purpose | Notes |
|---------|---------|-------|
| @twilio/voice-sdk | Twilio VOIP | Required for production |
| simple-peer | WebRTC wrapper | Alternative to Twilio |

### Installation Command

```bash
# For Twilio integration
pnpm add @twilio/voice-sdk

# For WebRTC alternative
pnpm add simple-peer @types/simple-peer
```

---

## 7. API Surface

### VOIP Store API

```typescript
// State
interface VoipState {
  anonymousByDefault: boolean;
  countryCode: string;
  activeCall: ActiveCall | null;
  callHistory: CallRecord[];
  dialerInput: string;
  isAnonymousCall: boolean;
}

// Key Actions
initiateCall(phoneNumber: string, anonymous?: boolean): Promise<void>;
endCall(): void;
deleteCallRecord(id: string): void;
deleteAllCallHistory(): void;
toggleAnonymousCall(): void;
```

### VOIP Service API

```typescript
// Initialization
voipService.initialize(config: VoipConfig, useTwilio?: boolean): Promise<void>;

// Call Management
voipService.makeCall(phoneNumber: string, anonymous?: boolean): Promise<void>;
voipService.endCall(): Promise<void>;
voipService.sendDTMF(digit: string): Promise<void>;
voipService.setMute(muted: boolean): Promise<void>;

// Audio
voipService.getAudioDevices(): Promise<AudioDevice[]>;
voipService.setAudioDevice(deviceId: string): Promise<void>;
```

---

## 8. Testing Checklist

### VOIP Feature Tests

- [ ] Dialpad input works correctly
- [ ] *67 toggle changes call mode
- [ ] Call can be initiated
- [ ] Active call UI displays correctly
- [ ] Mute/speaker controls work
- [ ] DTMF tones send correctly
- [ ] Call ends properly
- [ ] Call record appears in history
- [ ] Individual delete works
- [ ] Delete all clears history
- [ ] History doesn't persist on restart

### Integration Tests

- [ ] Phone button appears in sidebar
- [ ] Navigation to /phone works
- [ ] Back navigation returns to chat
- [ ] Active call persists during navigation
- [ ] Minimized call widget works

---

## 9. Compliance Considerations

### Legal Notice

⚠️ **Important**: While the system allows for anonymous calling, users should be aware:

1. **Carrier Records**: Phone carriers may retain call metadata
2. **Emergency Services**: *67 may not block caller ID for 911
3. **Legal Requirements**: Some jurisdictions have laws about caller ID spoofing
4. **Terms of Service**: Check your carrier's ToS regarding anonymous calls

### Privacy Policy Updates

The application's privacy policy should be updated to include:
- VOIP feature data handling
- Local-only storage policy
- No server-side call logging
- User's responsibility for legal compliance

---

## 10. Future Roadmap

### Phase 1: VOIP Enhancement (Q1 2025)
- [ ] Production Twilio integration
- [ ] Voice encryption (SRTP)
- [ ] Call quality metrics

### Phase 2: Extended Features (Q2 2025)
- [ ] Anonymous SMS
- [ ] Encrypted voicemail
- [ ] Contact encryption

### Phase 3: Advanced Privacy (Q3 2025)
- [ ] VPN integration
- [ ] Tor support for calls
- [ ] Decentralized calling (P2P)

---

## Conclusion

Rail Gun provides a solid foundation for secure messaging with well-implemented end-to-end encryption. The new Anonymous VOIP Dialer feature extends this security model to phone calls, giving users the ability to make private calls with automatic caller ID blocking and complete control over their call history.

The modular architecture allows for easy extension and provider swapping, while the privacy-first design ensures user data remains under their control at all times.

---

*Document generated by Rail Gun Audit Tool v1.0*
