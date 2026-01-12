# Railgun Node Mode - Storage Schema

**Version:** 1.0.0  
**Date:** January 12, 2026  
**Status:** Draft

---

## 1. Overview

This document defines the storage schemas for Node Mode across all platforms. The storage layer handles:

1. **Bundle Store** - Encrypted message bundles for relay and delivery
2. **Node Registry** - Known mesh peers and their properties
3. **Routing Tables** - Path information for message delivery
4. **Sync State** - Bloom filters and deduplication data
5. **Metrics** - Performance and health statistics

---

## 2. SQLite Schema (Mobile & Desktop)

### 2.1 Core Tables

```sql
-- ============================================================
-- BUNDLES TABLE
-- Stores message bundles for relay and local delivery
-- ============================================================
CREATE TABLE bundles (
    -- Primary key (UUID bytes as hex)
    id TEXT PRIMARY KEY NOT NULL,
    
    -- Bundle header fields
    version INTEGER NOT NULL DEFAULT 1,
    flags INTEGER NOT NULL DEFAULT 0,
    priority INTEGER NOT NULL DEFAULT 1,
    hop_count INTEGER NOT NULL DEFAULT 0,
    max_hops INTEGER NOT NULL DEFAULT 10,
    
    -- Timestamps (Unix milliseconds)
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    received_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
    
    -- Routing information
    source_node BLOB NOT NULL,              -- 32 bytes Ed25519 pubkey
    destination_type INTEGER NOT NULL,       -- 0=user, 1=node, 2=broadcast
    destination BLOB NOT NULL,               -- 32 bytes user_id or node_id
    geo_hash TEXT,                           -- Optional geohash hint
    
    -- Payload (encrypted)
    payload BLOB NOT NULL,
    payload_size INTEGER NOT NULL,
    
    -- Signature
    signature BLOB NOT NULL,                 -- 64 bytes Ed25519 signature
    
    -- Delivery state
    state INTEGER NOT NULL DEFAULT 0,        -- 0=pending, 1=delivered, 2=failed, 3=expired
    delivery_attempts INTEGER NOT NULL DEFAULT 0,
    last_attempt_at INTEGER,
    delivered_at INTEGER,
    delivered_to BLOB,                       -- Node that received final delivery
    
    -- Ownership
    is_own_message INTEGER NOT NULL DEFAULT 0,  -- 1 if destined for this user
    is_outgoing INTEGER NOT NULL DEFAULT 0,     -- 1 if created by this user
    
    -- Indexes for common queries
    CONSTRAINT valid_priority CHECK (priority BETWEEN 0 AND 3),
    CONSTRAINT valid_state CHECK (state BETWEEN 0 AND 3)
);

-- Indexes
CREATE INDEX idx_bundles_expires_at ON bundles(expires_at);
CREATE INDEX idx_bundles_destination ON bundles(destination_type, destination);
CREATE INDEX idx_bundles_state ON bundles(state);
CREATE INDEX idx_bundles_priority_created ON bundles(priority DESC, created_at ASC);
CREATE INDEX idx_bundles_source_node ON bundles(source_node);


-- ============================================================
-- NODES TABLE
-- Registry of known mesh peers
-- ============================================================
CREATE TABLE nodes (
    -- Primary key (Ed25519 pubkey as hex)
    node_id TEXT PRIMARY KEY NOT NULL,
    
    -- Optional user association
    user_id TEXT,
    
    -- Node capabilities bitmask
    -- Bit 0: CAN_RELAY
    -- Bit 1: CAN_STORE
    -- Bit 2: HAS_INTERNET
    -- Bit 3: HIGH_BANDWIDTH
    -- Bit 4: HIGH_STORAGE
    capabilities INTEGER NOT NULL DEFAULT 0,
    
    -- Discovery info
    first_seen INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
    last_seen INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
    times_seen INTEGER NOT NULL DEFAULT 1,
    
    -- Location (if known)
    last_geo_hash TEXT,
    last_geo_accuracy INTEGER,
    
    -- Reputation (0.0 to 1.0)
    reputation REAL NOT NULL DEFAULT 0.5,
    reputation_samples INTEGER NOT NULL DEFAULT 0,
    
    -- Statistics
    bundles_received_from INTEGER NOT NULL DEFAULT 0,
    bundles_sent_to INTEGER NOT NULL DEFAULT 0,
    bytes_received_from INTEGER NOT NULL DEFAULT 0,
    bytes_sent_to INTEGER NOT NULL DEFAULT 0,
    delivery_successes INTEGER NOT NULL DEFAULT 0,
    delivery_failures INTEGER NOT NULL DEFAULT 0,
    
    -- PROPHET routing data
    delivery_predictability REAL NOT NULL DEFAULT 0.0,
    predictability_updated_at INTEGER,
    
    -- Connection info
    last_connection_type TEXT,              -- 'ble', 'wifi_direct', 'lan'
    last_rssi INTEGER,
    
    CONSTRAINT valid_reputation CHECK (reputation BETWEEN 0.0 AND 1.0)
);

-- Indexes
CREATE INDEX idx_nodes_last_seen ON nodes(last_seen DESC);
CREATE INDEX idx_nodes_user_id ON nodes(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX idx_nodes_reputation ON nodes(reputation DESC);
CREATE INDEX idx_nodes_geo_hash ON nodes(last_geo_hash) WHERE last_geo_hash IS NOT NULL;


-- ============================================================
-- ROUTING_HINTS TABLE
-- Learned paths to destinations
-- ============================================================
CREATE TABLE routing_hints (
    -- Composite primary key
    destination BLOB NOT NULL,              -- User ID or Node ID
    destination_type INTEGER NOT NULL,      -- 0=user, 1=node
    next_hop TEXT NOT NULL,                 -- Node ID to forward to
    
    -- Path quality
    hops_away INTEGER NOT NULL,
    predictability REAL NOT NULL DEFAULT 0.0,
    last_updated INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
    
    -- Confidence in this route
    confidence REAL NOT NULL DEFAULT 0.5,
    times_used INTEGER NOT NULL DEFAULT 0,
    times_succeeded INTEGER NOT NULL DEFAULT 0,
    
    PRIMARY KEY (destination, destination_type, next_hop),
    FOREIGN KEY (next_hop) REFERENCES nodes(node_id) ON DELETE CASCADE
);

-- Indexes
CREATE INDEX idx_routing_destination ON routing_hints(destination, destination_type);
CREATE INDEX idx_routing_predictability ON routing_hints(predictability DESC);


-- ============================================================
-- BLOOM_FILTERS TABLE
-- Deduplication bloom filters
-- ============================================================
CREATE TABLE bloom_filters (
    -- Filter identifier
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    
    -- Filter type
    filter_type INTEGER NOT NULL,           -- 0=seen_bundles, 1=known_nodes
    
    -- Serialized bloom filter
    filter_data BLOB NOT NULL,
    
    -- Metadata
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
    entry_count INTEGER NOT NULL DEFAULT 0,
    false_positive_rate REAL NOT NULL,
    bit_count INTEGER NOT NULL,
    hash_count INTEGER NOT NULL,
    
    -- Rotation
    is_active INTEGER NOT NULL DEFAULT 1,
    expires_at INTEGER
);

-- Index
CREATE INDEX idx_bloom_active ON bloom_filters(filter_type, is_active);


-- ============================================================
-- SYNC_STATE TABLE
-- Per-peer synchronization state
-- ============================================================
CREATE TABLE sync_state (
    -- Peer node ID
    node_id TEXT PRIMARY KEY NOT NULL,
    
    -- Last sync times
    last_sync_started INTEGER,
    last_sync_completed INTEGER,
    last_full_sync INTEGER,
    
    -- Sync progress
    bundles_sent INTEGER NOT NULL DEFAULT 0,
    bundles_received INTEGER NOT NULL DEFAULT 0,
    bytes_sent INTEGER NOT NULL DEFAULT 0,
    bytes_received INTEGER NOT NULL DEFAULT 0,
    
    -- Their bloom filter (cached)
    their_bloom_filter BLOB,
    their_bloom_filter_updated INTEGER,
    
    -- Our position in their bundle list
    our_cursor TEXT,
    
    FOREIGN KEY (node_id) REFERENCES nodes(node_id) ON DELETE CASCADE
);


-- ============================================================
-- PENDING_ACKS TABLE
-- Delivery acknowledgments waiting to be sent
-- ============================================================
CREATE TABLE pending_acks (
    bundle_id TEXT PRIMARY KEY NOT NULL,
    destination_node BLOB NOT NULL,          -- Node to send ACK to (original sender)
    delivered_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
    attempts INTEGER NOT NULL DEFAULT 0,
    last_attempt INTEGER,
    
    FOREIGN KEY (bundle_id) REFERENCES bundles(id) ON DELETE CASCADE
);

-- Index
CREATE INDEX idx_pending_acks_created ON pending_acks(created_at);


-- ============================================================
-- METRICS TABLE
-- Time-series metrics for monitoring
-- ============================================================
CREATE TABLE metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    
    -- Time bucket (hourly)
    bucket_start INTEGER NOT NULL,
    bucket_end INTEGER NOT NULL,
    
    -- Network metrics
    peers_discovered INTEGER NOT NULL DEFAULT 0,
    peers_connected INTEGER NOT NULL DEFAULT 0,
    connections_initiated INTEGER NOT NULL DEFAULT 0,
    connections_received INTEGER NOT NULL DEFAULT 0,
    connection_failures INTEGER NOT NULL DEFAULT 0,
    
    -- Bundle metrics
    bundles_created INTEGER NOT NULL DEFAULT 0,
    bundles_received INTEGER NOT NULL DEFAULT 0,
    bundles_relayed INTEGER NOT NULL DEFAULT 0,
    bundles_delivered INTEGER NOT NULL DEFAULT 0,
    bundles_expired INTEGER NOT NULL DEFAULT 0,
    bundles_rejected INTEGER NOT NULL DEFAULT 0,
    
    -- Transfer metrics
    bytes_sent INTEGER NOT NULL DEFAULT 0,
    bytes_received INTEGER NOT NULL DEFAULT 0,
    
    -- Routing metrics
    avg_hop_count REAL,
    avg_delivery_time_ms REAL,
    delivery_success_rate REAL,
    
    UNIQUE(bucket_start)
);

-- Index
CREATE INDEX idx_metrics_bucket ON metrics(bucket_start DESC);


-- ============================================================
-- CONFIG TABLE
-- Node mode configuration
-- ============================================================
CREATE TABLE config (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
);

-- Default configuration
INSERT OR IGNORE INTO config (key, value) VALUES
    ('node_id', ''),
    ('node_private_key', ''),
    ('device_id', '0'),
    ('registration_id', '0'),
    ('capabilities', '7'),  -- CAN_RELAY | CAN_STORE | HAS_INTERNET
    ('max_storage_bytes', '104857600'),  -- 100MB
    ('default_ttl_hours', '72'),
    ('max_hops', '10'),
    ('routing_algorithm', 'automatic'),
    ('onion_routing_enabled', 'false'),
    ('low_power_mode', 'false'),
    ('initialized_at', '0');
```

### 2.2 Views

```sql
-- Active bundles (not expired or delivered)
CREATE VIEW active_bundles AS
SELECT * FROM bundles
WHERE state = 0
  AND expires_at > (strftime('%s', 'now') * 1000);

-- Own pending messages (to be delivered to this user)
CREATE VIEW own_pending_messages AS
SELECT * FROM bundles
WHERE is_own_message = 1
  AND state = 0;

-- Relay queue (messages to forward)
CREATE VIEW relay_queue AS
SELECT * FROM bundles
WHERE is_own_message = 0
  AND is_outgoing = 0
  AND state = 0
  AND expires_at > (strftime('%s', 'now') * 1000)
ORDER BY priority DESC, created_at ASC;

-- Recently active nodes
CREATE VIEW active_nodes AS
SELECT * FROM nodes
WHERE last_seen > (strftime('%s', 'now') * 1000 - 3600000)  -- Last hour
ORDER BY last_seen DESC;

-- High reputation nodes (for routing)
CREATE VIEW trusted_nodes AS
SELECT * FROM nodes
WHERE reputation >= 0.5
ORDER BY reputation DESC;
```

### 2.3 Triggers

```sql
-- Auto-update node statistics on bundle operations
CREATE TRIGGER update_node_stats_on_receive
AFTER INSERT ON bundles
FOR EACH ROW
BEGIN
    UPDATE nodes
    SET bundles_received_from = bundles_received_from + 1,
        bytes_received_from = bytes_received_from + NEW.payload_size,
        last_seen = NEW.received_at
    WHERE node_id = hex(NEW.source_node);
END;

-- Auto-expire old bundles
CREATE TRIGGER expire_old_bundles
AFTER INSERT ON bundles
BEGIN
    UPDATE bundles
    SET state = 3  -- expired
    WHERE expires_at < (strftime('%s', 'now') * 1000)
      AND state = 0;
END;

-- Cascade node deletion to routing hints and sync state
CREATE TRIGGER cascade_node_delete
BEFORE DELETE ON nodes
FOR EACH ROW
BEGIN
    DELETE FROM routing_hints WHERE next_hop = OLD.node_id;
    DELETE FROM sync_state WHERE node_id = OLD.node_id;
END;
```

---

## 3. Platform-Specific Implementations

### 3.1 iOS (Swift + GRDB)

```swift
import GRDB

// MARK: - Database Models

struct Bundle: Codable, FetchableRecord, PersistableRecord {
    static let databaseTableName = "bundles"
    
    let id: String
    var version: Int
    var flags: Int
    var priority: Int
    var hopCount: Int
    var maxHops: Int
    var createdAt: Int64
    var expiresAt: Int64
    var receivedAt: Int64
    var sourceNode: Data
    var destinationType: Int
    var destination: Data
    var geoHash: String?
    var payload: Data
    var payloadSize: Int
    var signature: Data
    var state: BundleState
    var deliveryAttempts: Int
    var lastAttemptAt: Int64?
    var deliveredAt: Int64?
    var deliveredTo: Data?
    var isOwnMessage: Bool
    var isOutgoing: Bool
    
    enum BundleState: Int, Codable, DatabaseValueConvertible {
        case pending = 0
        case delivered = 1
        case failed = 2
        case expired = 3
    }
}

struct Node: Codable, FetchableRecord, PersistableRecord {
    static let databaseTableName = "nodes"
    
    let nodeId: String
    var userId: String?
    var capabilities: Int
    var firstSeen: Int64
    var lastSeen: Int64
    var timesSeen: Int
    var lastGeoHash: String?
    var lastGeoAccuracy: Int?
    var reputation: Double
    var reputationSamples: Int
    var bundlesReceivedFrom: Int
    var bundlesSentTo: Int
    var bytesReceivedFrom: Int
    var bytesSentTo: Int
    var deliverySuccesses: Int
    var deliveryFailures: Int
    var deliveryPredictability: Double
    var predictabilityUpdatedAt: Int64?
    var lastConnectionType: String?
    var lastRssi: Int?
}

// MARK: - Database Manager

class NodeModeDatabase {
    static let shared = NodeModeDatabase()
    
    private var dbQueue: DatabaseQueue!
    
    func setup() throws {
        let databasePath = try FileManager.default
            .url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
            .appendingPathComponent("nodemode.db")
            .path
        
        dbQueue = try DatabaseQueue(path: databasePath)
        
        try migrator.migrate(dbQueue)
    }
    
    private var migrator: DatabaseMigrator {
        var migrator = DatabaseMigrator()
        
        migrator.registerMigration("v1") { db in
            // Create all tables from schema
            try db.execute(sql: Self.schemaSQL)
        }
        
        return migrator
    }
    
    // MARK: - Bundle Operations
    
    func storeBundle(_ bundle: Bundle) throws {
        try dbQueue.write { db in
            try bundle.insert(db)
        }
    }
    
    func getBundle(id: String) throws -> Bundle? {
        try dbQueue.read { db in
            try Bundle.fetchOne(db, key: id)
        }
    }
    
    func getRelayQueue(limit: Int) throws -> [Bundle] {
        try dbQueue.read { db in
            try Bundle
                .filter(Column("is_own_message") == false)
                .filter(Column("state") == BundleState.pending.rawValue)
                .filter(Column("expires_at") > Date().timeIntervalSince1970 * 1000)
                .order(Column("priority").desc, Column("created_at").asc)
                .limit(limit)
                .fetchAll(db)
        }
    }
    
    func markDelivered(bundleId: String, toNode: Data) throws {
        try dbQueue.write { db in
            try db.execute(
                sql: """
                UPDATE bundles
                SET state = ?, delivered_at = ?, delivered_to = ?
                WHERE id = ?
                """,
                arguments: [BundleState.delivered.rawValue, Date().timeIntervalSince1970 * 1000, toNode, bundleId]
            )
        }
    }
    
    func expireOldBundles() throws -> Int {
        try dbQueue.write { db in
            try db.execute(
                sql: """
                UPDATE bundles
                SET state = ?
                WHERE state = ? AND expires_at < ?
                """,
                arguments: [BundleState.expired.rawValue, BundleState.pending.rawValue, Date().timeIntervalSince1970 * 1000]
            )
            return db.changesCount
        }
    }
    
    // MARK: - Node Operations
    
    func upsertNode(_ node: Node) throws {
        try dbQueue.write { db in
            try node.save(db)
        }
    }
    
    func getNode(id: String) throws -> Node? {
        try dbQueue.read { db in
            try Node.fetchOne(db, key: id)
        }
    }
    
    func getActiveNodes() throws -> [Node] {
        try dbQueue.read { db in
            let oneHourAgo = (Date().timeIntervalSince1970 - 3600) * 1000
            return try Node
                .filter(Column("last_seen") > oneHourAgo)
                .order(Column("last_seen").desc)
                .fetchAll(db)
        }
    }
    
    // MARK: - Storage Stats
    
    func getStorageStats() throws -> (bundleCount: Int, totalBytes: Int) {
        try dbQueue.read { db in
            let count = try Bundle.fetchCount(db)
            let bytes = try Int.fetchOne(db, sql: "SELECT COALESCE(SUM(payload_size), 0) FROM bundles") ?? 0
            return (count, bytes)
        }
    }
}
```

### 3.2 Android (Kotlin + Room)

```kotlin
package com.railgun.android.nodemode.data

import androidx.room.*
import kotlinx.coroutines.flow.Flow

// MARK: - Entities

@Entity(tableName = "bundles")
data class BundleEntity(
    @PrimaryKey
    val id: String,
    val version: Int,
    val flags: Int,
    val priority: Int,
    val hopCount: Int,
    val maxHops: Int,
    val createdAt: Long,
    val expiresAt: Long,
    val receivedAt: Long,
    val sourceNode: ByteArray,
    val destinationType: Int,
    val destination: ByteArray,
    val geoHash: String?,
    val payload: ByteArray,
    val payloadSize: Int,
    val signature: ByteArray,
    val state: Int = 0,
    val deliveryAttempts: Int = 0,
    val lastAttemptAt: Long? = null,
    val deliveredAt: Long? = null,
    val deliveredTo: ByteArray? = null,
    val isOwnMessage: Boolean = false,
    val isOutgoing: Boolean = false
)

@Entity(tableName = "nodes")
data class NodeEntity(
    @PrimaryKey
    val nodeId: String,
    val userId: String? = null,
    val capabilities: Int = 0,
    val firstSeen: Long,
    val lastSeen: Long,
    val timesSeen: Int = 1,
    val lastGeoHash: String? = null,
    val lastGeoAccuracy: Int? = null,
    val reputation: Double = 0.5,
    val reputationSamples: Int = 0,
    val bundlesReceivedFrom: Int = 0,
    val bundlesSentTo: Int = 0,
    val bytesReceivedFrom: Long = 0,
    val bytesSentTo: Long = 0,
    val deliverySuccesses: Int = 0,
    val deliveryFailures: Int = 0,
    val deliveryPredictability: Double = 0.0,
    val predictabilityUpdatedAt: Long? = null,
    val lastConnectionType: String? = null,
    val lastRssi: Int? = null
)

@Entity(
    tableName = "routing_hints",
    primaryKeys = ["destination", "destinationType", "nextHop"]
)
data class RoutingHintEntity(
    val destination: ByteArray,
    val destinationType: Int,
    val nextHop: String,
    val hopsAway: Int,
    val predictability: Double = 0.0,
    val lastUpdated: Long,
    val confidence: Double = 0.5,
    val timesUsed: Int = 0,
    val timesSucceeded: Int = 0
)

// MARK: - DAOs

@Dao
interface BundleDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(bundle: BundleEntity)
    
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertAll(bundles: List<BundleEntity>)
    
    @Query("SELECT * FROM bundles WHERE id = :id")
    suspend fun getById(id: String): BundleEntity?
    
    @Query("""
        SELECT * FROM bundles
        WHERE isOwnMessage = 0
          AND state = 0
          AND expiresAt > :now
        ORDER BY priority DESC, createdAt ASC
        LIMIT :limit
    """)
    suspend fun getRelayQueue(now: Long, limit: Int): List<BundleEntity>
    
    @Query("""
        SELECT * FROM bundles
        WHERE isOwnMessage = 1
          AND state = 0
        ORDER BY createdAt DESC
    """)
    fun getOwnPendingMessages(): Flow<List<BundleEntity>>
    
    @Query("""
        UPDATE bundles
        SET state = 1, deliveredAt = :deliveredAt, deliveredTo = :deliveredTo
        WHERE id = :bundleId
    """)
    suspend fun markDelivered(bundleId: String, deliveredAt: Long, deliveredTo: ByteArray)
    
    @Query("""
        UPDATE bundles
        SET state = 3
        WHERE state = 0 AND expiresAt < :now
    """)
    suspend fun expireOldBundles(now: Long): Int
    
    @Query("SELECT COUNT(*) FROM bundles")
    suspend fun getBundleCount(): Int
    
    @Query("SELECT COALESCE(SUM(payloadSize), 0) FROM bundles")
    suspend fun getTotalStorageBytes(): Long
    
    @Query("DELETE FROM bundles WHERE state IN (1, 2, 3) AND createdAt < :before")
    suspend fun deleteOldBundles(before: Long): Int
}

@Dao
interface NodeDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(node: NodeEntity)
    
    @Query("SELECT * FROM nodes WHERE nodeId = :nodeId")
    suspend fun getById(nodeId: String): NodeEntity?
    
    @Query("SELECT * FROM nodes WHERE lastSeen > :since ORDER BY lastSeen DESC")
    fun getActiveNodes(since: Long): Flow<List<NodeEntity>>
    
    @Query("SELECT * FROM nodes WHERE reputation >= :minReputation ORDER BY reputation DESC")
    suspend fun getTrustedNodes(minReputation: Double = 0.5): List<NodeEntity>
    
    @Query("""
        UPDATE nodes
        SET bundlesReceivedFrom = bundlesReceivedFrom + 1,
            bytesReceivedFrom = bytesReceivedFrom + :bytes,
            lastSeen = :lastSeen,
            timesSeen = timesSeen + 1
        WHERE nodeId = :nodeId
    """)
    suspend fun recordBundleReceived(nodeId: String, bytes: Long, lastSeen: Long)
    
    @Query("""
        UPDATE nodes
        SET reputation = :reputation,
            reputationSamples = reputationSamples + 1
        WHERE nodeId = :nodeId
    """)
    suspend fun updateReputation(nodeId: String, reputation: Double)
}

@Dao
interface RoutingDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(hint: RoutingHintEntity)
    
    @Query("""
        SELECT * FROM routing_hints
        WHERE destination = :destination AND destinationType = :type
        ORDER BY predictability DESC
        LIMIT :limit
    """)
    suspend fun getRoutesTo(destination: ByteArray, type: Int, limit: Int = 5): List<RoutingHintEntity>
    
    @Query("""
        UPDATE routing_hints
        SET timesUsed = timesUsed + 1,
            timesSucceeded = timesSucceeded + :success
        WHERE destination = :destination AND nextHop = :nextHop
    """)
    suspend fun recordRouteUsage(destination: ByteArray, nextHop: String, success: Int)
}

// MARK: - Database

@Database(
    entities = [
        BundleEntity::class,
        NodeEntity::class,
        RoutingHintEntity::class
    ],
    version = 1,
    exportSchema = true
)
@TypeConverters(Converters::class)
abstract class NodeModeDatabase : RoomDatabase() {
    abstract fun bundleDao(): BundleDao
    abstract fun nodeDao(): NodeDao
    abstract fun routingDao(): RoutingDao
    
    companion object {
        @Volatile
        private var INSTANCE: NodeModeDatabase? = null
        
        fun getInstance(context: Context): NodeModeDatabase {
            return INSTANCE ?: synchronized(this) {
                val instance = Room.databaseBuilder(
                    context.applicationContext,
                    NodeModeDatabase::class.java,
                    "nodemode.db"
                )
                    .addMigrations()
                    .build()
                INSTANCE = instance
                instance
            }
        }
    }
}

class Converters {
    @TypeConverter
    fun fromByteArray(value: ByteArray?): String? {
        return value?.let { Base64.encodeToString(it, Base64.NO_WRAP) }
    }
    
    @TypeConverter
    fun toByteArray(value: String?): ByteArray? {
        return value?.let { Base64.decode(it, Base64.NO_WRAP) }
    }
}
```

---

## 4. Storage Limits and Cleanup

### 4.1 Default Limits

| Resource | Limit | Configurable |
|----------|-------|--------------|
| Total bundle storage | 100 MB | Yes |
| Max bundles | 10,000 | Yes |
| Max bundle size | 64 KB | Yes |
| Bloom filter memory | 1 MB | No |
| Routing table entries | 10,000 | No |
| Metrics retention | 7 days | Yes |

### 4.2 Cleanup Policy

```sql
-- Daily cleanup job

-- 1. Expire old bundles
UPDATE bundles
SET state = 3
WHERE state = 0 AND expires_at < (strftime('%s', 'now') * 1000);

-- 2. Delete delivered/expired bundles older than 24h
DELETE FROM bundles
WHERE state IN (1, 2, 3)
  AND created_at < (strftime('%s', 'now') * 1000 - 86400000);

-- 3. Prune stale nodes (not seen in 30 days)
DELETE FROM nodes
WHERE last_seen < (strftime('%s', 'now') * 1000 - 2592000000);

-- 4. Rotate bloom filters (keep last 2)
DELETE FROM bloom_filters
WHERE is_active = 0
  AND id NOT IN (
    SELECT id FROM bloom_filters
    WHERE is_active = 0
    ORDER BY created_at DESC
    LIMIT 2
  );

-- 5. Delete old metrics (keep 7 days)
DELETE FROM metrics
WHERE bucket_start < (strftime('%s', 'now') * 1000 - 604800000);
```

### 4.3 Storage Pressure Handling

```swift
func handleStoragePressure() async throws {
    let (count, bytes) = try database.getStorageStats()
    let maxBytes = config.maxStorageBytes
    
    // If over 90% capacity, start eviction
    if bytes > maxBytes * 9 / 10 {
        // Evict lowest priority, oldest bundles
        try await database.evictBundles(
            targetBytes: maxBytes * 7 / 10,  // Get down to 70%
            priorityOrder: [.bulk, .normal],  // Keep urgent/critical
            preserveOwn: true  // Never evict own messages
        )
    }
}
```

---

## 5. Encryption at Rest

### 5.1 iOS (Data Protection + SQLCipher optional)

```swift
// Use iOS Data Protection
let databasePath = try FileManager.default
    .url(for: .applicationSupportDirectory, ...)
    
// Set file protection
try FileManager.default.setAttributes(
    [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication],
    ofItemAtPath: databasePath.path
)
```

### 5.2 Android (SQLCipher)

```kotlin
// Use SQLCipher for encryption
val passphrase = getOrCreateDatabaseKey()

Room.databaseBuilder(context, NodeModeDatabase::class.java, "nodemode.db")
    .openHelperFactory(SupportFactory(passphrase))
    .build()

private fun getOrCreateDatabaseKey(): ByteArray {
    val keyStore = KeyStore.getInstance("AndroidKeyStore")
    keyStore.load(null)
    
    // Generate or retrieve AES key from Android Keystore
    // Use it to encrypt/decrypt SQLCipher passphrase
}
```

---

## 6. Backup and Migration

### 6.1 Export Format

```json
{
  "version": 1,
  "exportedAt": 1736668850000,
  "nodeId": "base64...",
  "config": { ... },
  "bundles": [ ... ],
  "nodes": [ ... ]
}
```

### 6.2 Migration Strategy

```swift
// Version upgrades
migrator.registerMigration("v1_to_v2") { db in
    // Add new columns
    try db.alter(table: "bundles") { t in
        t.add(column: "new_field", .integer).defaults(to: 0)
    }
}
```
