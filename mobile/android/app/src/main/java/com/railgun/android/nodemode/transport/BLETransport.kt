package com.railgun.android.nodemode.transport

import android.annotation.SuppressLint
import android.bluetooth.*
import android.bluetooth.le.*
import android.content.Context
import android.os.Build
import android.os.ParcelUuid
import com.railgun.android.nodemode.core.toHexString
import kotlinx.coroutines.*
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.*
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.*
import java.util.concurrent.ConcurrentHashMap

// MARK: - BLE Constants

object BLEConstants {
    // Service UUID for Node Mode
    val SERVICE_UUID: UUID = UUID.fromString("B9E5F7A0-1234-5678-9ABC-DEF012345678")
    
    // Characteristic UUIDs
    val NODE_ID_CHARACTERISTIC: UUID = UUID.fromString("B9E5F7A1-1234-5678-9ABC-DEF012345678")
    val BUNDLE_WRITE_CHARACTERISTIC: UUID = UUID.fromString("B9E5F7A2-1234-5678-9ABC-DEF012345678")
    val BUNDLE_NOTIFY_CHARACTERISTIC: UUID = UUID.fromString("B9E5F7A3-1234-5678-9ABC-DEF012345678")
    val HANDSHAKE_CHARACTERISTIC: UUID = UUID.fromString("B9E5F7A4-1234-5678-9ABC-DEF012345678")
    
    // Maximum MTU for BLE (will be negotiated)
    const val MAX_MTU = 512
    
    // Chunk size for large transfers
    const val CHUNK_SIZE = 182 // Safe for most devices
    
    // Connection timeout
    const val CONNECTION_TIMEOUT_MS = 10_000L
}

// MARK: - Transport Types

enum class TransportType(val value: String) {
    BLE("ble"),
    WIFI_DIRECT("wifi_direct"),
    NEARBY_CONNECTIONS("nearby_connections"),
    LAN("lan")
}

enum class TransportState {
    IDLE,
    STARTING,
    RUNNING,
    STOPPING,
    ERROR
}

data class PeerInfo(
    val id: String,
    var nodeId: String? = null,
    val transportType: TransportType,
    var signalStrength: Int? = null,
    var displayName: String? = null,
    var capabilitiesRaw: Int? = null,
    val discoveredAt: Long = System.currentTimeMillis(),
    var lastSeenAt: Long = System.currentTimeMillis(),
    var isConnected: Boolean = false
)

sealed class TransportEvent {
    data class StateChanged(val state: TransportState) : TransportEvent()
    data class PeerDiscovered(val peer: PeerInfo) : TransportEvent()
    data class PeerLost(val peerId: String) : TransportEvent()
    data class PeerConnected(val peer: PeerInfo) : TransportEvent()
    data class PeerDisconnected(val peerId: String) : TransportEvent()
    data class MessageReceived(val data: ByteArray, val fromPeerId: String) : TransportEvent()
    data class MessageSent(val messageId: String, val toPeerId: String) : TransportEvent()
    data class Error(val error: Throwable) : TransportEvent()
}

// MARK: - Transport Interface

interface Transport {
    val transportType: TransportType
    val state: StateFlow<TransportState>
    val events: SharedFlow<TransportEvent>
    val discoveredPeers: List<PeerInfo>
    val connectedPeers: List<PeerInfo>
    
    suspend fun start()
    suspend fun stop()
    suspend fun connect(peerId: String)
    suspend fun disconnect(peerId: String)
    suspend fun send(data: ByteArray, peerId: String)
    suspend fun broadcast(data: ByteArray)
    fun setNodeId(nodeId: ByteArray)
    fun setDisplayName(name: String)
}

// MARK: - BLE Peer State

private class BLEPeerState(
    val device: BluetoothDevice,
    var gatt: BluetoothGatt? = null
) {
    val characteristics = mutableMapOf<UUID, BluetoothGattCharacteristic>()
    var isHandshakeComplete = false
    var nodeId: String? = null
    var pendingData = ByteArray(0)
    var expectedLength = 0
    var mtu = 23 // Default BLE MTU
}

// MARK: - BLE Transport

@SuppressLint("MissingPermission")
class BLETransport(
    private val context: Context
) : Transport {
    
    override val transportType = TransportType.BLE
    
    private val _state = MutableStateFlow(TransportState.IDLE)
    override val state: StateFlow<TransportState> = _state.asStateFlow()
    
    private val _events = MutableSharedFlow<TransportEvent>(extraBufferCapacity = 64)
    override val events: SharedFlow<TransportEvent> = _events.asSharedFlow()
    
    private val peers = ConcurrentHashMap<String, BLEPeerState>()
    
    override val discoveredPeers: List<PeerInfo>
        get() = peers.values.map { peerInfo(it) }
    
    override val connectedPeers: List<PeerInfo>
        get() = peers.values
            .filter { it.gatt != null && it.isHandshakeComplete }
            .map { peerInfo(it) }
    
    private var nodeId: ByteArray? = null
    private var displayName = "Railgun Node"
    
    private val bluetoothManager: BluetoothManager? by lazy {
        context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
    }
    
    private val bluetoothAdapter: BluetoothAdapter?
        get() = bluetoothManager?.adapter
    
    private var bleScanner: BluetoothLeScanner? = null
    private var bleAdvertiser: BluetoothLeAdvertiser? = null
    private var gattServer: BluetoothGattServer? = null
    
    private var isScanning = false
    private var isAdvertising = false
    
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private val writeChannel = Channel<Triple<BluetoothGatt, BluetoothGattCharacteristic, ByteArray>>(Channel.UNLIMITED)
    
    // MARK: - Transport Implementation
    
    override suspend fun start() {
        if (_state.value == TransportState.RUNNING) return
        _state.value = TransportState.STARTING
        
        val adapter = bluetoothAdapter
        if (adapter == null || !adapter.isEnabled) {
            _state.value = TransportState.ERROR
            _events.emit(TransportEvent.Error(IllegalStateException("Bluetooth not available")))
            return
        }
        
        bleScanner = adapter.bluetoothLeScanner
        bleAdvertiser = adapter.bluetoothLeAdvertiser
        
        startGattServer()
        startAdvertising()
        startScanning()
        startWriteWorker()
        
        _state.value = TransportState.RUNNING
        _events.emit(TransportEvent.StateChanged(TransportState.RUNNING))
    }
    
    override suspend fun stop() {
        _state.value = TransportState.STOPPING
        
        stopScanning()
        stopAdvertising()
        
        // Disconnect all peers
        peers.values.forEach { peer ->
            peer.gatt?.disconnect()
            peer.gatt?.close()
        }
        peers.clear()
        
        gattServer?.close()
        gattServer = null
        
        scope.coroutineContext.cancelChildren()
        
        _state.value = TransportState.IDLE
        _events.emit(TransportEvent.StateChanged(TransportState.IDLE))
    }
    
    override suspend fun connect(peerId: String) {
        val peer = peers[peerId] ?: throw IllegalArgumentException("Unknown peer: $peerId")
        
        if (peer.gatt != null) return
        
        withContext(Dispatchers.Main) {
            peer.gatt = peer.device.connectGatt(
                context,
                false,
                gattCallback,
                BluetoothDevice.TRANSPORT_LE
            )
        }
        
        // Wait for connection with timeout
        withTimeout(BLEConstants.CONNECTION_TIMEOUT_MS) {
            while (peer.gatt?.let { getConnectionState(it) } != BluetoothProfile.STATE_CONNECTED) {
                delay(100)
            }
        }
    }
    
    override suspend fun disconnect(peerId: String) {
        val peer = peers[peerId] ?: return
        peer.gatt?.disconnect()
        peer.gatt?.close()
        peer.gatt = null
        peer.isHandshakeComplete = false
    }
    
    override suspend fun send(data: ByteArray, peerId: String) {
        val peer = peers[peerId] ?: throw IllegalArgumentException("Unknown peer: $peerId")
        val gatt = peer.gatt ?: throw IllegalStateException("Not connected to peer: $peerId")
        val characteristic = peer.characteristics[BLEConstants.BUNDLE_WRITE_CHARACTERISTIC]
            ?: throw IllegalStateException("Write characteristic not found")
        
        sendChunked(data, gatt, characteristic, peer.mtu)
        _events.emit(TransportEvent.MessageSent(UUID.randomUUID().toString(), peerId))
    }
    
    override suspend fun broadcast(data: ByteArray) {
        connectedPeers.forEach { peer ->
            try {
                send(data, peer.id)
            } catch (e: Exception) {
                _events.emit(TransportEvent.Error(e))
            }
        }
    }
    
    override fun setNodeId(nodeId: ByteArray) {
        this.nodeId = nodeId
        updateAdvertisement()
    }
    
    override fun setDisplayName(name: String) {
        this.displayName = name
        updateAdvertisement()
    }
    
    // MARK: - Private Methods
    
    private fun peerInfo(state: BLEPeerState): PeerInfo {
        return PeerInfo(
            id = state.device.address,
            nodeId = state.nodeId,
            transportType = TransportType.BLE,
            displayName = state.device.name,
            isConnected = state.isHandshakeComplete
        )
    }
    
    private fun startGattServer() {
        gattServer = bluetoothManager?.openGattServer(context, gattServerCallback)
        
        val service = BluetoothGattService(
            BLEConstants.SERVICE_UUID,
            BluetoothGattService.SERVICE_TYPE_PRIMARY
        )
        
        // Node ID characteristic (read)
        val nodeIdChar = BluetoothGattCharacteristic(
            BLEConstants.NODE_ID_CHARACTERISTIC,
            BluetoothGattCharacteristic.PROPERTY_READ,
            BluetoothGattCharacteristic.PERMISSION_READ
        )
        service.addCharacteristic(nodeIdChar)
        
        // Bundle write characteristic
        val bundleWriteChar = BluetoothGattCharacteristic(
            BLEConstants.BUNDLE_WRITE_CHARACTERISTIC,
            BluetoothGattCharacteristic.PROPERTY_WRITE,
            BluetoothGattCharacteristic.PERMISSION_WRITE
        )
        service.addCharacteristic(bundleWriteChar)
        
        // Bundle notify characteristic
        val bundleNotifyChar = BluetoothGattCharacteristic(
            BLEConstants.BUNDLE_NOTIFY_CHARACTERISTIC,
            BluetoothGattCharacteristic.PROPERTY_INDICATE,
            BluetoothGattCharacteristic.PERMISSION_READ
        )
        val descriptor = BluetoothGattDescriptor(
            UUID.fromString("00002902-0000-1000-8000-00805f9b34fb"),
            BluetoothGattDescriptor.PERMISSION_READ or BluetoothGattDescriptor.PERMISSION_WRITE
        )
        bundleNotifyChar.addDescriptor(descriptor)
        service.addCharacteristic(bundleNotifyChar)
        
        // Handshake characteristic
        val handshakeChar = BluetoothGattCharacteristic(
            BLEConstants.HANDSHAKE_CHARACTERISTIC,
            BluetoothGattCharacteristic.PROPERTY_READ or BluetoothGattCharacteristic.PROPERTY_WRITE,
            BluetoothGattCharacteristic.PERMISSION_READ or BluetoothGattCharacteristic.PERMISSION_WRITE
        )
        service.addCharacteristic(handshakeChar)
        
        gattServer?.addService(service)
    }
    
    private fun startAdvertising() {
        val settings = AdvertiseSettings.Builder()
            .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY)
            .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_HIGH)
            .setConnectable(true)
            .build()
        
        val data = AdvertiseData.Builder()
            .setIncludeDeviceName(true)
            .addServiceUuid(ParcelUuid(BLEConstants.SERVICE_UUID))
            .build()
        
        bleAdvertiser?.startAdvertising(settings, data, advertiseCallback)
        isAdvertising = true
    }
    
    private fun stopAdvertising() {
        if (isAdvertising) {
            bleAdvertiser?.stopAdvertising(advertiseCallback)
            isAdvertising = false
        }
    }
    
    private fun startScanning() {
        val settings = ScanSettings.Builder()
            .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
            .build()
        
        val filter = ScanFilter.Builder()
            .setServiceUuid(ParcelUuid(BLEConstants.SERVICE_UUID))
            .build()
        
        bleScanner?.startScan(listOf(filter), settings, scanCallback)
        isScanning = true
    }
    
    private fun stopScanning() {
        if (isScanning) {
            bleScanner?.stopScan(scanCallback)
            isScanning = false
        }
    }
    
    private fun updateAdvertisement() {
        if (isAdvertising) {
            stopAdvertising()
            startAdvertising()
        }
    }
    
    private fun startWriteWorker() {
        scope.launch {
            for ((gatt, characteristic, data) in writeChannel) {
                characteristic.value = data
                gatt.writeCharacteristic(characteristic)
                delay(50) // Small delay between writes
            }
        }
    }
    
    private suspend fun sendChunked(
        data: ByteArray,
        gatt: BluetoothGatt,
        characteristic: BluetoothGattCharacteristic,
        mtu: Int
    ) {
        // Prepend length header
        val framedData = ByteBuffer.allocate(4 + data.size)
            .order(ByteOrder.BIG_ENDIAN)
            .putInt(data.size)
            .put(data)
            .array()
        
        val chunkSize = minOf(BLEConstants.CHUNK_SIZE, mtu - 3)
        var offset = 0
        
        while (offset < framedData.size) {
            val end = minOf(offset + chunkSize, framedData.size)
            val chunk = framedData.copyOfRange(offset, end)
            writeChannel.send(Triple(gatt, characteristic, chunk))
            offset = end
        }
    }
    
    private fun handleReceivedData(data: ByteArray, peer: BLEPeerState) {
        peer.pendingData = peer.pendingData + data
        
        // Check if we have the length header
        if (peer.expectedLength == 0 && peer.pendingData.size >= 4) {
            peer.expectedLength = ByteBuffer.wrap(peer.pendingData, 0, 4)
                .order(ByteOrder.BIG_ENDIAN)
                .getInt()
            peer.pendingData = peer.pendingData.copyOfRange(4, peer.pendingData.size)
        }
        
        // Check if we have complete message
        if (peer.expectedLength > 0 && peer.pendingData.size >= peer.expectedLength) {
            val message = peer.pendingData.copyOfRange(0, peer.expectedLength)
            scope.launch {
                _events.emit(TransportEvent.MessageReceived(message, peer.device.address))
            }
            
            // Reset for next message
            peer.pendingData = peer.pendingData.copyOfRange(peer.expectedLength, peer.pendingData.size)
            peer.expectedLength = 0
        }
    }
    
    private fun getConnectionState(gatt: BluetoothGatt): Int {
        return bluetoothManager?.getConnectionState(gatt.device, BluetoothProfile.GATT) 
            ?: BluetoothProfile.STATE_DISCONNECTED
    }
    
    // MARK: - Callbacks
    
    private val scanCallback = object : ScanCallback() {
        override fun onScanResult(callbackType: Int, result: ScanResult) {
            val device = result.device
            val peerId = device.address
            
            if (!peers.containsKey(peerId)) {
                val peerState = BLEPeerState(device)
                peers[peerId] = peerState
                
                scope.launch {
                    val info = PeerInfo(
                        id = peerId,
                        transportType = TransportType.BLE,
                        signalStrength = result.rssi,
                        displayName = device.name
                    )
                    _events.emit(TransportEvent.PeerDiscovered(info))
                }
            }
        }
        
        override fun onScanFailed(errorCode: Int) {
            scope.launch {
                _events.emit(TransportEvent.Error(IllegalStateException("Scan failed: $errorCode")))
            }
        }
    }
    
    private val advertiseCallback = object : AdvertiseCallback() {
        override fun onStartSuccess(settingsInEffect: AdvertiseSettings) {
            // Advertising started successfully
        }
        
        override fun onStartFailure(errorCode: Int) {
            scope.launch {
                _events.emit(TransportEvent.Error(IllegalStateException("Advertise failed: $errorCode")))
            }
        }
    }
    
    private val gattCallback = object : BluetoothGattCallback() {
        override fun onConnectionStateChange(gatt: BluetoothGatt, status: Int, newState: Int) {
            val peerId = gatt.device.address
            val peer = peers[peerId] ?: return
            
            when (newState) {
                BluetoothProfile.STATE_CONNECTED -> {
                    gatt.requestMtu(BLEConstants.MAX_MTU)
                    gatt.discoverServices()
                }
                BluetoothProfile.STATE_DISCONNECTED -> {
                    peer.isHandshakeComplete = false
                    peer.gatt = null
                    scope.launch {
                        _events.emit(TransportEvent.PeerDisconnected(peerId))
                    }
                }
            }
        }
        
        override fun onMtuChanged(gatt: BluetoothGatt, mtu: Int, status: Int) {
            val peer = peers[gatt.device.address] ?: return
            peer.mtu = mtu
        }
        
        override fun onServicesDiscovered(gatt: BluetoothGatt, status: Int) {
            if (status != BluetoothGatt.GATT_SUCCESS) return
            
            val service = gatt.getService(BLEConstants.SERVICE_UUID) ?: return
            val peer = peers[gatt.device.address] ?: return
            
            service.characteristics.forEach { char ->
                peer.characteristics[char.uuid] = char
                
                // Subscribe to notifications
                if (char.uuid == BLEConstants.BUNDLE_NOTIFY_CHARACTERISTIC) {
                    gatt.setCharacteristicNotification(char, true)
                    char.getDescriptor(UUID.fromString("00002902-0000-1000-8000-00805f9b34fb"))?.let { desc ->
                        desc.value = BluetoothGattDescriptor.ENABLE_INDICATION_VALUE
                        gatt.writeDescriptor(desc)
                    }
                }
                
                // Read node ID
                if (char.uuid == BLEConstants.NODE_ID_CHARACTERISTIC) {
                    gatt.readCharacteristic(char)
                }
            }
            
            peer.isHandshakeComplete = true
            scope.launch {
                _events.emit(TransportEvent.PeerConnected(peerInfo(peer)))
            }
        }
        
        override fun onCharacteristicRead(
            gatt: BluetoothGatt,
            characteristic: BluetoothGattCharacteristic,
            status: Int
        ) {
            if (status != BluetoothGatt.GATT_SUCCESS) return
            
            val peer = peers[gatt.device.address] ?: return
            
            when (characteristic.uuid) {
                BLEConstants.NODE_ID_CHARACTERISTIC -> {
                    peer.nodeId = characteristic.value?.toHexString()
                }
            }
        }
        
        override fun onCharacteristicChanged(
            gatt: BluetoothGatt,
            characteristic: BluetoothGattCharacteristic
        ) {
            val peer = peers[gatt.device.address] ?: return
            val data = characteristic.value ?: return
            
            when (characteristic.uuid) {
                BLEConstants.BUNDLE_NOTIFY_CHARACTERISTIC, 
                BLEConstants.BUNDLE_WRITE_CHARACTERISTIC -> {
                    handleReceivedData(data, peer)
                }
            }
        }
    }
    
    private val gattServerCallback = object : BluetoothGattServerCallback() {
        override fun onConnectionStateChange(device: BluetoothDevice, status: Int, newState: Int) {
            // Handle incoming connections
        }
        
        override fun onCharacteristicReadRequest(
            device: BluetoothDevice,
            requestId: Int,
            offset: Int,
            characteristic: BluetoothGattCharacteristic
        ) {
            when (characteristic.uuid) {
                BLEConstants.NODE_ID_CHARACTERISTIC -> {
                    gattServer?.sendResponse(
                        device,
                        requestId,
                        BluetoothGatt.GATT_SUCCESS,
                        offset,
                        nodeId
                    )
                }
                else -> {
                    gattServer?.sendResponse(
                        device,
                        requestId,
                        BluetoothGatt.GATT_FAILURE,
                        offset,
                        null
                    )
                }
            }
        }
        
        override fun onCharacteristicWriteRequest(
            device: BluetoothDevice,
            requestId: Int,
            characteristic: BluetoothGattCharacteristic,
            preparedWrite: Boolean,
            responseNeeded: Boolean,
            offset: Int,
            value: ByteArray
        ) {
            when (characteristic.uuid) {
                BLEConstants.BUNDLE_WRITE_CHARACTERISTIC -> {
                    scope.launch {
                        _events.emit(TransportEvent.MessageReceived(value, device.address))
                    }
                    if (responseNeeded) {
                        gattServer?.sendResponse(
                            device,
                            requestId,
                            BluetoothGatt.GATT_SUCCESS,
                            offset,
                            null
                        )
                    }
                }
                else -> {
                    if (responseNeeded) {
                        gattServer?.sendResponse(
                            device,
                            requestId,
                            BluetoothGatt.GATT_SUCCESS,
                            offset,
                            null
                        )
                    }
                }
            }
        }
    }
}
