package com.railgun.android.nodemode.core

import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.security.MessageDigest
import java.util.UUID

/**
 * Bundle priority for message delivery ordering
 */
enum class BundlePriority(val value: Int) {
    BULK(0),      // Best effort, lowest priority
    NORMAL(1),    // Standard messages
    URGENT(2),    // Time-sensitive
    CRITICAL(3);  // Emergency/safety messages
    
    companion object {
        fun fromValue(value: Int) = entries.find { it.value == value } ?: NORMAL
    }
}

/**
 * Bundle flags for message attributes
 */
data class BundleFlags(val rawValue: Int) {
    val isEncrypted: Boolean get() = (rawValue and 0x01) != 0
    val requestAck: Boolean get() = (rawValue and 0x02) != 0
    val isAck: Boolean get() = (rawValue and 0x04) != 0
    val noRelay: Boolean get() = (rawValue and 0x08) != 0
    val isBroadcast: Boolean get() = (rawValue and 0x10) != 0
    val isCompressed: Boolean get() = (rawValue and 0x20) != 0
    
    companion object {
        const val ENCRYPTED = 0x01
        const val REQUEST_ACK = 0x02
        const val IS_ACK = 0x04
        const val NO_RELAY = 0x08
        const val BROADCAST = 0x10
        const val COMPRESSED = 0x20
        
        val DEFAULT = BundleFlags(ENCRYPTED or REQUEST_ACK)
    }
}

/**
 * Destination type for bundle routing
 */
enum class DestinationType(val value: Int) {
    USER(0),       // Deliver to specific user
    NODE(1),       // Deliver to specific node
    BROADCAST(2),  // Flood to all nodes
    GEOGRAPHIC(3); // Deliver to geographic region
    
    companion object {
        fun fromValue(value: Int) = entries.find { it.value == value } ?: USER
    }
}

/**
 * Bundle delivery state
 */
enum class BundleState(val value: Int) {
    PENDING(0),    // Awaiting delivery
    DELIVERED(1),  // Successfully delivered
    FAILED(2),     // Delivery failed (retries exhausted)
    EXPIRED(3);    // TTL exceeded
    
    companion object {
        fun fromValue(value: Int) = entries.find { it.value == value } ?: PENDING
    }
}

/**
 * Core bundle model for Node Mode mesh networking.
 * 
 * A Bundle is the fundamental unit of data in the delay-tolerant network.
 * It contains an encrypted payload with routing metadata and cryptographic
 * signatures for authentication.
 */
data class Bundle(
    // Unique bundle identifier
    val id: UUID = UUID.randomUUID(),
    
    // Protocol version
    val version: Int = 1,
    
    // Bundle flags
    val flags: BundleFlags = BundleFlags.DEFAULT,
    
    // Delivery priority
    val priority: BundlePriority = BundlePriority.NORMAL,
    
    // Current hop count (incremented on relay)
    var hopCount: Int = 0,
    
    // Maximum allowed hops
    val maxHops: Int = 10,
    
    // Bundle creation timestamp (Unix ms)
    val createdAt: Long = System.currentTimeMillis(),
    
    // Bundle expiration timestamp (Unix ms)
    val expiresAt: Long = createdAt + DEFAULT_TTL_MS,
    
    // Source node public key (Ed25519, 32 bytes)
    val sourceNode: ByteArray,
    
    // Destination type
    val destinationType: DestinationType = DestinationType.USER,
    
    // Destination identifier (32 bytes - user ID or node ID)
    val destination: ByteArray,
    
    // Geographic hint (optional, for geographic routing)
    val geoHash: String? = null,
    
    // Encrypted payload
    val payload: ByteArray,
    
    // Ed25519 signature over bundle header + payload hash
    val signature: ByteArray,
    
    // --- Local state (not serialized over wire) ---
    
    // Current delivery state
    var state: BundleState = BundleState.PENDING,
    
    // Number of delivery attempts
    var deliveryAttempts: Int = 0,
    
    // Last delivery attempt timestamp
    var lastAttemptAt: Long? = null,
    
    // Delivery completion timestamp
    var deliveredAt: Long? = null,
    
    // Node that confirmed delivery
    var deliveredTo: ByteArray? = null,
    
    // Timestamp when this bundle was received locally
    var receivedAt: Long = System.currentTimeMillis(),
    
    // Is this bundle destined for the local user?
    var isOwnMessage: Boolean = false,
    
    // Did this node create this bundle?
    var isOutgoing: Boolean = false
) {
    
    // MARK: - Computed Properties
    
    val payloadSize: Int get() = payload.size
    
    val totalSize: Int get() = 150 + (geoHash?.length ?: 0) + payload.size
    
    val isExpired: Boolean get() = System.currentTimeMillis() > expiresAt
    
    val isMaxHopsExceeded: Boolean get() = hopCount >= maxHops
    
    val canRelay: Boolean get() = !isExpired && !isMaxHopsExceeded && !flags.noRelay && state == BundleState.PENDING
    
    val ttlRemainingSeconds: Long get() = maxOf(0, (expiresAt - System.currentTimeMillis()) / 1000)
    
    // MARK: - Relay Preparation
    
    /**
     * Prepare bundle for relay (increment hop count)
     */
    fun preparedForRelay(): Bundle {
        check(canRelay) { "Bundle cannot be relayed" }
        return copy(hopCount = hopCount + 1)
    }
    
    // MARK: - Serialization
    
    /**
     * Serialize bundle to binary format
     */
    fun serialize(): ByteArray {
        require(sourceNode.size == 32) { "Source node must be 32 bytes" }
        require(destination.size == 32) { "Destination must be 32 bytes" }
        require(signature.size == 64) { "Signature must be 64 bytes" }
        
        val geoBytes = geoHash?.toByteArray(Charsets.UTF_8)?.take(12)?.toByteArray() ?: ByteArray(0)
        val totalSize = 150 + geoBytes.size + payload.size
        
        val buffer = ByteBuffer.allocate(totalSize).order(ByteOrder.BIG_ENDIAN)
        
        // Header
        buffer.put(version.toByte())
        buffer.put(flags.rawValue.toByte())
        buffer.put(priority.value.toByte())
        buffer.put(hopCount.toByte())
        buffer.put(maxHops.toByte())
        
        // Timestamps
        buffer.putLong(createdAt)
        buffer.putLong(expiresAt)
        
        // UUID (16 bytes)
        buffer.putLong(id.mostSignificantBits)
        buffer.putLong(id.leastSignificantBits)
        
        // Source node (32 bytes)
        buffer.put(sourceNode)
        
        // Destination type + destination
        buffer.put(destinationType.value.toByte())
        buffer.put(destination)
        
        // GeoHash (length-prefixed)
        buffer.put(geoBytes.size.toByte())
        if (geoBytes.isNotEmpty()) {
            buffer.put(geoBytes)
        }
        
        // Payload (length-prefixed, 4 bytes)
        buffer.putInt(payload.size)
        buffer.put(payload)
        
        // Signature (64 bytes)
        buffer.put(signature)
        
        return buffer.array().copyOf(buffer.position())
    }
    
    /**
     * Get bytes to sign (header + payload hash)
     */
    fun bytesToSign(): ByteArray {
        val buffer = ByteBuffer.allocate(128).order(ByteOrder.BIG_ENDIAN)
        
        buffer.put(version.toByte())
        buffer.put(flags.rawValue.toByte())
        buffer.put(priority.value.toByte())
        buffer.put(hopCount.toByte())
        buffer.put(maxHops.toByte())
        buffer.putLong(createdAt)
        buffer.putLong(expiresAt)
        buffer.putLong(id.mostSignificantBits)
        buffer.putLong(id.leastSignificantBits)
        buffer.put(sourceNode)
        buffer.put(destinationType.value.toByte())
        buffer.put(destination)
        
        // SHA-256 of payload
        val payloadHash = MessageDigest.getInstance("SHA-256").digest(payload)
        buffer.put(payloadHash)
        
        return buffer.array().copyOf(buffer.position())
    }
    
    companion object {
        const val DEFAULT_TTL_MS = 72L * 60 * 60 * 1000 // 72 hours
        const val MAX_PAYLOAD_SIZE = 64 * 1024 // 64KB
        
        /**
         * Deserialize bundle from binary format
         */
        fun deserialize(data: ByteArray): Bundle {
            require(data.size >= 150) { "Data too short to be a valid bundle" }
            
            val buffer = ByteBuffer.wrap(data).order(ByteOrder.BIG_ENDIAN)
            
            val version = buffer.get().toInt() and 0xFF
            val flags = BundleFlags(buffer.get().toInt() and 0xFF)
            val priority = BundlePriority.fromValue(buffer.get().toInt() and 0xFF)
            val hopCount = buffer.get().toInt() and 0xFF
            val maxHops = buffer.get().toInt() and 0xFF
            
            val createdAt = buffer.getLong()
            val expiresAt = buffer.getLong()
            
            val uuidMsb = buffer.getLong()
            val uuidLsb = buffer.getLong()
            val id = UUID(uuidMsb, uuidLsb)
            
            val sourceNode = ByteArray(32)
            buffer.get(sourceNode)
            
            val destinationType = DestinationType.fromValue(buffer.get().toInt() and 0xFF)
            val destination = ByteArray(32)
            buffer.get(destination)
            
            val geoLength = buffer.get().toInt() and 0xFF
            val geoHash = if (geoLength > 0) {
                val geoBytes = ByteArray(geoLength)
                buffer.get(geoBytes)
                String(geoBytes, Charsets.UTF_8)
            } else null
            
            val payloadLength = buffer.getInt()
            require(buffer.remaining() >= payloadLength + 64) { "Invalid payload length" }
            
            val payload = ByteArray(payloadLength)
            buffer.get(payload)
            
            val signature = ByteArray(64)
            buffer.get(signature)
            
            return Bundle(
                id = id,
                version = version,
                flags = flags,
                priority = priority,
                hopCount = hopCount,
                maxHops = maxHops,
                createdAt = createdAt,
                expiresAt = expiresAt,
                sourceNode = sourceNode,
                destinationType = destinationType,
                destination = destination,
                geoHash = geoHash,
                payload = payload,
                signature = signature
            )
        }
    }
    
    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (other !is Bundle) return false
        return id == other.id
    }
    
    override fun hashCode(): Int = id.hashCode()
}

/**
 * Bundle-related errors
 */
sealed class BundleException(message: String) : Exception(message) {
    class Expired : BundleException("Bundle has expired")
    class MaxHopsExceeded : BundleException("Bundle has exceeded maximum hops")
    class RelayDisabled : BundleException("Bundle relay is disabled")
    class InvalidSignature : BundleException("Bundle signature is invalid")
    class PayloadTooLarge : BundleException("Bundle payload exceeds maximum size")
    class SerializationFailed(reason: String) : BundleException("Failed to serialize bundle: $reason")
    class DeserializationFailed(reason: String) : BundleException("Failed to deserialize bundle: $reason")
}
