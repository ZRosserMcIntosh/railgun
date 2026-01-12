# Security Audit & Fixes - January 11, 2026

## 🔒 Critical Findings & Resolutions

### ✅ RESOLVED: Terraform Secrets Exposure

**Finding:** `infra/terraform/terraform.tfvars` was committed with production secrets

**Impact:** HIGH - Secrets were in git history on public repository

**Secrets Exposed:**
- `db_password`
- `jwt_secret` 
- `recovery_code_secret`
- `dm_id_secret`

**Actions Taken:**
1. ✅ Removed file from git tracking: `git rm --cached infra/terraform/terraform.tfvars`
2. ✅ Added to `.gitignore`: `infra/terraform/terraform.tfvars`
3. ✅ Committed and pushed fix

**⚠️ REQUIRED ACTION:**
- **ROTATE ALL EXPOSED SECRETS IMMEDIATELY**
- Update production environment variables
- Consider using `git filter-branch` or BFG Repo-Cleaner to purge history (optional but recommended)

---

### ✅ FIXED: Entitlement Token Storage Fallback

**Finding:** `entitlement.ts` would fallback to insecure localStorage if secure storage failed

**Impact:** MEDIUM - Increased token exposure risk in compromised renderer

**Fix Applied:**
```typescript
// Before: Always fell back to localStorage
// After: Fail closed in production, fallback only in development

if (import.meta.env.PROD) {
  throw new Error('Secure storage unavailable');
}
```

**Security Improvement:**
- Production now fails closed if secure storage unavailable
- localStorage fallback only in development mode
- Both `saveEntitlementToken()` and `loadEntitlementToken()` updated

---

### ✅ VERIFIED: .env File Safety

**Finding:** `.env` file exists in workspace with production secrets

**Status:** ✅ SAFE - File is properly gitignored

**Verification:**
- `.env` not tracked in git: ✅
- `.env` never in git history: ✅
- `.gitignore` properly configured: ✅

---

## 🆕 New Security Feature: Auto-Signout

### Implementation

Added user-configurable auto-signout timer to protect unattended sessions:

**Files Created:**
- `apps/desktop/src/stores/settingsStore.ts` - Settings state management
- `apps/desktop/src/hooks/useAutoSignout.ts` - Auto-signout logic with activity detection

**Files Modified:**
- `apps/desktop/src/components/UserPanel.tsx` - Added UI controls
- `apps/desktop/src/layouts/MainLayout.tsx` - Integrated hook
- `apps/desktop/src/stores/index.ts` - Exported new store

### Features

**Timer Options:**
- 5, 10, 15, 30, or 60 minutes
- Toggle on/off
- Persisted in localStorage

**Activity Detection:**
- Monitors: mousedown, mousemove, keypress, scroll, touchstart, click
- Throttled to 1 second to avoid performance impact
- Automatically resets timer on any user activity

**Security:**
- Timer automatically disabled when user logs out
- No activity tracking across sessions
- Clean up on component unmount

### Usage

Users can configure auto-signout in **Privacy Settings** (gear icon in UserPanel):

1. Toggle "Auto Sign-Out" on
2. Select timeout period (5-60 minutes)
3. Timer resets on any activity
4. Automatic logout after inactivity period

---

## 📋 Additional Security Checks

### ✅ GitHub Repository Status

**Railgun Repo:**
- ✅ No `.env` files in tracking
- ✅ `terraform.tfvars` removed from tracking
- ✅ `.gitignore` properly configured
- ⚠️ Secrets still in git history (rotation required)

**Railgun-Site Repo:**
- ✅ No secrets found
- ✅ Clean repository

### ✅ .gitignore Coverage

Current `.gitignore` properly excludes:
```
# Environment files
.env
.env.local
.env.*.local

# Keys and secrets
*.pem
*.key
*.crt
secrets/

# Terraform
.terraform/
*.tfstate
*.tfstate.*
*.tfplan
tfplan
**/.terraform/
**/terraform.tfstate*
infra/terraform/terraform.tfvars
```

---

## 🎯 Action Items

### Critical (Do Immediately)

- [ ] **ROTATE ALL EXPOSED SECRETS:**
  - [ ] Generate new `db_password`
  - [ ] Generate new `jwt_secret`
  - [ ] Generate new `recovery_code_secret`
  - [ ] Generate new `dm_id_secret`
  - [ ] Update production environment with new values
  - [ ] Test that old secrets no longer work

### Recommended (Do Soon)

- [ ] Consider purging git history with BFG Repo-Cleaner:
  ```bash
  bfg --delete-files terraform.tfvars --no-blob-protection
  git reflog expire --expire=now --all
  git gc --prune=now --aggressive
  ```
- [ ] Set up secret manager (AWS Secrets Manager, HashiCorp Vault, etc.)
- [ ] Add pre-commit hooks to prevent future secret commits

### Optional (Nice to Have)

- [ ] Add secret scanning to CI/CD pipeline
- [ ] Regular security audits every quarter
- [ ] Consider SOC 2 compliance

---

## ✅ Platform Still Works

All security fixes are **non-breaking**:

- ✅ Tokens still load from secure storage
- ✅ Development mode still works (with fallback)
- ✅ Production mode fails safely (no insecure fallback)
- ✅ Auto-signout is optional (default: disabled)
- ✅ Existing users unaffected

---

## 📊 Summary

| Finding | Severity | Status | Action Required |
|---------|----------|--------|-----------------|
| Terraform secrets in git | 🔴 Critical | ✅ Fixed | ⚠️ Rotate secrets |
| Entitlement localStorage fallback | 🟡 Medium | ✅ Fixed | None |
| .env file safety | 🟢 Low | ✅ Verified | None |

**Total Issues Found:** 3  
**Total Issues Fixed:** 3  
**Action Items Remaining:** 1 (secret rotation)

---

## 🔐 Doctrine Compliance

These fixes align with **Rail Gun Doctrine**:

- **Principle 3 (User Keys, User Data):** Strengthened by failing closed on storage errors
- **Principle 7 (Minimal Metadata):** Auto-signout reduces session exposure window
- **Principle 10 (Transparency):** This audit documented publicly in repo

---

*Audit completed: January 11, 2026*  
*Next audit recommended: April 11, 2026*
