#!/bin/bash

# Migration Testing Script for Multi-Device Updates
# Run this on a staging/test database before production deployment

set -e

echo "=========================================="
echo "Multi-Device Migration Testing"
echo "=========================================="
echo ""

# Check if running in test mode
if [ "$1" != "--confirm" ]; then
  echo "⚠️  WARNING: This script will modify your database!"
  echo ""
  echo "Please ensure you are running this on a staging/test database."
  echo "DO NOT run this on production without testing first."
  echo ""
  echo "To proceed, run: $0 --confirm"
  exit 1
fi

# Load environment
if [ -f .env.test ]; then
  echo "Loading test environment..."
  export $(cat .env.test | grep -v '^#' | xargs)
else
  echo "❌ Error: .env.test not found"
  exit 1
fi

echo "Database: ${DB_NAME}"
echo "Host: ${DB_HOST}"
echo ""

# Backup database
echo "1. Creating backup..."
BACKUP_FILE="backup_$(date +%Y%m%d_%H%M%S).sql"
pg_dump -h "${DB_HOST}" -U "${DB_USER}" -d "${DB_NAME}" > "$BACKUP_FILE"
echo "✅ Backup created: $BACKUP_FILE"
echo ""

# Run migrations
echo "2. Running migrations..."
cd services/api
pnpm run migration:run
echo "✅ Migrations completed"
echo ""

# Verify schema changes
echo "3. Verifying schema changes..."

# Check message_envelopes table
echo "Checking message_envelopes table..."
psql -h "${DB_HOST}" -U "${DB_USER}" -d "${DB_NAME}" -c "\d message_envelopes" > /dev/null 2>&1
if [ $? -eq 0 ]; then
  echo "✅ message_envelopes table exists"
  
  # Verify columns
  COLUMNS=$(psql -h "${DB_HOST}" -U "${DB_USER}" -d "${DB_NAME}" -t -c "SELECT column_name FROM information_schema.columns WHERE table_name='message_envelopes';")
  
  if echo "$COLUMNS" | grep -q "recipientDeviceId"; then
    echo "✅ recipientDeviceId column exists"
  else
    echo "❌ recipientDeviceId column missing"
    exit 1
  fi
else
  echo "❌ message_envelopes table not found"
  exit 1
fi

# Check sender_key_distribution recipientDeviceId
echo ""
echo "Checking sender_key_distribution table..."
psql -h "${DB_HOST}" -U "${DB_USER}" -d "${DB_NAME}" -c "\d sender_key_distribution" > /dev/null 2>&1
if [ $? -eq 0 ]; then
  echo "✅ sender_key_distribution table exists"
  
  COLUMNS=$(psql -h "${DB_HOST}" -U "${DB_USER}" -d "${DB_NAME}" -t -c "SELECT column_name FROM information_schema.columns WHERE table_name='sender_key_distribution';")
  
  if echo "$COLUMNS" | grep -q "recipientDeviceId"; then
    echo "✅ recipientDeviceId column exists"
  else
    echo "❌ recipientDeviceId column missing"
    exit 1
  fi
else
  echo "❌ sender_key_distribution table not found"
  exit 1
fi

echo ""
echo "4. Testing data operations..."

# Insert test data
echo "Inserting test message envelope..."
TEST_MESSAGE_ID=$(uuidgen)
TEST_USER_ID=$(uuidgen)

psql -h "${DB_HOST}" -U "${DB_USER}" -d "${DB_NAME}" << EOF
-- Create test message
INSERT INTO message (id, "senderId", "recipientId", "conversationId", content, "encryptedEnvelope", "createdAt", "updatedAt")
VALUES ('${TEST_MESSAGE_ID}', '${TEST_USER_ID}', '${TEST_USER_ID}', 'test-conv', 'Test', '{}', NOW(), NOW());

-- Create test envelopes
INSERT INTO message_envelopes ("messageId", "recipientUserId", "recipientDeviceId", "encryptedEnvelope", delivered)
VALUES 
  ('${TEST_MESSAGE_ID}', '${TEST_USER_ID}', 1, 'envelope1', false),
  ('${TEST_MESSAGE_ID}', '${TEST_USER_ID}', 2, 'envelope2', false);
EOF

if [ $? -eq 0 ]; then
  echo "✅ Test data inserted successfully"
else
  echo "❌ Failed to insert test data"
  exit 1
fi

# Query test data
echo "Querying test data..."
ENVELOPE_COUNT=$(psql -h "${DB_HOST}" -U "${DB_USER}" -d "${DB_NAME}" -t -c "SELECT COUNT(*) FROM message_envelopes WHERE \"messageId\" = '${TEST_MESSAGE_ID}';")

if [ "$ENVELOPE_COUNT" -eq 2 ]; then
  echo "✅ Found 2 envelopes as expected"
else
  echo "❌ Expected 2 envelopes, found ${ENVELOPE_COUNT}"
  exit 1
fi

# Clean up test data
echo "Cleaning up test data..."
psql -h "${DB_HOST}" -U "${DB_USER}" -d "${DB_NAME}" << EOF
DELETE FROM message_envelopes WHERE "messageId" = '${TEST_MESSAGE_ID}';
DELETE FROM message WHERE id = '${TEST_MESSAGE_ID}';
EOF

echo "✅ Test data cleaned up"
echo ""

# Check indexes
echo "5. Verifying indexes..."
INDEXES=$(psql -h "${DB_HOST}" -U "${DB_USER}" -d "${DB_NAME}" -t -c "SELECT indexname FROM pg_indexes WHERE tablename = 'message_envelopes';")

if echo "$INDEXES" | grep -q "message_envelopes"; then
  echo "✅ Indexes created on message_envelopes"
else
  echo "⚠️  Warning: No indexes found on message_envelopes"
fi

SENDER_KEY_INDEXES=$(psql -h "${DB_HOST}" -U "${DB_USER}" -d "${DB_NAME}" -t -c "SELECT indexname FROM pg_indexes WHERE tablename = 'sender_key_distribution' AND indexname LIKE '%recipient_device%';")

if echo "$SENDER_KEY_INDEXES" | grep -q "recipient_device"; then
  echo "✅ Indexes created on sender_key_distribution"
else
  echo "⚠️  Warning: No recipient_device index found on sender_key_distribution"
fi

echo ""
echo "=========================================="
echo "✅ Migration Testing Complete!"
echo "=========================================="
echo ""
echo "Summary:"
echo "- Backup created: $BACKUP_FILE"
echo "- message_envelopes table created with recipientDeviceId"
echo "- sender_key_distribution table updated with recipientDeviceId"
echo "- Data operations tested successfully"
echo ""
echo "Next steps:"
echo "1. Review the backup file: $BACKUP_FILE"
echo "2. Test application functionality"
echo "3. If successful, apply to production with same process"
echo ""
