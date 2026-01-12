package com.railgun.android.nodemode.core

import android.content.Context
import android.util.Log
import com.railgun.android.nodemode.data.*
import com.railgun.android.nodemode.routing.BloomFilter
import com.railgun.android.nodemode.transport.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import java.security.SecureRandom
import java.util.*
import java.util.concurrent.ConcurrentHashMap

// MARK: - Node Mode State

enum class NodeModeState {
    INACTIVE,
    ACTIVATING,
    ACTIVE,
    DEACTIVATING,
    ERROR
}

// MARK: - Node Mode Event

sealed class NodeModeEvent {
    data class StateChanged(val state: NodeModeState) : NodeModeEvent()
    data class BundleReceived(val bundle: Bundle) : NodeModeEvent()
    data class BundleDelivered(val bundleId: String, val recipientId: String) : NodeModeEvent()
    data class BundleExpired(val bundleId: String) : NodeModeEvent()
    data class PeerConnected(val peer: Node) : NodeModeEvent()
    data class PeerDisconnected(val nodeId: String) : NodeModeEvent()
    data class Error(val error: Throwable) : NodeModeEvent()
    data class StatsUpdated(val stats: NodeModeStats) : NodeModeEvent()
}

// MARK: - Node Mode Stats

data class NodeModeStats(
    val totalBundlesSent: Long = 0,
    val totalBundlesReceived: Long = 0,
    val totalBundlesForwarded: Long = 0,
    val totalBundlesDropped: Long = 0,
    val totalBytesTransferred: Long = 0,
    val activePeers: Int = 0,
    val storedBundles: Int = 0,
    val uptime: Long = 0
)

// MARK: - Node Mode Configuration

data class NodeModeConfig(
    val enableBLE: Boolean = true,
    val enableWifiDirect: Boolean = false,
    val maxStoredBundles: Int = 1000,
    val maxBundleSize: Int = 256 * 1024, // 256KB
    val bundleTTLHours: Int = 72,
    val maxHops: Int = 10,
    val bloomFilterFalsePositiveRate: Double = 0.01,
    val bloomFilterExpectedItems: Int = 10000,
    val forwardingEnabled: Boolean = true,
    val autoConnectPeers: Boolean = true,
    val connectionCooldownMs: Long = 30_000,
    val maxConcurrentConnections: Int = 5,
    val broadcastIntervalMs: Long = 5_000
)

// MARK: - Node Mode Manager

class NodeModeManager(
    private val context: Context,
    private val config: NodeModeConfig = NodeModeConfig()
) {
    companion object {
        private const val TAG = "NodeModeManager"
        private const val PREFS_NAME = "node_mode_prefs"
        private const val KEY_NODE_ID = "node_id"
        private const val KEY_IDENTITY_KEY = "identity_key"
        
        @Volatile
        private var instance: NodeModeManager? = null
        
        fun getInstance(context: Context, config: NodeModeConfig = NodeModeConfig()): NodeModeManager {
            return instance ?: synchronized(this) {
                instance ?: NodeModeManager(context.applicationContext, config).also {
                    instance = it
                }
            }
        }
    }
    
    // State
    private val _state = MutableStateFlow(NodeModeState.INACTIVE)
    val state: StateFlow<NodeModeState> = _state.asStateFlow()
    
    private val _events = MutableSharedFlow<NodeModeEvent>(extraBufferCapacity = 64)
    val events: SharedFlow<NodeModeEvent> = _events.asSharedFlow()
    
    private val _stats = MutableStateFlow(NodeModeStats())
    val stats: StateFlow<NodeModeStats> = _stats.asStateFlow()
    
    // Node Identity
    private var nodeId: ByteArray = ByteArray(0)
    private var identityKey: ByteArray = ByteArray(0)
    
    // Components
    private lateinit var database: NodeModeDatabase
    private lateinit var bloomFilter: BloomFilter
    private val transports = mutableListOf<Transport>()
    private val connectedNodes = ConcurrentHashMap<String, Node>()
    
    // Coroutines
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private var maintenanceJob: Job? = null
    private var statsJob: Job? = null
    private var startTime: Long = 0
    
    // Connection management
    private val connectionCooldowns = ConcurrentHashMap<String, Long>()
    private val pendingBundleDeliveries = ConcurrentHashMap<String, Job>()
    
    // MARK: - Initialization
    
    init {
        loadOrCreateIdentity()
    }
    
    private fun loadOrCreateIdentity() {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        
        val storedNodeId = prefs.getString(KEY_NODE_ID, null)
        val storedIdentityKey = prefs.getString(KEY_IDENTITY_KEY, null)
        
        if (storedNodeId != null && storedIdentityKey != null) {
            nodeId = storedNodeId.hexToByteArray()
            identityKey = storedIdentityKey.hexToByteArray()
        } else {
            // Generate new identity
            val random = SecureRandom()
            nodeId = ByteArray(32).also { random.nextBytes(it) }
            identityKey = ByteArray(32).also { random.nextBytes(it) }
            
            prefs.edit()
                .putString(KEY_NODE_ID, nodeId.toHexString())
                .putString(KEY_IDENTITY_KEY, identityKey.toHexString())
                .apply()
        }
        
        Log.i(TAG, "Node ID: ${nodeId.toHexString().take(16)}...")
    }
    
    // MARK: - Lifecycle
    
    suspend fun activate() {
        if (_state.value != NodeModeState.INACTIVE) {
            Log.w(TAG, "Cannot activate: current state is ${_state.value}")
            return
        }
        
        _state.value = NodeModeState.ACTIVATING
        _events.emit(NodeModeEvent.StateChanged(NodeModeState.ACTIVATING))
        
        try {
            // Initialize database
            database = NodeModeDatabase.getInstance(context)
            
            // Initialize bloom filter
            bloomFilter = BloomFilter(
                expectedItems = config.bloomFilterExpectedItems,
                falsePositiveRate = config.bloomFilterFalsePositiveRate
            )
            
            // Load existing bundle IDs into bloom filter
            loadExistingBundles()
            
            // Initialize transports
            setupTransports()
            
            // Start background tasks
            startMaintenanceTask()
            startStatsTask()
            
            startTime = System.currentTimeMillis()
            _state.value = NodeModeState.ACTIVE
            _events.emit(NodeModeEvent.StateChanged(NodeModeState.ACTIVE))
            
            Log.i(TAG, "Node Mode activated")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to activate Node Mode", e)
            _state.value = NodeModeState.ERROR
            _events.emit(NodeModeEvent.Error(e))
        }
    }
    
    suspend fun deactivate() {
        if (_state.value != NodeModeState.ACTIVE) {
            return
        }
        
        _state.value = NodeModeState.DEACTIVATING
        _events.emit(NodeModeEvent.StateChanged(NodeModeState.DEACTIVATING))
        
        // Cancel background tasks
        maintenanceJob?.cancel()
        statsJob?.cancel()
        pendingBundleDeliveries.values.forEach { it.cancel() }
        
        // Stop transports
        transports.forEach { transport ->
            try {
                transport.stop()
            } catch (e: Exception) {
                Log.e(TAG, "Error stopping transport", e)
            }
        }
        transports.clear()
        
        connectedNodes.clear()
        connectionCooldowns.clear()
        
        _state.value = NodeModeState.INACTIVE
        _events.emit(NodeModeEvent.StateChanged(NodeModeState.INACTIVE))
        
        Log.i(TAG, "Node Mode deactivated")
    }
    
    // MARK: - Transport Setup
    
    private suspend fun setupTransports() {
        if (config.enableBLE) {
            val bleTransport = BLETransport(context)
            bleTransport.setNodeId(nodeId)
            
            // Collect transport events
            scope.launch {
                bleTransport.events.collect { event ->
                    handleTransportEvent(bleTransport, event)
                }
            }
            
            bleTransport.start()
            transports.add(bleTransport)
            Log.i(TAG, "BLE transport started")
        }
        
        // Future: Add Wi-Fi Direct, Nearby Connections
    }
    
    private suspend fun handleTransportEvent(transport: Transport, event: TransportEvent) {
        when (event) {
            is TransportEvent.PeerDiscovered -> {
                if (config.autoConnectPeers && shouldConnectToPeer(event.peer)) {
                    tryConnectToPeer(transport, event.peer.id)
                }
            }
            is TransportEvent.PeerConnected -> {
                handlePeerConnected(event.peer)
            }
            is TransportEvent.PeerDisconnected -> {
                handlePeerDisconnected(event.peerId)
            }
            is TransportEvent.MessageReceived -> {
                handleMessageReceived(event.data, event.fromPeerId)
            }
            is TransportEvent.Error -> {
                Log.e(TAG, "Transport error", event.error)
                _events.emit(NodeModeEvent.Error(event.error))
            }
            else -> { /* Ignore other events */ }
        }
    }
    
    private fun shouldConnectToPeer(peer: PeerInfo): Boolean {
        // Check cooldown
        val cooldown = connectionCooldowns[peer.id]
        if (cooldown != null && System.currentTimeMillis() - cooldown < config.connectionCooldownMs) {
            return false
        }
        
        // Check max connections
        if (connectedNodes.size >= config.maxConcurrentConnections) {
            return false
        }
        
        // Don't connect to self
        if (peer.nodeId == nodeId.toHexString()) {
            return false
        }
        
        return !peer.isConnected
    }
    
    private fun tryConnectToPeer(transport: Transport, peerId: String) {
        scope.launch {
            try {
                transport.connect(peerId)
            } catch (e: Exception) {
                Log.e(TAG, "Failed to connect to peer $peerId", e)
                connectionCooldowns[peerId] = System.currentTimeMillis()
            }
        }
    }
    
    private suspend fun handlePeerConnected(peer: PeerInfo) {
        val node = Node(
            id = peer.nodeId ?: peer.id,
            publicKey = ByteArray(0), // Will be exchanged in handshake
            capabilities = NodeCapabilities()
        )
        
        connectedNodes[peer.id] = node
        
        // Store in database
        database.nodeDao().insertNode(NodeEntity.fromNode(node))
        
        _events.emit(NodeModeEvent.PeerConnected(node))
        updateStats { it.copy(activePeers = connectedNodes.size) }
        
        // Exchange pending bundles
        exchangeBundlesWithPeer(peer.id)
        
        Log.i(TAG, "Peer connected: ${peer.id}")
    }
    
    private suspend fun handlePeerDisconnected(peerId: String) {
        val node = connectedNodes.remove(peerId)
        
        if (node != null) {
            _events.emit(NodeModeEvent.PeerDisconnected(node.id))
            updateStats { it.copy(activePeers = connectedNodes.size) }
        }
        
        connectionCooldowns[peerId] = System.currentTimeMillis()
        
        Log.i(TAG, "Peer disconnected: $peerId")
    }
    
    private suspend fun handleMessageReceived(data: ByteArray, fromPeerId: String) {
        try {
            val bundle = Bundle.deserialize(data)
            processReceivedBundle(bundle, fromPeerId)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to process received message", e)
        }
    }
    
    // MARK: - Bundle Management
    
    suspend fun sendBundle(
        payload: ByteArray,
        destinationNodeId: ByteArray,
        priority: BundlePriority = BundlePriority.NORMAL,
        flags: BundleFlags = BundleFlags()
    ): String {
        if (_state.value != NodeModeState.ACTIVE) {
            throw IllegalStateException("Node Mode is not active")
        }
        
        if (payload.size > config.maxBundleSize) {
            throw IllegalArgumentException("Payload exceeds maximum size")
        }
        
        val bundle = Bundle(
            id = UUID.randomUUID().toString(),
            sourceNodeId = nodeId,
            destinationNodeId = destinationNodeId,
            payload = payload,
            createdAt = System.currentTimeMillis(),
            expiresAt = System.currentTimeMillis() + (config.bundleTTLHours * 3600_000L),
            priority = priority,
            flags = flags
        )
        
        // Add to bloom filter
        bloomFilter.add(bundle.id)
        
        // Store bundle
        database.bundleDao().insertBundle(BundleEntity.fromBundle(bundle))
        
        // Broadcast to connected peers
        broadcastBundle(bundle)
        
        updateStats {
            it.copy(
                totalBundlesSent = it.totalBundlesSent + 1,
                totalBytesTransferred = it.totalBytesTransferred + payload.size,
                storedBundles = it.storedBundles + 1
            )
        }
        
        Log.d(TAG, "Bundle sent: ${bundle.id.take(8)}...")
        
        return bundle.id
    }
    
    private suspend fun processReceivedBundle(bundle: Bundle, fromPeerId: String) {
        // Check if we've seen this bundle
        if (bloomFilter.mightContain(bundle.id)) {
            // Double-check in database
            val existing = database.bundleDao().getBundleById(bundle.id)
            if (existing != null) {
                Log.d(TAG, "Duplicate bundle ignored: ${bundle.id.take(8)}...")
                return
            }
        }
        
        // Check expiration
        if (bundle.isExpired) {
            Log.d(TAG, "Expired bundle ignored: ${bundle.id.take(8)}...")
            updateStats { it.copy(totalBundlesDropped = it.totalBundlesDropped + 1) }
            return
        }
        
        // Check hop count
        if (bundle.hopCount >= config.maxHops) {
            Log.d(TAG, "Bundle exceeded max hops: ${bundle.id.take(8)}...")
            updateStats { it.copy(totalBundlesDropped = it.totalBundlesDropped + 1) }
            return
        }
        
        // Add to bloom filter
        bloomFilter.add(bundle.id)
        
        // Increment hop count
        val updatedBundle = bundle.incrementHop(nodeId)
        
        // Store bundle
        database.bundleDao().insertBundle(BundleEntity.fromBundle(updatedBundle))
        
        updateStats {
            it.copy(
                totalBundlesReceived = it.totalBundlesReceived + 1,
                totalBytesTransferred = it.totalBytesTransferred + bundle.payload.size,
                storedBundles = it.storedBundles + 1
            )
        }
        
        // Check if bundle is for us
        if (bundle.destinationNodeId.contentEquals(nodeId)) {
            handleLocalDelivery(bundle)
        } else if (config.forwardingEnabled) {
            // Forward to other peers
            forwardBundle(updatedBundle, excludePeer = fromPeerId)
        }
        
        _events.emit(NodeModeEvent.BundleReceived(bundle))
        Log.d(TAG, "Bundle received: ${bundle.id.take(8)}...")
    }
    
    private suspend fun handleLocalDelivery(bundle: Bundle) {
        _events.emit(NodeModeEvent.BundleDelivered(bundle.id, nodeId.toHexString()))
        
        // Mark as delivered
        database.bundleDao().updateBundleState(bundle.id, BundleState.DELIVERED.name)
        
        Log.i(TAG, "Bundle delivered locally: ${bundle.id.take(8)}...")
    }
    
    private suspend fun broadcastBundle(bundle: Bundle) {
        val data = bundle.serialize()
        transports.forEach { transport ->
            try {
                transport.broadcast(data)
            } catch (e: Exception) {
                Log.e(TAG, "Failed to broadcast bundle", e)
            }
        }
    }
    
    private suspend fun forwardBundle(bundle: Bundle, excludePeer: String) {
        val data = bundle.serialize()
        transports.forEach { transport ->
            transport.connectedPeers
                .filter { it.id != excludePeer }
                .forEach { peer ->
                    try {
                        transport.send(data, peer.id)
                        updateStats { it.copy(totalBundlesForwarded = it.totalBundlesForwarded + 1) }
                    } catch (e: Exception) {
                        Log.e(TAG, "Failed to forward bundle to ${peer.id}", e)
                    }
                }
        }
    }
    
    private suspend fun exchangeBundlesWithPeer(peerId: String) {
        // Get pending bundles that haven't been delivered
        val pendingBundles = database.bundleDao().getPendingBundles()
        
        val transport = transports.firstOrNull { 
            it.connectedPeers.any { peer -> peer.id == peerId } 
        } ?: return
        
        pendingBundles.forEach { entity ->
            try {
                val bundle = entity.toBundle()
                if (!bundle.isExpired) {
                    val data = bundle.serialize()
                    transport.send(data, peerId)
                }
            } catch (e: Exception) {
                Log.e(TAG, "Failed to exchange bundle with peer", e)
            }
        }
    }
    
    private suspend fun loadExistingBundles() {
        val bundles = database.bundleDao().getAllBundles()
        bundles.forEach { entity ->
            bloomFilter.add(entity.id)
        }
        updateStats { it.copy(storedBundles = bundles.size) }
        Log.d(TAG, "Loaded ${bundles.size} existing bundles into bloom filter")
    }
    
    // MARK: - Background Tasks
    
    private fun startMaintenanceTask() {
        maintenanceJob = scope.launch {
            while (isActive) {
                delay(60_000) // Every minute
                performMaintenance()
            }
        }
    }
    
    private suspend fun performMaintenance() {
        // Clean up expired bundles
        val expiredBundles = database.bundleDao().getExpiredBundles(System.currentTimeMillis())
        expiredBundles.forEach { entity ->
            _events.emit(NodeModeEvent.BundleExpired(entity.id))
        }
        database.bundleDao().deleteExpiredBundles(System.currentTimeMillis())
        
        // Clean up old nodes
        val staleTime = System.currentTimeMillis() - (24 * 3600_000L) // 24 hours
        database.nodeDao().deleteStaleNodes(staleTime)
        
        // Rebuild bloom filter if it's getting full
        if (bloomFilter.approximateCount() > config.bloomFilterExpectedItems * 0.8) {
            rebuildBloomFilter()
        }
        
        updateStats { it.copy(storedBundles = database.bundleDao().getBundleCount()) }
        
        Log.d(TAG, "Maintenance completed")
    }
    
    private suspend fun rebuildBloomFilter() {
        val newFilter = BloomFilter(
            expectedItems = config.bloomFilterExpectedItems,
            falsePositiveRate = config.bloomFilterFalsePositiveRate
        )
        
        database.bundleDao().getAllBundles().forEach { entity ->
            newFilter.add(entity.id)
        }
        
        bloomFilter = newFilter
        Log.d(TAG, "Bloom filter rebuilt")
    }
    
    private fun startStatsTask() {
        statsJob = scope.launch {
            while (isActive) {
                delay(5_000) // Every 5 seconds
                updateStats { it.copy(uptime = System.currentTimeMillis() - startTime) }
                _events.emit(NodeModeEvent.StatsUpdated(_stats.value))
            }
        }
    }
    
    private fun updateStats(update: (NodeModeStats) -> NodeModeStats) {
        _stats.update(update)
    }
    
    // MARK: - Public API
    
    fun getNodeId(): ByteArray = nodeId.copyOf()
    
    fun getNodeIdHex(): String = nodeId.toHexString()
    
    fun getConnectedPeers(): List<Node> = connectedNodes.values.toList()
    
    suspend fun getPendingBundles(): List<Bundle> {
        return database.bundleDao().getPendingBundles().map { it.toBundle() }
    }
    
    suspend fun getBundle(id: String): Bundle? {
        return database.bundleDao().getBundleById(id)?.toBundle()
    }
    
    suspend fun deleteBundle(id: String) {
        database.bundleDao().deleteBundle(id)
        updateStats { it.copy(storedBundles = maxOf(0, it.storedBundles - 1)) }
    }
    
    fun isActive(): Boolean = _state.value == NodeModeState.ACTIVE
}

// MARK: - Extensions

fun String.hexToByteArray(): ByteArray {
    check(length % 2 == 0) { "Hex string must have even length" }
    return chunked(2)
        .map { it.toInt(16).toByte() }
        .toByteArray()
}
