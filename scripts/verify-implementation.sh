#!/bin/bash

# Multi-Device Implementation Verification Script
# Checks that all code changes compile and are ready for testing

set -e

echo "=========================================="
echo "Multi-Device Implementation Verification"
echo "=========================================="
echo ""

FAILED=0

# Function to check command exists
check_command() {
  if ! command -v $1 &> /dev/null; then
    echo "❌ $1 not found. Please install it first."
    return 1
  fi
  return 0
}

# Check required tools
echo "1. Checking required tools..."
check_command "pnpm" || exit 1
check_command "node" || exit 1
if ! check_command "tsc"; then
  echo "⚠️  Warning: tsc not found globally, but may be available via pnpm"
fi
echo "✅ Core tools available"
echo ""

# Check shared package
echo "2. Verifying shared package..."
cd packages/shared
if pnpm build > /dev/null 2>&1; then
  echo "✅ Shared package builds successfully"
else
  echo "❌ Shared package build failed"
  FAILED=1
fi
cd ../..
echo ""

# Check API service
echo "3. Verifying API service..."
cd services/api
if pnpm build > /dev/null 2>&1; then
  echo "✅ API service builds successfully"
else
  echo "❌ API service build failed"
  FAILED=1
fi

# Check for new migrations
echo ""
echo "Checking migrations..."
MIGRATION_COUNT=$(ls src/migrations/*AddPerDeviceEnvelopes*.ts 2>/dev/null | wc -l)
if [ $MIGRATION_COUNT -gt 0 ]; then
  echo "✅ Per-device envelopes migration found"
else
  echo "❌ Per-device envelopes migration not found"
  FAILED=1
fi

SENDER_KEY_MIGRATION=$(ls src/migrations/*AddRecipientDeviceIdToSenderKey*.ts 2>/dev/null | wc -l)
if [ $SENDER_KEY_MIGRATION -gt 0 ]; then
  echo "✅ Sender-key recipientDeviceId migration found"
else
  echo "❌ Sender-key recipientDeviceId migration not found"
  FAILED=1
fi

cd ../..
echo ""

# Check desktop app
echo "4. Verifying desktop app..."
cd apps/desktop
if pnpm typecheck > /dev/null 2>&1; then
  echo "✅ Desktop app type checks pass"
else
  echo "❌ Desktop app type check failed"
  FAILED=1
fi
cd ../..
echo ""

# Verify key files exist
echo "5. Verifying key implementation files..."

check_file() {
  if [ -f "$1" ]; then
    echo "✅ $1"
  else
    echo "❌ $1 not found"
    FAILED=1
  fi
}

# Shared files
check_file "packages/shared/src/types/messaging.types.ts"

# API files
check_file "services/api/src/messages/message-envelope.entity.ts"
check_file "services/api/src/migrations/1705500000000-AddPerDeviceEnvelopes.ts"
check_file "services/api/src/migrations/1705600000000-AddRecipientDeviceIdToSenderKey.ts"

# Desktop files
check_file "apps/desktop/src/crypto/types.ts"
check_file "apps/desktop/src/crypto/RailGunCrypto.ts"
check_file "apps/desktop/src/crypto/SimpleCrypto.ts"
check_file "apps/desktop/src/lib/messagingService.ts"

# iOS files
check_file "../railgun-ios/RailGun/Core/Crypto/CryptoManager.swift"
check_file "../railgun-ios/RailGun/Core/Chat/ChatManager.swift"
check_file "../railgun-ios/RailGun/Core/Network/APIClient.swift"

# Android files
check_file "../railgun-android/app/src/main/java/com/railgun/android/crypto/CryptoManager.kt"
check_file "../railgun-android/app/src/main/java/com/railgun/android/data/repository/DMRepository.kt"
check_file "../railgun-android/app/src/main/java/com/railgun/android/data/api/RailgunApi.kt"

# Test files
check_file "services/api/src/messages/messages.e2e.spec.ts"
check_file "scripts/test-migrations.sh"
check_file "docs/TESTING_GUIDE.md"

echo ""

# Verify AWS removal
echo "6. Verifying AWS removal..."
if [ -d "infra/terraform-aws-archive" ]; then
  echo "✅ AWS Terraform archived"
else
  echo "❌ AWS Terraform archive not found"
  FAILED=1
fi

if [ -f "infra/deploy.sh" ]; then
  echo "✅ New Fly.io deploy script exists"
else
  echo "❌ Fly.io deploy script not found"
  FAILED=1
fi

echo ""

# Check for protocol version
echo "7. Verifying protocol version..."
if grep -q "V2_PER_DEVICE_ENVELOPES = 2" packages/shared/src/enums.ts; then
  echo "✅ Protocol version bumped to 2"
else
  echo "❌ Protocol version not updated"
  FAILED=1
fi

echo ""

# Summary
echo "=========================================="
if [ $FAILED -eq 0 ]; then
  echo "✅ ALL CHECKS PASSED"
  echo "=========================================="
  echo ""
  echo "Next steps:"
  echo "1. Run: ./scripts/test-migrations.sh --confirm"
  echo "2. Run: cd services/api && pnpm test:e2e messages.e2e.spec.ts"
  echo "3. Follow: docs/TESTING_GUIDE.md for manual testing"
  echo "4. Deploy to staging for integration testing"
  echo ""
  exit 0
else
  echo "❌ SOME CHECKS FAILED"
  echo "=========================================="
  echo ""
  echo "Please review the errors above and fix them before proceeding."
  echo ""
  exit 1
fi
