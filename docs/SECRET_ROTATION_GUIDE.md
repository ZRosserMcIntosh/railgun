# Secret Rotation Guide

## 🚨 CRITICAL: Rotate Exposed Secrets

The following secrets were exposed in `terraform.tfvars` and **MUST** be rotated immediately.

---

## Step-by-Step Rotation

### 1. Generate New Secrets

```bash
# Generate new random secrets (64 bytes base64-encoded)
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
# Run this 4 times for each secret
```

Or use OpenSSL:
```bash
openssl rand -base64 32
```

### 2. Create New terraform.tfvars

**Location:** `/Users/rossermcintosh/Desktop/railgun/infra/terraform/terraform.tfvars`

**⚠️ This file is gitignored - DO NOT commit it**

```hcl
# Database
db_username = "railgun_admin"
db_password = "NEW_PASSWORD_HERE"  # ← Replace with new value
db_name     = "railgun"

# API Secrets
jwt_secret            = "NEW_JWT_SECRET_HERE"            # ← Replace
recovery_code_secret  = "NEW_RECOVERY_CODE_SECRET_HERE"  # ← Replace
dm_id_secret          = "NEW_DM_ID_SECRET_HERE"          # ← Replace

# Infrastructure
api_port = 3001
```

### 3. Update Production Environment

If you're using environment variables instead of terraform:

```bash
# Set in your deployment environment (AWS, Docker, etc.)
export DB_PASSWORD="new_password_here"
export JWT_SECRET="new_jwt_secret_here"
export RECOVERY_CODE_SECRET="new_recovery_code_secret_here"
export DM_ID_SECRET="new_dm_id_secret_here"
```

### 4. Apply Terraform Changes (if using terraform)

```bash
cd /Users/rossermcintosh/Desktop/railgun/infra/terraform

# Initialize terraform (if not already done)
terraform init

# Plan changes
terraform plan

# Apply new secrets
terraform apply
```

### 5. Restart Services

```bash
# If using docker-compose
cd /Users/rossermcintosh/Desktop/railgun/infra
docker-compose down
docker-compose up -d

# Or restart your API service however you normally do it
```

### 6. Verify

Test that the app still works:
- [ ] Login still works
- [ ] JWT tokens are valid
- [ ] Recovery codes work
- [ ] Database connection successful
- [ ] DM encryption works

### 7. Revoke Old Secrets

After confirming everything works, ensure old secrets are no longer valid:
- [ ] Old database password doesn't work
- [ ] Old JWT tokens are rejected
- [ ] Old recovery codes don't work

---

## 🔐 Secret Manager Alternative (Recommended)

Instead of storing secrets in terraform.tfvars, use a secret manager:

### AWS Secrets Manager

```hcl
# In terraform
data "aws_secretsmanager_secret_version" "db_password" {
  secret_id = "railgun/db_password"
}

resource "aws_db_instance" "main" {
  password = data.aws_secretsmanager_secret_version.db_password.secret_string
}
```

### HashiCorp Vault

```bash
# Store secrets
vault kv put secret/railgun \
  db_password="..." \
  jwt_secret="..." \
  recovery_code_secret="..." \
  dm_id_secret="..."

# Retrieve in app
vault kv get -field=jwt_secret secret/railgun
```

---

## 📋 Checklist

- [ ] Generated 4 new random secrets
- [ ] Updated terraform.tfvars (or environment variables)
- [ ] Applied terraform changes (or restarted services)
- [ ] Tested login functionality
- [ ] Tested database connectivity
- [ ] Tested encryption features
- [ ] Verified old secrets no longer work
- [ ] Documented where new secrets are stored
- [ ] Set reminder for next rotation (every 90 days)

---

## 🔄 Regular Rotation Schedule

**Recommendation:** Rotate secrets every 90 days

Set a recurring calendar reminder:
- Next rotation: **April 11, 2026**
- Following: **July 11, 2026**
- Following: **October 11, 2026**

---

## ⚠️ What NOT to Do

- ❌ Don't commit terraform.tfvars to git
- ❌ Don't share secrets in Slack/email/Discord
- ❌ Don't reuse old secrets
- ❌ Don't skip verification testing
- ❌ Don't forget to restart services

---

## 📞 Help

If you run into issues during rotation:

1. Check logs: `docker-compose logs api`
2. Verify environment variables are set correctly
3. Ensure database is accessible
4. Test with a fresh login
5. Check that JWT_SECRET matches between environments

---

*Created: January 11, 2026*
