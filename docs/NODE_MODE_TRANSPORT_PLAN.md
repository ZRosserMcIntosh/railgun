# Railgun Node Mode - Mobile Transport Implementation Plan

**Version:** 1.0.0  
**Date:** January 12, 2026  
**Status:** Implementation Planning

---

## 1. Overview

This document details the platform-specific implementation approach for Node Mode transports on iOS and Android, including workarounds for OS restrictions.

---

## 2. iOS Implementation

### 2.1 Transport Options

| Transport | Background Support | Range | Bandwidth | Battery |
|-----------|-------------------|-------|-----------|---------|
| Bluetooth LE | Limited | ~10m | ~1 Mbps | Low |
| Multipeer Connectivity | Limited | ~30m | ~10 Mbps | Medium |
| Local Network (Wi-Fi) | None | LAN | ~100 Mbps | Medium |
| iBeacon Regions | Yes | ~50m | Notify only | Very Low |

### 2.2 Core Bluetooth Implementation

#### 2.2.1 Peripheral Mode (Advertising as Node)

```swift
import CoreBluetooth

class NodePeripheralManager: NSObject, CBPeripheralManagerDelegate {
    
    // Service and characteristic UUIDs
    static let serviceUUID = CBUUID(string: "7A1B2C3D-4E5F-6A7B-8C9D-0E1F2A3B4C5D")
    static let nodeAnnounceUUID = CBUUID(string: "7A1B2C3D-4E5F-6A7B-8C9D-0E1F2A3B4C5E")
    static let bundleTransferUUID = CBUUID(string: "7A1B2C3D-4E5F-6A7B-8C9D-0E1F2A3B4C5F")
    static let syncControlUUID = CBUUID(string: "7A1B2C3D-4E5F-6A7B-8C9D-0E1F2A3B4C60")
    
    private var peripheralManager: CBPeripheralManager!
    private var nodeAnnounceCharacteristic: CBMutableCharacteristic!
    private var bundleTransferCharacteristic: CBMutableCharacteristic!
    
    func startAdvertising() {
        peripheralManager = CBPeripheralManager(delegate: self, queue: nil)
    }
    
    func peripheralManagerDidUpdateState(_ peripheral: CBPeripheralManager) {
        guard peripheral.state == .poweredOn else { return }
        
        // Create characteristics
        nodeAnnounceCharacteristic = CBMutableCharacteristic(
            type: Self.nodeAnnounceUUID,
            properties: [.read, .notify],
            value: nil,
            permissions: [.readable]
        )
        
        bundleTransferCharacteristic = CBMutableCharacteristic(
            type: Self.bundleTransferUUID,
            properties: [.write, .notify, .writeWithoutResponse],
            value: nil,
            permissions: [.writeable]
        )
        
        let syncControlCharacteristic = CBMutableCharacteristic(
            type: Self.syncControlUUID,
            properties: [.read, .write, .notify],
            value: nil,
            permissions: [.readable, .writeable]
        )
        
        // Create service
        let service = CBMutableService(type: Self.serviceUUID, primary: true)
        service.characteristics = [
            nodeAnnounceCharacteristic,
            bundleTransferCharacteristic,
            syncControlCharacteristic
        ]
        
        peripheralManager.add(service)
        
        // Start advertising
        peripheralManager.startAdvertising([
            CBAdvertisementDataServiceUUIDsKey: [Self.serviceUUID],
            CBAdvertisementDataLocalNameKey: "Railgun-\(shortNodeId)"
        ])
    }
    
    func peripheralManager(_ peripheral: CBPeripheralManager,
                          didReceiveWrite requests: [CBATTRequest]) {
        for request in requests {
            if request.characteristic.uuid == Self.bundleTransferUUID {
                if let data = request.value {
                    handleIncomingFragment(data)
                }
                peripheral.respond(to: request, withResult: .success)
            }
        }
    }
}
```

#### 2.2.2 Central Mode (Discovering Nodes)

```swift
class NodeCentralManager: NSObject, CBCentralManagerDelegate, CBPeripheralDelegate {
    
    private var centralManager: CBCentralManager!
    private var discoveredPeripherals: [CBPeripheral] = []
    private var connectedPeripherals: [UUID: CBPeripheral] = [:]
    
    func startScanning() {
        centralManager = CBCentralManager(delegate: self, queue: nil)
    }
    
    func centralManagerDidUpdateState(_ central: CBCentralManager) {
        guard central.state == .poweredOn else { return }
        
        // Scan for Railgun nodes
        centralManager.scanForPeripherals(
            withServices: [NodePeripheralManager.serviceUUID],
            options: [CBCentralManagerScanOptionAllowDuplicatesKey: false]
        )
    }
    
    func centralManager(_ central: CBCentralManager,
                       didDiscover peripheral: CBPeripheral,
                       advertisementData: [String: Any],
                       rssi RSSI: NSNumber) {
        
        guard !discoveredPeripherals.contains(peripheral) else { return }
        discoveredPeripherals.append(peripheral)
        
        // Connect if we have capacity
        if connectedPeripherals.count < maxPeers {
            centralManager.connect(peripheral, options: nil)
        }
    }
    
    func centralManager(_ central: CBCentralManager,
                       didConnect peripheral: CBPeripheral) {
        connectedPeripherals[peripheral.identifier] = peripheral
        peripheral.delegate = self
        peripheral.discoverServices([NodePeripheralManager.serviceUUID])
    }
    
    func peripheral(_ peripheral: CBPeripheral,
                   didDiscoverCharacteristicsFor service: CBService,
                   error: Error?) {
        guard let characteristics = service.characteristics else { return }
        
        for characteristic in characteristics {
            if characteristic.properties.contains(.notify) {
                peripheral.setNotifyValue(true, for: characteristic)
            }
        }
        
        // Start sync protocol
        startSync(with: peripheral)
    }
}
```

### 2.3 Multipeer Connectivity Implementation

```swift
import MultipeerConnectivity

class MultipeerTransport: NSObject {
    
    private let serviceType = "railgun-mesh"
    private var peerID: MCPeerID!
    private var session: MCSession!
    private var browser: MCNearbyServiceBrowser!
    private var advertiser: MCNearbyServiceAdvertiser!
    
    func start(nodeId: String) {
        peerID = MCPeerID(displayName: "Railgun-\(nodeId.prefix(8))")
        
        session = MCSession(
            peer: peerID,
            securityIdentity: nil,  // We handle our own crypto
            encryptionPreference: .required
        )
        session.delegate = self
        
        // Discovery info
        let discoveryInfo: [String: String] = [
            "v": "1",
            "cap": String(format: "%04X", capabilities),
            "bc": String(bundleCount)
        ]
        
        // Advertise
        advertiser = MCNearbyServiceAdvertiser(
            peer: peerID,
            discoveryInfo: discoveryInfo,
            serviceType: serviceType
        )
        advertiser.delegate = self
        advertiser.startAdvertisingPeer()
        
        // Browse
        browser = MCNearbyServiceBrowser(peer: peerID, serviceType: serviceType)
        browser.delegate = self
        browser.startBrowsingForPeers()
    }
    
    func sendBundle(_ bundle: Data, to peer: MCPeerID) throws {
        try session.send(bundle, toPeers: [peer], with: .reliable)
    }
}

extension MultipeerTransport: MCSessionDelegate {
    func session(_ session: MCSession, didReceive data: Data, fromPeer peerID: MCPeerID) {
        handleIncomingData(data, from: peerID)
    }
    
    func session(_ session: MCSession, peer peerID: MCPeerID, 
                 didChange state: MCSessionState) {
        switch state {
        case .connected:
            initiateSync(with: peerID)
        case .notConnected:
            handleDisconnect(peerID)
        default:
            break
        }
    }
}

extension MultipeerTransport: MCNearbyServiceBrowserDelegate {
    func browser(_ browser: MCNearbyServiceBrowser,
                 foundPeer peerID: MCPeerID,
                 withDiscoveryInfo info: [String: String]?) {
        
        // Invite peer to session
        browser.invitePeer(
            peerID,
            to: session,
            withContext: nodeAnnounceData,
            timeout: 30
        )
    }
}
```

### 2.4 Background Execution Strategy

```swift
import BackgroundTasks
import CoreLocation

class BackgroundManager {
    
    static let syncTaskIdentifier = "app.railgun.nodemode.sync"
    
    // MARK: - Background Task Scheduler
    
    func registerBackgroundTasks() {
        BGTaskScheduler.shared.register(
            forTaskWithIdentifier: Self.syncTaskIdentifier,
            using: nil
        ) { task in
            self.handleBackgroundSync(task: task as! BGProcessingTask)
        }
    }
    
    func scheduleBackgroundSync() {
        let request = BGProcessingTaskRequest(identifier: Self.syncTaskIdentifier)
        request.requiresNetworkConnectivity = false
        request.requiresExternalPower = false
        request.earliestBeginDate = Date(timeIntervalSinceNow: 15 * 60) // 15 min
        
        try? BGTaskScheduler.shared.submit(request)
    }
    
    func handleBackgroundSync(task: BGProcessingTask) {
        // Create operation queue
        let queue = OperationQueue()
        queue.maxConcurrentOperationCount = 1
        
        let syncOperation = NodeSyncOperation()
        
        task.expirationHandler = {
            queue.cancelAllOperations()
        }
        
        syncOperation.completionBlock = {
            task.setTaskCompleted(success: !syncOperation.isCancelled)
            self.scheduleBackgroundSync() // Schedule next
        }
        
        queue.addOperation(syncOperation)
    }
    
    // MARK: - Location-Based Wake
    
    private var locationManager: CLLocationManager!
    
    func setupLocationBasedWake() {
        locationManager = CLLocationManager()
        locationManager.delegate = self
        locationManager.allowsBackgroundLocationUpdates = true
        
        // Use significant location changes for background wake
        locationManager.startMonitoringSignificantLocationChanges()
    }
    
    // MARK: - iBeacon Region Monitoring
    
    func setupBeaconRegions() {
        // Monitor for other Railgun nodes using iBeacon
        let uuid = UUID(uuidString: "7A1B2C3D-4E5F-6A7B-8C9D-0E1F2A3B4C5D")!
        let region = CLBeaconRegion(
            uuid: uuid,
            identifier: "railgun-nodes"
        )
        region.notifyOnEntry = true
        region.notifyOnExit = true
        region.notifyEntryStateOnDisplay = true
        
        locationManager.startMonitoring(for: region)
    }
}

extension BackgroundManager: CLLocationManagerDelegate {
    func locationManager(_ manager: CLLocationManager,
                        didEnterRegion region: CLRegion) {
        // Another Railgun node is nearby, wake up and sync
        NodeModeManager.shared.performQuickSync()
    }
}
```

### 2.5 iOS Constraints Summary

| Constraint | Solution |
|------------|----------|
| 30s background execution | BGProcessingTask, location updates |
| No persistent BLE connections | Reconnect on wake, use notifications |
| App must be foreground for scanning | iBeacon regions for background |
| No raw Wi-Fi | Multipeer Connectivity framework |

---

## 3. Android Implementation

### 3.1 Transport Options

| Transport | Background Support | Range | Bandwidth | Battery |
|-----------|-------------------|-------|-----------|---------|
| Bluetooth LE | Yes (Foreground Service) | ~10m | ~1 Mbps | Low |
| Wi-Fi P2P | Yes (Foreground Service) | ~50m | ~10 Mbps | Medium |
| Local Network | Yes (Foreground Service) | LAN | ~100 Mbps | Medium |
| Nearby Connections | Yes | ~100m | Variable | Medium |

### 3.2 Bluetooth LE Implementation

```kotlin
package com.railgun.android.nodemode.transport

import android.bluetooth.*
import android.bluetooth.le.*
import android.content.Context
import kotlinx.coroutines.flow.MutableStateFlow
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class BleTransport @Inject constructor(
    private val context: Context
) {
    companion object {
        val SERVICE_UUID: UUID = UUID.fromString("7A1B2C3D-4E5F-6A7B-8C9D-0E1F2A3B4C5D")
        val NODE_ANNOUNCE_UUID: UUID = UUID.fromString("7A1B2C3D-4E5F-6A7B-8C9D-0E1F2A3B4C5E")
        val BUNDLE_TRANSFER_UUID: UUID = UUID.fromString("7A1B2C3D-4E5F-6A7B-8C9D-0E1F2A3B4C5F")
        val SYNC_CONTROL_UUID: UUID = UUID.fromString("7A1B2C3D-4E5F-6A7B-8C9D-0E1F2A3B4C60")
    }
    
    private val bluetoothManager = context.getSystemService(BluetoothManager::class.java)
    private val bluetoothAdapter = bluetoothManager.adapter
    
    private var gattServer: BluetoothGattServer? = null
    private var advertiser: BluetoothLeAdvertiser? = null
    private var scanner: BluetoothLeScanner? = null
    
    private val connectedDevices = MutableStateFlow<Set<BluetoothDevice>>(emptySet())
    
    // MARK: - GATT Server (Peripheral Mode)
    
    fun startGattServer(nodeAnnounce: ByteArray) {
        gattServer = bluetoothManager.openGattServer(context, gattServerCallback)
        
        val service = BluetoothGattService(
            SERVICE_UUID,
            BluetoothGattService.SERVICE_TYPE_PRIMARY
        )
        
        val nodeAnnounceChar = BluetoothGattCharacteristic(
            NODE_ANNOUNCE_UUID,
            BluetoothGattCharacteristic.PROPERTY_READ or BluetoothGattCharacteristic.PROPERTY_NOTIFY,
            BluetoothGattCharacteristic.PERMISSION_READ
        )
        nodeAnnounceChar.value = nodeAnnounce
        
        val bundleTransferChar = BluetoothGattCharacteristic(
            BUNDLE_TRANSFER_UUID,
            BluetoothGattCharacteristic.PROPERTY_WRITE or 
                BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE or
                BluetoothGattCharacteristic.PROPERTY_NOTIFY,
            BluetoothGattCharacteristic.PERMISSION_WRITE
        )
        
        val syncControlChar = BluetoothGattCharacteristic(
            SYNC_CONTROL_UUID,
            BluetoothGattCharacteristic.PROPERTY_READ or 
                BluetoothGattCharacteristic.PROPERTY_WRITE or
                BluetoothGattCharacteristic.PROPERTY_NOTIFY,
            BluetoothGattCharacteristic.PERMISSION_READ or BluetoothGattCharacteristic.PERMISSION_WRITE
        )
        
        service.addCharacteristic(nodeAnnounceChar)
        service.addCharacteristic(bundleTransferChar)
        service.addCharacteristic(syncControlChar)
        
        gattServer?.addService(service)
    }
    
    private val gattServerCallback = object : BluetoothGattServerCallback() {
        override fun onConnectionStateChange(device: BluetoothDevice, status: Int, newState: Int) {
            when (newState) {
                BluetoothProfile.STATE_CONNECTED -> {
                    connectedDevices.value = connectedDevices.value + device
                }
                BluetoothProfile.STATE_DISCONNECTED -> {
                    connectedDevices.value = connectedDevices.value - device
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
                BUNDLE_TRANSFER_UUID -> {
                    handleIncomingFragment(device, value)
                }
                SYNC_CONTROL_UUID -> {
                    handleSyncControl(device, value)
                }
            }
            
            if (responseNeeded) {
                gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, 0, null)
            }
        }
    }
    
    // MARK: - Advertising
    
    fun startAdvertising() {
        advertiser = bluetoothAdapter.bluetoothLeAdvertiser
        
        val settings = AdvertiseSettings.Builder()
            .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY)
            .setConnectable(true)
            .setTimeout(0)
            .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_HIGH)
            .build()
        
        val data = AdvertiseData.Builder()
            .setIncludeDeviceName(true)
            .addServiceUuid(ParcelUuid(SERVICE_UUID))
            .build()
        
        advertiser?.startAdvertising(settings, data, advertiseCallback)
    }
    
    // MARK: - Scanning
    
    fun startScanning() {
        scanner = bluetoothAdapter.bluetoothLeScanner
        
        val filters = listOf(
            ScanFilter.Builder()
                .setServiceUuid(ParcelUuid(SERVICE_UUID))
                .build()
        )
        
        val settings = ScanSettings.Builder()
            .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
            .setMatchMode(ScanSettings.MATCH_MODE_AGGRESSIVE)
            .setCallbackType(ScanSettings.CALLBACK_TYPE_ALL_MATCHES)
            .build()
        
        scanner?.startScan(filters, settings, scanCallback)
    }
    
    private val scanCallback = object : ScanCallback() {
        override fun onScanResult(callbackType: Int, result: ScanResult) {
            handleDiscoveredNode(result.device, result.rssi)
        }
    }
}
```

### 3.3 Wi-Fi P2P Implementation

```kotlin
package com.railgun.android.nodemode.transport

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.wifi.p2p.*
import android.net.wifi.p2p.nsd.WifiP2pDnsSdServiceInfo
import android.net.wifi.p2p.nsd.WifiP2pDnsSdServiceRequest
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.MutableStateFlow
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class WifiP2pTransport @Inject constructor(
    private val context: Context
) {
    companion object {
        const val SERVICE_TYPE = "_railgun._tcp"
        const val PORT = 7847
    }
    
    private val wifiP2pManager = context.getSystemService(WifiP2pManager::class.java)
    private var channel: WifiP2pManager.Channel? = null
    
    private val discoveredPeers = MutableStateFlow<List<WifiP2pDevice>>(emptyList())
    private val groupInfo = MutableStateFlow<WifiP2pGroup?>(null)
    
    // MARK: - Initialize
    
    fun initialize() {
        channel = wifiP2pManager.initialize(context, context.mainLooper, null)
        registerReceiver()
    }
    
    private fun registerReceiver() {
        val filter = IntentFilter().apply {
            addAction(WifiP2pManager.WIFI_P2P_STATE_CHANGED_ACTION)
            addAction(WifiP2pManager.WIFI_P2P_PEERS_CHANGED_ACTION)
            addAction(WifiP2pManager.WIFI_P2P_CONNECTION_CHANGED_ACTION)
            addAction(WifiP2pManager.WIFI_P2P_THIS_DEVICE_CHANGED_ACTION)
        }
        context.registerReceiver(wifiP2pReceiver, filter)
    }
    
    private val wifiP2pReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            when (intent.action) {
                WifiP2pManager.WIFI_P2P_PEERS_CHANGED_ACTION -> {
                    requestPeers()
                }
                WifiP2pManager.WIFI_P2P_CONNECTION_CHANGED_ACTION -> {
                    val networkInfo = intent.getParcelableExtra<android.net.NetworkInfo>(
                        WifiP2pManager.EXTRA_NETWORK_INFO
                    )
                    if (networkInfo?.isConnected == true) {
                        wifiP2pManager.requestGroupInfo(channel) { group ->
                            groupInfo.value = group
                            if (group.isGroupOwner) {
                                startServer()
                            } else {
                                connectToGroupOwner(group.owner.deviceAddress)
                            }
                        }
                    }
                }
            }
        }
    }
    
    // MARK: - Service Discovery
    
    fun registerService(nodeId: String, capabilities: Int, bundleCount: Int) {
        val record = mapOf(
            "v" to "1",
            "node" to nodeId.take(16),
            "cap" to capabilities.toString(16),
            "bc" to bundleCount.toString()
        )
        
        val serviceInfo = WifiP2pDnsSdServiceInfo.newInstance(
            "railgun-${nodeId.take(8)}",
            SERVICE_TYPE,
            record
        )
        
        wifiP2pManager.addLocalService(channel, serviceInfo, object : WifiP2pManager.ActionListener {
            override fun onSuccess() {}
            override fun onFailure(reason: Int) {}
        })
    }
    
    fun discoverServices() {
        val serviceRequest = WifiP2pDnsSdServiceRequest.newInstance()
        
        wifiP2pManager.setDnsSdResponseListeners(channel,
            { instanceName, registrationType, device ->
                // Service discovered
                handleDiscoveredService(device)
            },
            { fullDomainName, txtRecordMap, device ->
                // TXT record available
                handleServiceInfo(device, txtRecordMap)
            }
        )
        
        wifiP2pManager.addServiceRequest(channel, serviceRequest, object : WifiP2pManager.ActionListener {
            override fun onSuccess() {
                wifiP2pManager.discoverServices(channel, object : WifiP2pManager.ActionListener {
                    override fun onSuccess() {}
                    override fun onFailure(reason: Int) {}
                })
            }
            override fun onFailure(reason: Int) {}
        })
    }
    
    // MARK: - TCP Server/Client
    
    private var serverSocket: ServerSocket? = null
    
    private fun startServer() {
        Thread {
            serverSocket = ServerSocket(PORT)
            while (!Thread.interrupted()) {
                try {
                    val client = serverSocket?.accept() ?: break
                    handleClientConnection(client)
                } catch (e: Exception) {
                    break
                }
            }
        }.start()
    }
    
    private fun connectToGroupOwner(address: String) {
        Thread {
            try {
                val socket = Socket()
                socket.connect(InetSocketAddress(address, PORT), 5000)
                handleConnection(socket)
            } catch (e: Exception) {
                // Retry or report failure
            }
        }.start()
    }
}
```

### 3.4 Foreground Service

```kotlin
package com.railgun.android.nodemode.service

import android.app.*
import android.content.Intent
import android.os.IBinder
import androidx.core.app.NotificationCompat
import com.railgun.android.R
import com.railgun.android.nodemode.NodeModeManager
import dagger.hilt.android.AndroidEntryPoint
import javax.inject.Inject

@AndroidEntryPoint
class NodeModeService : Service() {
    
    companion object {
        const val NOTIFICATION_ID = 1001
        const val CHANNEL_ID = "node_mode_channel"
        
        const val ACTION_START = "com.railgun.nodemode.START"
        const val ACTION_STOP = "com.railgun.nodemode.STOP"
    }
    
    @Inject
    lateinit var nodeModeManager: NodeModeManager
    
    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
    }
    
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START -> startNodeMode()
            ACTION_STOP -> stopNodeMode()
        }
        return START_STICKY
    }
    
    private fun startNodeMode() {
        val notification = createNotification()
        startForeground(NOTIFICATION_ID, notification)
        
        nodeModeManager.start()
    }
    
    private fun stopNodeMode() {
        nodeModeManager.stop()
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }
    
    private fun createNotificationChannel() {
        val channel = NotificationChannel(
            CHANNEL_ID,
            "Node Mode",
            NotificationManager.IMPORTANCE_LOW
        ).apply {
            description = "Railgun mesh networking is active"
            setShowBadge(false)
        }
        
        val notificationManager = getSystemService(NotificationManager::class.java)
        notificationManager.createNotificationChannel(channel)
    }
    
    private fun createNotification(): Notification {
        val pendingIntent = PendingIntent.getActivity(
            this,
            0,
            packageManager.getLaunchIntentForPackage(packageName),
            PendingIntent.FLAG_IMMUTABLE
        )
        
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Node Mode Active")
            .setContentText("Mesh networking enabled")
            .setSmallIcon(R.drawable.ic_node_mode)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .build()
    }
    
    override fun onBind(intent: Intent?): IBinder? = null
}
```

### 3.5 WorkManager for Background Tasks

```kotlin
package com.railgun.android.nodemode.worker

import android.content.Context
import androidx.hilt.work.HiltWorker
import androidx.work.*
import com.railgun.android.nodemode.NodeModeManager
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject
import java.util.concurrent.TimeUnit

@HiltWorker
class NodeSyncWorker @AssistedInject constructor(
    @Assisted context: Context,
    @Assisted params: WorkerParameters,
    private val nodeModeManager: NodeModeManager
) : CoroutineWorker(context, params) {
    
    companion object {
        const val WORK_NAME = "node_sync_work"
        
        fun schedule(context: Context) {
            val constraints = Constraints.Builder()
                .setRequiresBatteryNotLow(true)
                .build()
            
            val request = PeriodicWorkRequestBuilder<NodeSyncWorker>(
                15, TimeUnit.MINUTES
            )
                .setConstraints(constraints)
                .setBackoffCriteria(
                    BackoffPolicy.EXPONENTIAL,
                    1, TimeUnit.MINUTES
                )
                .build()
            
            WorkManager.getInstance(context)
                .enqueueUniquePeriodicWork(
                    WORK_NAME,
                    ExistingPeriodicWorkPolicy.KEEP,
                    request
                )
        }
    }
    
    override suspend fun doWork(): Result {
        return try {
            nodeModeManager.performSync()
            Result.success()
        } catch (e: Exception) {
            if (runAttemptCount < 3) {
                Result.retry()
            } else {
                Result.failure()
            }
        }
    }
}
```

### 3.6 Android Constraints Summary

| Constraint | Solution |
|------------|----------|
| Doze mode | Foreground service, WorkManager |
| Battery optimization | Request exemption, use efficient scanning |
| Location permission for Wi-Fi P2P | Clear explanation in UI |
| Manufacturer restrictions | Detect and adapt, fallback to BLE |

---

## 4. Cross-Platform Considerations

### 4.1 Common Interface

```kotlin
// Android
interface MeshTransport {
    fun start()
    fun stop()
    fun isActive(): Boolean
    fun getPeers(): Flow<List<MeshPeer>>
    fun sendBundle(peer: MeshPeer, bundle: ByteArray): Result<Unit>
    fun onBundleReceived(): Flow<Pair<MeshPeer, ByteArray>>
}
```

```swift
// iOS
protocol MeshTransport {
    func start()
    func stop()
    var isActive: Bool { get }
    var peers: AnyPublisher<[MeshPeer], Never> { get }
    func sendBundle(_ bundle: Data, to peer: MeshPeer) async throws
    var bundleReceived: AnyPublisher<(MeshPeer, Data), Never> { get }
}
```

### 4.2 Interoperability

Both platforms use identical:
- Service UUIDs
- Bundle format
- Sync protocol
- Fragmentation protocol

### 4.3 Testing Matrix

| Scenario | iOS → iOS | Android → Android | iOS → Android |
|----------|-----------|-------------------|---------------|
| BLE discovery | ✅ | ✅ | ✅ |
| BLE transfer | ✅ | ✅ | ✅ |
| Wi-Fi Direct | Via MPC | Via P2P | ❌ (incompatible) |
| Local network | ✅ | ✅ | ✅ |

---

## 5. Implementation Timeline

### Phase 1: Foundation (Week 1-2)

- [ ] iOS: CoreBluetooth transport
- [ ] Android: BLE transport
- [ ] Cross-platform BLE testing
- [ ] Bundle format implementation

### Phase 2: Local Network (Week 3)

- [ ] iOS: mDNS discovery + TCP
- [ ] Android: NSD discovery + TCP
- [ ] Cross-platform network testing

### Phase 3: Platform-Specific (Week 4)

- [ ] iOS: Multipeer Connectivity
- [ ] Android: Wi-Fi P2P
- [ ] Background execution

### Phase 4: Integration (Week 5-6)

- [ ] Integrate with message store
- [ ] Routing algorithms
- [ ] Gateway mode
- [ ] Full integration testing
