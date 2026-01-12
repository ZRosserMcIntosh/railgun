package com.railgun.android.nodemode.data

import androidx.room.*
import kotlinx.coroutines.flow.Flow
import java.util.UUID

// MARK: - Bundle Entity

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
    
    @ColumnInfo(typeAffinity = ColumnInfo.BLOB)
    val sourceNode: ByteArray,
    
    val destinationType: Int,
    
    @ColumnInfo(typeAffinity = ColumnInfo.BLOB)
    val destination: ByteArray,
    
    val geoHash: String?,
    
    @ColumnInfo(typeAffinity = ColumnInfo.BLOB)
    val payload: ByteArray,
    
    val payloadSize: Int,
    
    @ColumnInfo(typeAffinity = ColumnInfo.BLOB)
    val signature: ByteArray,
    
    val state: Int = 0,
    val deliveryAttempts: Int = 0,
    val lastAttemptAt: Long? = null,
    val deliveredAt: Long? = null,
    
    @ColumnInfo(typeAffinity = ColumnInfo.BLOB)
    val deliveredTo: ByteArray? = null,
    
    val isOwnMessage: Boolean = false,
    val isOutgoing: Boolean = false
) {
    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (other !is BundleEntity) return false
        return id == other.id
    }
    
    override fun hashCode(): Int = id.hashCode()
}

// MARK: - Node Entity

@Entity(tableName = "nodes")
data class NodeEntity(
    @PrimaryKey
    val nodeId: String,
    
    val userId: String? = null,
    val displayName: String? = null,
    val capabilities: Int = 3, // CAN_RELAY | CAN_STORE
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

// MARK: - Routing Hint Entity

@Entity(
    tableName = "routing_hints",
    primaryKeys = ["destination", "destinationType", "nextHop"]
)
data class RoutingHintEntity(
    @ColumnInfo(typeAffinity = ColumnInfo.BLOB)
    val destination: ByteArray,
    
    val destinationType: Int,
    val nextHop: String,
    val hopsAway: Int,
    val predictability: Double = 0.0,
    val lastUpdated: Long,
    val confidence: Double = 0.5,
    val timesUsed: Int = 0,
    val timesSucceeded: Int = 0
) {
    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (other !is RoutingHintEntity) return false
        return destination.contentEquals(other.destination) &&
               destinationType == other.destinationType &&
               nextHop == other.nextHop
    }
    
    override fun hashCode(): Int {
        var result = destination.contentHashCode()
        result = 31 * result + destinationType
        result = 31 * result + nextHop.hashCode()
        return result
    }
}

// MARK: - Bloom State Entity

@Entity(tableName = "bloom_state")
data class BloomStateEntity(
    @PrimaryKey
    val id: Int = 1,
    
    @ColumnInfo(typeAffinity = ColumnInfo.BLOB)
    val filterData: ByteArray,
    
    val entryCount: Int = 0,
    val createdAt: Long,
    val bitCount: Int,
    val hashCount: Int
) {
    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (other !is BloomStateEntity) return false
        return id == other.id
    }
    
    override fun hashCode(): Int = id
}

// MARK: - Metrics Entity

@Entity(tableName = "metrics")
data class MetricsEntity(
    @PrimaryKey(autoGenerate = true)
    val id: Long = 0,
    
    @ColumnInfo(index = true)
    val bucketStart: Long,
    
    val bucketEnd: Long,
    val peersDiscovered: Int = 0,
    val peersConnected: Int = 0,
    val bundlesCreated: Int = 0,
    val bundlesReceived: Int = 0,
    val bundlesRelayed: Int = 0,
    val bundlesDelivered: Int = 0,
    val bundlesExpired: Int = 0,
    val bytesSent: Long = 0,
    val bytesReceived: Long = 0
)

// MARK: - Bundle DAO

@Dao
interface BundleDao {
    
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(bundle: BundleEntity)
    
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertAll(bundles: List<BundleEntity>)
    
    @Query("SELECT * FROM bundles WHERE id = :id")
    suspend fun getById(id: String): BundleEntity?
    
    @Query("SELECT EXISTS(SELECT 1 FROM bundles WHERE id = :id)")
    suspend fun exists(id: String): Boolean
    
    @Query("""
        SELECT * FROM bundles
        WHERE isOwnMessage = 0 AND state = 0 AND expiresAt > :now
        ORDER BY priority DESC, createdAt ASC
        LIMIT :limit
    """)
    suspend fun getRelayQueue(now: Long, limit: Int): List<BundleEntity>
    
    @Query("SELECT * FROM bundles WHERE isOwnMessage = 1 AND state = 0 ORDER BY createdAt DESC")
    fun getOwnPendingMessages(): Flow<List<BundleEntity>>
    
    @Query("SELECT * FROM bundles WHERE isOutgoing = 1 AND state = 0 ORDER BY createdAt DESC")
    suspend fun getOutgoingPending(): List<BundleEntity>
    
    @Query("""
        UPDATE bundles
        SET state = 1, deliveredAt = :deliveredAt, deliveredTo = :deliveredTo
        WHERE id = :bundleId
    """)
    suspend fun markDelivered(bundleId: String, deliveredAt: Long, deliveredTo: ByteArray)
    
    @Query("UPDATE bundles SET state = 3 WHERE state = 0 AND expiresAt < :now")
    suspend fun expireOldBundles(now: Long): Int
    
    @Query("UPDATE bundles SET hopCount = :hopCount WHERE id = :bundleId")
    suspend fun updateHopCount(bundleId: String, hopCount: Int)
    
    @Query("SELECT COUNT(*) FROM bundles")
    suspend fun getBundleCount(): Int
    
    @Query("SELECT COALESCE(SUM(payloadSize), 0) FROM bundles")
    suspend fun getTotalStorageBytes(): Long
    
    @Query("SELECT id FROM bundles WHERE state = 0")
    suspend fun getAllActiveBundleIds(): List<String>
    
    @Query("DELETE FROM bundles WHERE state IN (1, 2, 3) AND createdAt < :before")
    suspend fun deleteOldBundles(before: Long): Int
    
    @Delete
    suspend fun delete(bundle: BundleEntity)
    
    @Query("DELETE FROM bundles WHERE id = :id")
    suspend fun deleteById(id: String)
}

// MARK: - Node DAO

@Dao
interface NodeDao {
    
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(node: NodeEntity)
    
    @Query("SELECT * FROM nodes WHERE nodeId = :nodeId")
    suspend fun getById(nodeId: String): NodeEntity?
    
    @Query("SELECT * FROM nodes WHERE lastSeen > :since ORDER BY lastSeen DESC")
    fun getActiveNodes(since: Long): Flow<List<NodeEntity>>
    
    @Query("SELECT * FROM nodes WHERE lastSeen > :since ORDER BY lastSeen DESC")
    suspend fun getActiveNodesList(since: Long): List<NodeEntity>
    
    @Query("SELECT * FROM nodes WHERE reputation >= :minReputation ORDER BY reputation DESC")
    suspend fun getTrustedNodes(minReputation: Double = 0.5): List<NodeEntity>
    
    @Query("SELECT * FROM nodes ORDER BY lastSeen DESC")
    suspend fun getAllNodes(): List<NodeEntity>
    
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
        SET bundlesSentTo = bundlesSentTo + 1,
            bytesSentTo = bytesSentTo + :bytes
        WHERE nodeId = :nodeId
    """)
    suspend fun recordBundleSent(nodeId: String, bytes: Long)
    
    @Query("UPDATE nodes SET reputation = :reputation, reputationSamples = reputationSamples + 1 WHERE nodeId = :nodeId")
    suspend fun updateReputation(nodeId: String, reputation: Double)
    
    @Query("UPDATE nodes SET deliveryPredictability = :predictability, predictabilityUpdatedAt = :updatedAt WHERE nodeId = :nodeId")
    suspend fun updatePredictability(nodeId: String, predictability: Double, updatedAt: Long)
    
    @Query("DELETE FROM nodes WHERE lastSeen < :before")
    suspend fun deleteStaleNodes(before: Long): Int
}

// MARK: - Routing DAO

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
    
    @Query("DELETE FROM routing_hints WHERE lastUpdated < :before")
    suspend fun deleteStaleHints(before: Long): Int
}

// MARK: - Bloom State DAO

@Dao
interface BloomStateDao {
    
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun save(state: BloomStateEntity)
    
    @Query("SELECT * FROM bloom_state WHERE id = 1")
    suspend fun get(): BloomStateEntity?
    
    @Query("DELETE FROM bloom_state")
    suspend fun clear()
}

// MARK: - Metrics DAO

@Dao
interface MetricsDao {
    
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(metrics: MetricsEntity)
    
    @Query("SELECT * FROM metrics WHERE bucketStart = :bucketStart")
    suspend fun getForBucket(bucketStart: Long): MetricsEntity?
    
    @Query("SELECT * FROM metrics ORDER BY bucketStart DESC LIMIT :limit")
    suspend fun getRecent(limit: Int): List<MetricsEntity>
    
    @Query("DELETE FROM metrics WHERE bucketStart < :before")
    suspend fun deleteOldMetrics(before: Long): Int
}

// MARK: - Database

@Database(
    entities = [
        BundleEntity::class,
        NodeEntity::class,
        RoutingHintEntity::class,
        BloomStateEntity::class,
        MetricsEntity::class
    ],
    version = 1,
    exportSchema = true
)
abstract class NodeModeDatabase : RoomDatabase() {
    abstract fun bundleDao(): BundleDao
    abstract fun nodeDao(): NodeDao
    abstract fun routingDao(): RoutingDao
    abstract fun bloomStateDao(): BloomStateDao
    abstract fun metricsDao(): MetricsDao
    
    companion object {
        const val DATABASE_NAME = "nodemode.db"
    }
}
