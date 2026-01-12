package com.railgun.android.nodemode.core

/**
 * Node capabilities bitmask
 */
data class NodeCapabilities(val rawValue: Int) {
    val canRelay: Boolean get() = (rawValue and CAN_RELAY) != 0
    val canStore: Boolean get() = (rawValue and CAN_STORE) != 0
    val hasInternet: Boolean get() = (rawValue and HAS_INTERNET) != 0
    val highBandwidth: Boolean get() = (rawValue and HIGH_BANDWIDTH) != 0
    val highStorage: Boolean get() = (rawValue and HIGH_STORAGE) != 0
    val supportsBle: Boolean get() = (rawValue and SUPPORTS_BLE) != 0
    val supportsWifiDirect: Boolean get() = (rawValue and SUPPORTS_WIFI_DIRECT) != 0
    
    companion object {
        const val CAN_RELAY = 0x01
        const val CAN_STORE = 0x02
        const val HAS_INTERNET = 0x04
        const val HIGH_BANDWIDTH = 0x08
        const val HIGH_STORAGE = 0x10
        const val SUPPORTS_BLE = 0x20
        const val SUPPORTS_WIFI_DIRECT = 0x40
        
        val DEFAULT = NodeCapabilities(CAN_RELAY or CAN_STORE)
    }
}

/**
 * Connection type used to communicate with a node
 */
enum class ConnectionType(val value: String) {
    BLE("ble"),
    WIFI_DIRECT("wifi_direct"),
    LAN("lan"),
    NEARBY_CONNECTIONS("nearby_connections"),
    UNKNOWN("unknown");
    
    companion object {
        fun fromValue(value: String) = entries.find { it.value == value } ?: UNKNOWN
    }
}

/**
 * Represents a mesh peer in the Node Mode network
 */
data class Node(
    // Node ID (Ed25519 public key as hex string)
    val id: String,
    
    // Associated user ID (if known)
    var userId: String? = null,
    
    // Human-readable display name (optional)
    var displayName: String? = null,
    
    // Node capability flags
    var capabilities: NodeCapabilities = NodeCapabilities.DEFAULT,
    
    // First time this node was discovered
    val firstSeen: Long = System.currentTimeMillis(),
    
    // Most recent time this node was seen
    var lastSeen: Long = System.currentTimeMillis(),
    
    // Number of times this node has been discovered
    var timesSeen: Int = 1,
    
    // Last known geohash location
    var lastGeoHash: String? = null,
    
    // Accuracy of last location (meters)
    var lastGeoAccuracy: Int? = null,
    
    // Reputation score (0.0 to 1.0)
    var reputation: Double = 0.5,
    
    // Number of samples used to calculate reputation
    var reputationSamples: Int = 0,
    
    // Statistics
    var bundlesReceivedFrom: Int = 0,
    var bundlesSentTo: Int = 0,
    var bytesReceivedFrom: Long = 0,
    var bytesSentTo: Long = 0,
    var deliverySuccesses: Int = 0,
    var deliveryFailures: Int = 0,
    
    // PROPHET routing - delivery predictability P(a,b)
    var deliveryPredictability: Double = 0.0,
    var predictabilityUpdatedAt: Long? = null,
    
    // Connection info
    var lastConnectionType: ConnectionType? = null,
    var lastRssi: Int? = null,
    var isConnected: Boolean = false
) {
    
    // MARK: - Computed Properties
    
    val nodeIdBytes: ByteArray?
        get() = try { id.hexToByteArray() } catch (e: Exception) { null }
    
    val deliverySuccessRate: Double
        get() {
            val total = deliverySuccesses + deliveryFailures
            return if (total > 0) deliverySuccesses.toDouble() / total else 0.5
        }
    
    val isGateway: Boolean
        get() = capabilities.hasInternet
    
    val timeSinceLastSeenMs: Long
        get() = System.currentTimeMillis() - lastSeen
    
    val isRecentlyActive: Boolean
        get() = timeSinceLastSeenMs < 3600_000 // 1 hour
    
    // MARK: - Reputation Updates
    
    /**
     * Update reputation based on delivery outcome
     */
    fun updateReputation(success: Boolean) {
        val weight = 1.0 / (reputationSamples + 1)
        val outcome = if (success) 1.0 else 0.0
        reputation = reputation * (1 - weight) + outcome * weight
        reputationSamples++
        
        if (success) {
            deliverySuccesses++
        } else {
            deliveryFailures++
        }
    }
    
    // MARK: - PROPHET Predictability
    
    /**
     * Update delivery predictability on encounter
     * Uses PROPHET algorithm: P(a,b) = P(a,b)_old + (1 - P(a,b)_old) * P_init
     */
    fun updatePredictabilityOnEncounter(initialProbability: Double = 0.75) {
        deliveryPredictability = deliveryPredictability + (1 - deliveryPredictability) * initialProbability
        predictabilityUpdatedAt = System.currentTimeMillis()
    }
    
    /**
     * Age the predictability over time
     * Uses PROPHET algorithm: P(a,b) = P(a,b)_old * gamma^k
     */
    fun agePredictability(gamma: Double = 0.98, timeDeltaMs: Long) {
        val k = timeDeltaMs / 60_000.0 // Age per minute
        deliveryPredictability = deliveryPredictability * Math.pow(gamma, k)
        predictabilityUpdatedAt = System.currentTimeMillis()
    }
    
    /**
     * Compute transitive predictability
     * P(a,c) = P(a,c)_old + (1 - P(a,c)_old) * P(a,b) * P(b,c) * beta
     */
    fun updateTransitivePredictability(
        intermediateNodePredictability: Double,
        destinationPredictability: Double,
        beta: Double = 0.25
    ) {
        val transitive = deliveryPredictability * intermediateNodePredictability * destinationPredictability * beta
        deliveryPredictability = deliveryPredictability + (1 - deliveryPredictability) * transitive
        predictabilityUpdatedAt = System.currentTimeMillis()
    }
    
    // MARK: - Record Activity
    
    fun recordSeen(connectionType: ConnectionType? = null, rssi: Int? = null) {
        lastSeen = System.currentTimeMillis()
        timesSeen++
        connectionType?.let { lastConnectionType = it }
        rssi?.let { lastRssi = it }
    }
    
    fun recordBundleReceived(bytes: Int) {
        bundlesReceivedFrom++
        bytesReceivedFrom += bytes
        recordSeen()
    }
    
    fun recordBundleSent(bytes: Int) {
        bundlesSentTo++
        bytesSentTo += bytes
    }
}

// MARK: - Hex Extensions

fun String.hexToByteArray(): ByteArray {
    check(length % 2 == 0) { "Hex string must have even length" }
    return chunked(2)
        .map { it.toInt(16).toByte() }
        .toByteArray()
}

fun ByteArray.toHexString(): String = joinToString("") { "%02x".format(it) }
