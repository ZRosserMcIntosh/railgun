# 🔒 Maximum Security Database Hosting Guide

## Executive Summary

This document outlines **Mossad-level security** hosting options for Rail Gun's database infrastructure. The goal is to achieve **absolute privacy** with defense against nation-state adversaries.

---

## Threat Model

Before selecting infrastructure, understand what we're defending against:

| Adversary | Capability | Defense Required |
|-----------|------------|------------------|
| Script Kiddies | Automated attacks | Basic security |
| Cybercriminals | Targeted attacks | Strong encryption |
| Corporations | Legal pressure, data requests | Jurisdiction shopping |
| Intelligence Agencies | Unlimited resources, legal compulsion | Multi-layered defense |
| Nation States | Physical access, network taps | Geographic distribution |

---

## 🏆 Tier 1: Maximum Security Providers

### 1. **Njalla** (Recommended for Domain/DNS)
- **Location**: Nevis (Caribbean)
- **Why**: They own the domains FOR you - your name never appears
- **Features**:
  - Anonymous registration (Bitcoin/Monero accepted)
  - No logs policy
  - Warrant canary
- **Website**: https://njal.la

### 2. **1984 Hosting** (Iceland)
- **Location**: Reykjavik, Iceland
- **Why**: Iceland has the strongest privacy laws in the world
- **Features**:
  - Free speech absolutists
  - Outside EU jurisdiction (but EEA)
  - Accept cryptocurrency
  - No data retention laws
- **Website**: https://1984.hosting

### 3. **FlokiNET** (Iceland/Romania/Finland)
- **Location**: Multiple privacy-friendly jurisdictions
- **Why**: Explicitly designed for whistleblowers and activists
- **Features**:
  - Bulletproof hosting reputation
  - DMCA ignored
  - Offshore servers
  - Bitcoin/Monero accepted
- **Website**: https://flokinet.is

### 4. **Bahnhof** (Sweden)
- **Location**: Underground bunker in Stockholm
- **Why**: Literally in a nuclear bunker, hosted WikiLeaks
- **Features**:
  - Physical security (mountain facility)
  - Strong Swedish privacy laws
  - Diesel generators, independent power
- **Website**: https://bahnhof.se

### 5. **Shinjiru** (Malaysia)
- **Location**: Kuala Lumpur, Malaysia
- **Why**: Outside Western intelligence alliance (Five/Nine/Fourteen Eyes)
- **Features**:
  - Offshore hosting
  - Anonymous registration
  - Crypto payments
- **Website**: https://shinjiru.com

---

## 🌍 Jurisdiction Analysis

### ✅ BEST Privacy Jurisdictions

| Country | Why It's Good | Caveats |
|---------|---------------|---------|
| **Iceland** | Strongest press freedom, no data retention | EEA member (some EU influence) |
| **Switzerland** | Banking secrecy tradition, neutral | Can cooperate on serious crimes |
| **Panama** | No data retention, tax haven | Political instability |
| **Seychelles** | Offshore haven, minimal regulation | Limited infrastructure |
| **Romania** | EU but rejected data retention directive | Part of EU |
| **Moldova** | Outside EU, minimal oversight | Political instability |
| **Malaysia** | Outside Five Eyes, good infrastructure | Some censorship concerns |

### ❌ AVOID These Jurisdictions

| Country | Why |
|---------|-----|
| **USA** | PATRIOT Act, NSLs, FISA courts |
| **UK** | Snoopers' Charter, GCHQ |
| **Australia** | Anti-encryption laws |
| **Canada** | Five Eyes member |
| **Germany** | 14 Eyes, extensive logging laws |
| **France** | 14 Eyes, intelligence agencies |
| **Any EU country** | GDPR cuts both ways, data requests |

---

## 🏗️ Recommended Architecture

### Multi-Jurisdiction Setup

```
                    ┌─────────────────────────────────────────────┐
                    │              USER'S DEVICE                  │
                    │    • E2E Encryption (Signal Protocol)      │
                    │    • Local key storage only                │
                    └─────────────────┬───────────────────────────┘
                                      │
                                      │ Tor/VPN
                                      ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         LAYER 1: ACCESS TIER                            │
│                                                                         │
│   ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐   │
│   │  Cloudflare     │    │   Njalla DNS    │    │  Load Balancer  │   │
│   │  (DDoS only)    │────│   (Anonymous)   │────│   (Iceland)     │   │
│   └─────────────────┘    └─────────────────┘    └─────────────────┘   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                       LAYER 2: APPLICATION TIER                         │
│                                                                         │
│   ┌─────────────────────────────────────────────────────────────────┐  │
│   │                    API Servers (Romania)                         │  │
│   │                                                                   │  │
│   │   • NestJS application                                           │  │
│   │   • No logs (seriously, /dev/null everything)                   │  │
│   │   • Memory-only sessions                                         │  │
│   │   • Encrypted config (loaded from HSM)                          │  │
│   └─────────────────────────────────────────────────────────────────┘  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
                                      │
                                      │ Encrypted tunnel (WireGuard)
                                      ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        LAYER 3: DATA TIER                               │
│                                                                         │
│   ┌──────────────────────┐         ┌──────────────────────┐           │
│   │   PostgreSQL         │         │      Redis           │           │
│   │   (Switzerland)      │         │    (Iceland)         │           │
│   │                      │         │                      │           │
│   │   • Full disk        │         │   • Session store    │           │
│   │     encryption       │         │   • Ephemeral data   │           │
│   │   • TDE enabled      │         │   • Auto-expire      │           │
│   │   • Encrypted        │         │                      │           │
│   │     backups          │         │                      │           │
│   └──────────────────────┘         └──────────────────────┘           │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Database Security Configuration

### PostgreSQL Security Hardening

```sql
-- 1. Enable row-level security
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- 2. Encrypt all stored data (application-level)
-- Messages are ALREADY E2E encrypted, server stores only ciphertext

-- 3. Minimal metadata
-- Don't store: IP addresses, user agents, timestamps (or hash them)

-- 4. Auto-purge old data
CREATE OR REPLACE FUNCTION purge_old_data() RETURNS void AS $$
BEGIN
  -- Delete messages older than 30 days (configurable)
  DELETE FROM messages WHERE created_at < NOW() - INTERVAL '30 days';
  
  -- Vacuum to actually free space
  VACUUM FULL messages;
END;
$$ LANGUAGE plpgsql;

-- 5. Nuke function for account destruction
CREATE OR REPLACE FUNCTION nuke_user(user_id UUID) RETURNS void AS $$
BEGIN
  -- Delete in correct order to handle foreign keys
  DELETE FROM messages WHERE sender_id = user_id;
  DELETE FROM dm_participants WHERE user_id = user_id;
  DELETE FROM community_members WHERE user_id = user_id;
  DELETE FROM device_keys WHERE user_id = user_id;
  DELETE FROM sessions WHERE user_id = user_id;
  DELETE FROM users WHERE id = user_id;
  
  -- Overwrite freed space
  VACUUM FULL;
END;
$$ LANGUAGE plpgsql;
```

### Transparent Data Encryption (TDE)

```bash
# PostgreSQL with TDE using LUKS
cryptsetup luksFormat /dev/sdb
cryptsetup open /dev/sdb pg_encrypted
mkfs.ext4 /dev/mapper/pg_encrypted
mount /dev/mapper/pg_encrypted /var/lib/postgresql/data

# Key stored in separate HSM, not on same server
```

---

## 🕵️ Operational Security (OPSEC)

### Server Administration

1. **Access**
   - SSH keys only (no passwords)
   - Keys stored on hardware tokens (YubiKey)
   - Access via Tor hidden service
   
2. **Logging**
   - Disable ALL logging: `syslog`, `auth.log`, `nginx access logs`
   - Redirect to `/dev/null`
   - Memory-only systemd journals
   
3. **Updates**
   - Automated security updates
   - No human access required for patches

### Payment Anonymity

```
1. Buy Bitcoin with cash (P2P, ATM)
2. Tumble through Wasabi Wallet
3. Convert to Monero (atomic swap)
4. Pay hosting provider
5. Never reuse addresses
```

---

## Warrant Canary System

Implement a warrant canary that automatically stops updating if legally compelled:

```typescript
// canary.service.ts
@Injectable()
export class CanaryService {
  private readonly CANARY_KEY = 'warrant_canary';
  
  // Updated daily by cron, signed with PGP key
  async updateCanary() {
    const statement = {
      date: new Date().toISOString(),
      statement: 'No warrants received. No gag orders in effect.',
      pgpSignature: await this.signWithPGP(statement),
    };
    
    await this.redis.set(this.CANARY_KEY, JSON.stringify(statement));
  }
  
  // If this stops updating, assume compromise
  async getCanary() {
    return this.redis.get(this.CANARY_KEY);
  }
}
```

---

## 💣 Dead Man's Switch

If servers are seized, automatically destroy all data:

```typescript
// deadman.service.ts
@Injectable()
export class DeadManService {
  // Must be "fed" every 24 hours or data is nuked
  async feedDeadMan() {
    await this.redis.set('deadman_last_fed', Date.now());
  }
  
  @Cron('0 * * * *') // Every hour
  async checkDeadMan() {
    const lastFed = await this.redis.get('deadman_last_fed');
    const hoursSinceLastFed = (Date.now() - Number(lastFed)) / 3600000;
    
    if (hoursSinceLastFed > 24) {
      // NUKE EVERYTHING
      await this.nukeAllData();
      await this.wipeDisks();
      await this.shutdown();
    }
  }
  
  private async nukeAllData() {
    // Overwrite database multiple times
    for (let i = 0; i < 7; i++) {
      await this.db.query('UPDATE messages SET content = random_bytes(length(content))');
      await this.db.query('VACUUM FULL');
    }
    await this.db.query('DROP DATABASE railgun');
  }
  
  private async wipeDisks() {
    // Secure erase using ATA secure erase or TRIM
    execSync('blkdiscard /dev/sda');
  }
}
```

---

## Stack

### Production Setup

| Component | Provider | Location | Cost/Month |
|-----------|----------|----------|------------|
| Domain | Njalla | Nevis | ~$15 |
| DNS | Njalla | Distributed | Included |
| CDN/DDoS | Cloudflare | Anycast | Free tier |
| API Server 1 | FlokiNET | Romania | ~$30 |
| API Server 2 | 1984 Hosting | Iceland | ~$25 |
| Database | Private VPS | Switzerland | ~$50 |
| Redis | Same as DB | Switzerland | Included |
| Backups | Encrypted, offsite | Seychelles | ~$20 |

**Total: ~$140/month for Mossad-level infrastructure**

---

## 📋 Checklist

### Before Launch

- [ ] Anonymous domain registration (Njalla)
- [ ] Servers in non-Five Eyes jurisdictions
- [ ] Full disk encryption on all servers
- [ ] No access logs anywhere
- [ ] Cryptocurrency payments only
- [ ] Warrant canary implemented
- [ ] Dead man's switch configured
- [ ] Nuke endpoint tested
- [ ] Backup encryption verified
- [ ] VPN/Tor access only for admin

### Ongoing

- [ ] Monthly security audits
- [ ] Canary updates (automated)
- [ ] Key rotation quarterly
- [ ] Backup restoration tests
- [ ] Penetration testing annually

---

## Legal

There are many legitimate uses for maximum-privacy infrastructure:
- Whistleblower protection
- Journalist source protection  
- Human rights activists
- Privacy-focused consumers
- Businesses with confidentiality requirements

---

## Resources

- [EFF Surveillance Self-Defense](https://ssd.eff.org/)
- [Privacy Guides](https://privacyguides.org/)
- [That One Privacy Site](https://thatoneprivacysite.net/)
- [Prism Break](https://prism-break.org/)

---

*Document Classification: INTERNAL USE ONLY*
*Last Updated: December 2025*
