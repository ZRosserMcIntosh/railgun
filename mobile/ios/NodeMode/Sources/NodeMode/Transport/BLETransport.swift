//
//  BLETransport.swift
//  RailGun Node Mode
//
//  Bluetooth Low Energy transport for mesh communication
//

import Foundation
import CoreBluetooth
import Combine

// MARK: - BLE UUIDs

private enum BLEConstants {
    /// Service UUID for Node Mode
    static let serviceUUID = CBUUID(string: "B9E5F7A0-1234-5678-9ABC-DEF012345678")
    
    /// Characteristic for node ID advertisement
    static let nodeIdCharacteristicUUID = CBUUID(string: "B9E5F7A1-1234-5678-9ABC-DEF012345678")
    
    /// Characteristic for bundle transfer (write with response)
    static let bundleWriteCharacteristicUUID = CBUUID(string: "B9E5F7A2-1234-5678-9ABC-DEF012345678")
    
    /// Characteristic for bundle notification (indicate)
    static let bundleNotifyCharacteristicUUID = CBUUID(string: "B9E5F7A3-1234-5678-9ABC-DEF012345678")
    
    /// Characteristic for handshake
    static let handshakeCharacteristicUUID = CBUUID(string: "B9E5F7A4-1234-5678-9ABC-DEF012345678")
    
    /// Maximum MTU for BLE (will be negotiated)
    static let maxMTU = 512
    
    /// Chunk size for large transfers
    static let chunkSize = 182  // Safe for most devices
    
    /// Connection timeout
    static let connectionTimeout: TimeInterval = 10.0
}

// MARK: - BLE Peer State

private class BLEPeerState {
    let peripheral: CBPeripheral
    var characteristics: [CBUUID: CBCharacteristic] = [:]
    var isHandshakeComplete = false
    var nodeId: String?
    var pendingData = Data()
    var expectedLength: Int = 0
    
    init(peripheral: CBPeripheral) {
        self.peripheral = peripheral
    }
}

// MARK: - BLE Transport

public class BLETransport: NSObject, Transport {
    
    // MARK: - Transport Protocol
    
    public let transportType: TransportType = .ble
    
    public private(set) var state: TransportState = .idle {
        didSet {
            eventsSubject.send(.stateChanged(state))
        }
    }
    
    public var events: AnyPublisher<TransportEvent, Never> {
        eventsSubject.eraseToAnyPublisher()
    }
    
    public var discoveredPeers: [PeerInfo] {
        Array(peers.values.map { peerInfo(from: $0) })
    }
    
    public var connectedPeers: [PeerInfo] {
        peers.values
            .filter { $0.peripheral.state == .connected && $0.isHandshakeComplete }
            .map { peerInfo(from: $0) }
    }
    
    // MARK: - Private Properties
    
    private var centralManager: CBCentralManager!
    private var peripheralManager: CBPeripheralManager!
    
    private var peers: [String: BLEPeerState] = [:] // keyed by peripheral identifier
    private var nodeId: Data?
    private var displayName: String = "Railgun Node"
    
    private var nodeIdCharacteristic: CBMutableCharacteristic?
    private var bundleWriteCharacteristic: CBMutableCharacteristic?
    private var bundleNotifyCharacteristic: CBMutableCharacteristic?
    private var handshakeCharacteristic: CBMutableCharacteristic?
    
    private let eventsSubject = PassthroughSubject<TransportEvent, Never>()
    private var isScanning = false
    private var isAdvertising = false
    
    private let queue = DispatchQueue(label: "com.railgun.ble", qos: .userInitiated)
    
    // MARK: - Initialization
    
    public override init() {
        super.init()
    }
    
    // MARK: - Transport Protocol Implementation
    
    public func start() async throws {
        guard state != .running else { return }
        state = .starting
        
        // Initialize managers on the BLE queue
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            queue.async { [weak self] in
                guard let self = self else {
                    continuation.resume()
                    return
                }
                
                self.centralManager = CBCentralManager(delegate: self, queue: self.queue)
                self.peripheralManager = CBPeripheralManager(delegate: self, queue: self.queue)
                
                // Wait a bit for managers to initialize
                self.queue.asyncAfter(deadline: .now() + 0.5) {
                    continuation.resume()
                }
            }
        }
    }
    
    public func stop() async {
        state = .stopping
        
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            queue.async { [weak self] in
                guard let self = self else {
                    continuation.resume()
                    return
                }
                
                // Stop scanning
                if self.isScanning {
                    self.centralManager?.stopScan()
                    self.isScanning = false
                }
                
                // Stop advertising
                if self.isAdvertising {
                    self.peripheralManager?.stopAdvertising()
                    self.peripheralManager?.removeAllServices()
                    self.isAdvertising = false
                }
                
                // Disconnect all peers
                for peer in self.peers.values {
                    if peer.peripheral.state == .connected {
                        self.centralManager?.cancelPeripheralConnection(peer.peripheral)
                    }
                }
                self.peers.removeAll()
                
                self.state = .idle
                continuation.resume()
            }
        }
    }
    
    public func connect(to peerId: String) async throws {
        guard let peer = peers[peerId] else {
            throw TransportError.notConnected
        }
        
        guard peer.peripheral.state != .connected else { return }
        
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            queue.async { [weak self] in
                guard let self = self else {
                    continuation.resume(throwing: TransportError.connectionFailed("Transport deallocated"))
                    return
                }
                
                self.centralManager.connect(peer.peripheral, options: nil)
                
                // Set up timeout
                self.queue.asyncAfter(deadline: .now() + BLEConstants.connectionTimeout) {
                    if peer.peripheral.state != .connected {
                        self.centralManager.cancelPeripheralConnection(peer.peripheral)
                        continuation.resume(throwing: TransportError.timeout)
                    } else {
                        continuation.resume()
                    }
                }
            }
        }
    }
    
    public func disconnect(from peerId: String) async {
        guard let peer = peers[peerId] else { return }
        
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            queue.async { [weak self] in
                self?.centralManager.cancelPeripheralConnection(peer.peripheral)
                continuation.resume()
            }
        }
    }
    
    public func send(_ data: Data, to peerId: String) async throws {
        guard let peer = peers[peerId],
              peer.peripheral.state == .connected,
              let characteristic = peer.characteristics[BLEConstants.bundleWriteCharacteristicUUID] else {
            throw TransportError.notConnected
        }
        
        try await sendChunked(data, to: peer.peripheral, characteristic: characteristic)
    }
    
    public func broadcast(_ data: Data) async throws {
        for peer in peers.values {
            guard peer.peripheral.state == .connected,
                  peer.isHandshakeComplete,
                  let characteristic = peer.characteristics[BLEConstants.bundleWriteCharacteristicUUID] else {
                continue
            }
            
            do {
                try await sendChunked(data, to: peer.peripheral, characteristic: characteristic)
            } catch {
                eventsSubject.send(.error(error))
            }
        }
    }
    
    public func setNodeId(_ nodeId: Data) {
        self.nodeId = nodeId
        updateAdvertisement()
    }
    
    public func setDisplayName(_ name: String) {
        self.displayName = name
        updateAdvertisement()
    }
    
    // MARK: - Private Methods
    
    private func peerInfo(from state: BLEPeerState) -> PeerInfo {
        PeerInfo(
            id: state.peripheral.identifier.uuidString,
            nodeId: state.nodeId,
            transportType: .ble,
            signalStrength: nil,  // RSSI updated during discovery
            displayName: state.peripheral.name
        )
    }
    
    private func startScanning() {
        guard centralManager.state == .poweredOn, !isScanning else { return }
        
        centralManager.scanForPeripherals(
            withServices: [BLEConstants.serviceUUID],
            options: [CBCentralManagerScanOptionAllowDuplicatesKey: false]
        )
        isScanning = true
    }
    
    private func startAdvertising() {
        guard peripheralManager.state == .poweredOn, !isAdvertising else { return }
        
        // Create service
        let service = CBMutableService(type: BLEConstants.serviceUUID, primary: true)
        
        // Node ID characteristic (read)
        nodeIdCharacteristic = CBMutableCharacteristic(
            type: BLEConstants.nodeIdCharacteristicUUID,
            properties: [.read],
            value: nodeId,
            permissions: [.readable]
        )
        
        // Bundle write characteristic (write with response)
        bundleWriteCharacteristic = CBMutableCharacteristic(
            type: BLEConstants.bundleWriteCharacteristicUUID,
            properties: [.write],
            value: nil,
            permissions: [.writeable]
        )
        
        // Bundle notify characteristic (indicate)
        bundleNotifyCharacteristic = CBMutableCharacteristic(
            type: BLEConstants.bundleNotifyCharacteristicUUID,
            properties: [.indicate],
            value: nil,
            permissions: [.readable]
        )
        
        // Handshake characteristic (read/write)
        handshakeCharacteristic = CBMutableCharacteristic(
            type: BLEConstants.handshakeCharacteristicUUID,
            properties: [.read, .write],
            value: nil,
            permissions: [.readable, .writeable]
        )
        
        service.characteristics = [
            nodeIdCharacteristic!,
            bundleWriteCharacteristic!,
            bundleNotifyCharacteristic!,
            handshakeCharacteristic!
        ]
        
        peripheralManager.add(service)
        
        peripheralManager.startAdvertising([
            CBAdvertisementDataServiceUUIDsKey: [BLEConstants.serviceUUID],
            CBAdvertisementDataLocalNameKey: displayName
        ])
        
        isAdvertising = true
    }
    
    private func updateAdvertisement() {
        guard isAdvertising else { return }
        
        queue.async { [weak self] in
            guard let self = self else { return }
            
            // Update node ID characteristic value
            self.nodeIdCharacteristic?.value = self.nodeId
            
            // Restart advertising with new name
            self.peripheralManager.stopAdvertising()
            self.peripheralManager.startAdvertising([
                CBAdvertisementDataServiceUUIDsKey: [BLEConstants.serviceUUID],
                CBAdvertisementDataLocalNameKey: self.displayName
            ])
        }
    }
    
    private func sendChunked(_ data: Data, to peripheral: CBPeripheral, characteristic: CBCharacteristic) async throws {
        // Prepend length header
        var framedData = Data()
        var length = UInt32(data.count).bigEndian
        framedData.append(Data(bytes: &length, count: 4))
        framedData.append(data)
        
        // Send in chunks
        var offset = 0
        let chunkSize = min(BLEConstants.chunkSize, peripheral.maximumWriteValueLength(for: .withResponse))
        
        while offset < framedData.count {
            let end = min(offset + chunkSize, framedData.count)
            let chunk = framedData.subdata(in: offset..<end)
            
            try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
                queue.async {
                    peripheral.writeValue(chunk, for: characteristic, type: .withResponse)
                    // Note: In a full implementation, we'd wait for didWriteValueFor callback
                    continuation.resume()
                }
            }
            
            offset = end
        }
    }
    
    private func handleReceivedData(_ data: Data, from peer: BLEPeerState) {
        // Accumulate data
        peer.pendingData.append(data)
        
        // Check if we have the length header
        if peer.expectedLength == 0 && peer.pendingData.count >= 4 {
            peer.expectedLength = Int(peer.pendingData.prefix(4).withUnsafeBytes { $0.load(as: UInt32.self).bigEndian })
            peer.pendingData = peer.pendingData.dropFirst(4)
        }
        
        // Check if we have complete message
        if peer.expectedLength > 0 && peer.pendingData.count >= peer.expectedLength {
            let message = peer.pendingData.prefix(peer.expectedLength)
            eventsSubject.send(.messageReceived(Data(message), from: peer.peripheral.identifier.uuidString))
            
            // Reset for next message
            peer.pendingData = peer.pendingData.dropFirst(peer.expectedLength)
            peer.expectedLength = 0
        }
    }
}

// MARK: - CBCentralManagerDelegate

extension BLETransport: CBCentralManagerDelegate {
    
    public func centralManagerDidUpdateState(_ central: CBCentralManager) {
        switch central.state {
        case .poweredOn:
            startScanning()
            if state == .starting {
                state = .running
            }
        case .poweredOff:
            state = .error("Bluetooth is powered off")
        case .unauthorized:
            state = .error("Bluetooth unauthorized")
        case .unsupported:
            state = .error("Bluetooth unsupported")
        default:
            break
        }
    }
    
    public func centralManager(_ central: CBCentralManager, didDiscover peripheral: CBPeripheral, advertisementData: [String: Any], rssi RSSI: NSNumber) {
        let peerId = peripheral.identifier.uuidString
        
        if peers[peerId] == nil {
            let peerState = BLEPeerState(peripheral: peripheral)
            peers[peerId] = peerState
            peripheral.delegate = self
            
            var info = peerInfo(from: peerState)
            info.signalStrength = RSSI.intValue
            eventsSubject.send(.peerDiscovered(info))
        } else {
            // Update last seen
            if var info = peers[peerId].map({ peerInfo(from: $0) }) {
                info.signalStrength = RSSI.intValue
                info.lastSeenAt = Date()
            }
        }
    }
    
    public func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
        // Discover services
        peripheral.discoverServices([BLEConstants.serviceUUID])
    }
    
    public func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral, error: Error?) {
        let peerId = peripheral.identifier.uuidString
        peers[peerId]?.isHandshakeComplete = false
        eventsSubject.send(.peerDisconnected(peerId))
    }
    
    public func centralManager(_ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral, error: Error?) {
        eventsSubject.send(.error(TransportError.connectionFailed(error?.localizedDescription ?? "Unknown error")))
    }
}

// MARK: - CBPeripheralDelegate

extension BLETransport: CBPeripheralDelegate {
    
    public func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
        guard let services = peripheral.services else { return }
        
        for service in services where service.uuid == BLEConstants.serviceUUID {
            peripheral.discoverCharacteristics([
                BLEConstants.nodeIdCharacteristicUUID,
                BLEConstants.bundleWriteCharacteristicUUID,
                BLEConstants.bundleNotifyCharacteristicUUID,
                BLEConstants.handshakeCharacteristicUUID
            ], for: service)
        }
    }
    
    public func peripheral(_ peripheral: CBPeripheral, didDiscoverCharacteristicsFor service: CBService, error: Error?) {
        guard let characteristics = service.characteristics else { return }
        
        let peerId = peripheral.identifier.uuidString
        guard let peer = peers[peerId] else { return }
        
        for characteristic in characteristics {
            peer.characteristics[characteristic.uuid] = characteristic
            
            // Subscribe to notifications
            if characteristic.uuid == BLEConstants.bundleNotifyCharacteristicUUID {
                peripheral.setNotifyValue(true, for: characteristic)
            }
            
            // Read node ID
            if characteristic.uuid == BLEConstants.nodeIdCharacteristicUUID {
                peripheral.readValue(for: characteristic)
            }
        }
        
        // Mark handshake complete
        peer.isHandshakeComplete = true
        eventsSubject.send(.peerConnected(peerInfo(from: peer)))
    }
    
    public func peripheral(_ peripheral: CBPeripheral, didUpdateValueFor characteristic: CBCharacteristic, error: Error?) {
        guard let data = characteristic.value,
              let peer = peers[peripheral.identifier.uuidString] else { return }
        
        switch characteristic.uuid {
        case BLEConstants.nodeIdCharacteristicUUID:
            peer.nodeId = data.hexString
            
        case BLEConstants.bundleNotifyCharacteristicUUID, BLEConstants.bundleWriteCharacteristicUUID:
            handleReceivedData(data, from: peer)
            
        default:
            break
        }
    }
    
    public func peripheral(_ peripheral: CBPeripheral, didWriteValueFor characteristic: CBCharacteristic, error: Error?) {
        if let error = error {
            eventsSubject.send(.error(TransportError.sendFailed(error.localizedDescription)))
        }
    }
}

// MARK: - CBPeripheralManagerDelegate

extension BLETransport: CBPeripheralManagerDelegate {
    
    public func peripheralManagerDidUpdateState(_ peripheral: CBPeripheralManager) {
        switch peripheral.state {
        case .poweredOn:
            startAdvertising()
            if state == .starting && centralManager?.state == .poweredOn {
                state = .running
            }
        case .poweredOff:
            isAdvertising = false
        default:
            break
        }
    }
    
    public func peripheralManager(_ peripheral: CBPeripheralManager, didReceiveWrite requests: [CBATTRequest]) {
        for request in requests {
            guard let data = request.value else {
                peripheral.respond(to: request, withResult: .invalidAttributeValueLength)
                continue
            }
            
            switch request.characteristic.uuid {
            case BLEConstants.bundleWriteCharacteristicUUID:
                // Handle incoming bundle data
                // Note: In full implementation, track which central sent this
                eventsSubject.send(.messageReceived(data, from: "peripheral"))
                peripheral.respond(to: request, withResult: .success)
                
            case BLEConstants.handshakeCharacteristicUUID:
                // Handle handshake
                peripheral.respond(to: request, withResult: .success)
                
            default:
                peripheral.respond(to: request, withResult: .attributeNotFound)
            }
        }
    }
    
    public func peripheralManager(_ peripheral: CBPeripheralManager, didReceiveRead request: CBATTRequest) {
        switch request.characteristic.uuid {
        case BLEConstants.nodeIdCharacteristicUUID:
            request.value = nodeId
            peripheral.respond(to: request, withResult: .success)
            
        default:
            peripheral.respond(to: request, withResult: .attributeNotFound)
        }
    }
}
