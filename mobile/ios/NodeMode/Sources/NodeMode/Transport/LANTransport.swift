//
//  LANTransport.swift
//  RailGun Node Mode
//
//  Local Area Network transport using mDNS/Bonjour for discovery
//  and TCP for reliable message delivery
//

import Foundation
import Network
import Combine

// MARK: - LAN Constants

private enum LANConstants {
    /// Bonjour service type
    static let serviceType = "_railgun._tcp"
    
    /// Service domain
    static let serviceDomain = "local."
    
    /// Default port (0 = system assigned)
    static let defaultPort: UInt16 = 0
    
    /// Connection timeout
    static let connectionTimeout: TimeInterval = 10.0
    
    /// Keep-alive interval
    static let keepAliveInterval: TimeInterval = 30.0
    
    /// Message header size (4 bytes for length prefix)
    static let headerSize = 4
    
    /// Maximum message size (10 MB)
    static let maxMessageSize = 10 * 1024 * 1024
}

// MARK: - LAN Peer State

private class LANPeerState {
    let id: String
    let endpoint: NWEndpoint
    var connection: NWConnection?
    var nodeId: String?
    var displayName: String?
    var isHandshakeComplete = false
    var lastSeen: Date = Date()
    
    // Receive buffer for framing
    var receiveBuffer = Data()
    
    init(id: String, endpoint: NWEndpoint) {
        self.id = id
        self.endpoint = endpoint
    }
}

// MARK: - LAN Transport

public class LANTransport: Transport {
    
    // MARK: - Transport Protocol Properties
    
    public let transportType: TransportType = .lan
    
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
            .filter { $0.connection?.state == .ready && $0.isHandshakeComplete }
            .map { peerInfo(from: $0) }
    }
    
    // MARK: - Private Properties
    
    private var listener: NWListener?
    private var browser: NWBrowser?
    private var peers: [String: LANPeerState] = [:]
    
    private var nodeId: Data?
    private var displayName: String = "Railgun-\(UUID().uuidString.prefix(4))"
    private var localPort: UInt16 = 0
    
    private let eventsSubject = PassthroughSubject<TransportEvent, Never>()
    private let queue = DispatchQueue(label: "com.railgun.lan-transport", qos: .userInitiated)
    
    private var keepAliveTimer: Timer?
    
    // MARK: - Initialization
    
    public init() {}
    
    // MARK: - Transport Protocol Methods
    
    public func start() async throws {
        guard state == .idle else {
            throw TransportError.alreadyRunning
        }
        
        state = .starting
        
        do {
            // Start listener
            try await startListener()
            
            // Start browser
            try await startBrowser()
            
            // Start keep-alive
            startKeepAliveTimer()
            
            state = .running
            print("[LANTransport] Started on port \(localPort)")
            
        } catch {
            state = .error(error.localizedDescription)
            throw error
        }
    }
    
    public func stop() async {
        state = .stopping
        
        // Stop keep-alive
        keepAliveTimer?.invalidate()
        keepAliveTimer = nil
        
        // Stop browser
        browser?.cancel()
        browser = nil
        
        // Stop listener
        listener?.cancel()
        listener = nil
        
        // Close all connections
        for peerState in peers.values {
            peerState.connection?.cancel()
        }
        peers.removeAll()
        
        state = .idle
        print("[LANTransport] Stopped")
    }
    
    public func connect(to peerId: String) async throws {
        guard let peerState = peers[peerId] else {
            throw TransportError.peerNotFound
        }
        
        // Already connected?
        if peerState.connection?.state == .ready {
            return
        }
        
        // Create connection
        let connection = NWConnection(to: peerState.endpoint, using: .tcp)
        peerState.connection = connection
        
        // Set up state handler
        connection.stateUpdateHandler = { [weak self, weak peerState] newState in
            guard let self = self, let peerState = peerState else { return }
            self.handleConnectionStateChange(peerState: peerState, state: newState)
        }
        
        // Start connection
        connection.start(queue: queue)
        
        // Wait for connection with timeout
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            var resumed = false
            
            // Timeout
            DispatchQueue.main.asyncAfter(deadline: .now() + LANConstants.connectionTimeout) {
                if !resumed {
                    resumed = true
                    continuation.resume(throwing: TransportError.timeout)
                }
            }
            
            // Watch for ready state
            connection.stateUpdateHandler = { [weak self, weak peerState] newState in
                guard let self = self, let peerState = peerState else { return }
                
                switch newState {
                case .ready:
                    if !resumed {
                        resumed = true
                        self.setupReceive(for: peerState)
                        self.performHandshake(with: peerState)
                        continuation.resume()
                    }
                case .failed(let error):
                    if !resumed {
                        resumed = true
                        continuation.resume(throwing: TransportError.connectionFailed(error.localizedDescription))
                    }
                default:
                    break
                }
                
                self.handleConnectionStateChange(peerState: peerState, state: newState)
            }
        }
    }
    
    public func disconnect(from peerId: String) async {
        guard let peerState = peers[peerId] else { return }
        
        peerState.connection?.cancel()
        peerState.connection = nil
        peerState.isHandshakeComplete = false
        
        eventsSubject.send(.peerDisconnected(peerId))
    }
    
    public func send(_ data: Data, to peerId: String) async throws {
        guard let peerState = peers[peerId],
              let connection = peerState.connection,
              connection.state == .ready else {
            throw TransportError.peerNotConnected
        }
        
        guard data.count <= LANConstants.maxMessageSize else {
            throw TransportError.dataTooLarge
        }
        
        // Frame the message with length prefix
        let framedData = frameMessage(data)
        
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            connection.send(content: framedData, completion: .contentProcessed { error in
                if let error = error {
                    continuation.resume(throwing: TransportError.sendFailed(error.localizedDescription))
                } else {
                    continuation.resume()
                }
            })
        }
        
        let messageId = UUID().uuidString
        eventsSubject.send(.messageSent(messageId, to: peerId))
    }
    
    public func broadcast(_ data: Data) async throws {
        let connected = peers.values.filter {
            $0.connection?.state == .ready && $0.isHandshakeComplete
        }
        
        for peerState in connected {
            try? await send(data, to: peerState.id)
        }
    }
    
    public func setNodeId(_ nodeId: Data) {
        self.nodeId = nodeId
        // Would need to restart listener to update TXT record
    }
    
    public func setDisplayName(_ name: String) {
        self.displayName = name
    }
    
    // MARK: - Listener
    
    private func startListener() async throws {
        let parameters = NWParameters.tcp
        parameters.includePeerToPeer = true
        
        // Create listener
        let listener = try NWListener(using: parameters, on: NWEndpoint.Port(rawValue: LANConstants.defaultPort) ?? .any)
        self.listener = listener
        
        // Set up service advertising
        listener.service = NWListener.Service(
            name: displayName,
            type: LANConstants.serviceType,
            domain: LANConstants.serviceDomain,
            txtRecord: createTXTRecord()
        )
        
        // Handle new connections
        listener.newConnectionHandler = { [weak self] connection in
            self?.handleIncomingConnection(connection)
        }
        
        // Handle state changes
        listener.stateUpdateHandler = { [weak self] newState in
            switch newState {
            case .ready:
                if let port = self?.listener?.port?.rawValue {
                    self?.localPort = port
                    print("[LANTransport] Listener ready on port \(port)")
                }
            case .failed(let error):
                print("[LANTransport] Listener failed: \(error)")
                self?.eventsSubject.send(.error(error))
            case .cancelled:
                print("[LANTransport] Listener cancelled")
            default:
                break
            }
        }
        
        // Start listener
        listener.start(queue: queue)
        
        // Wait for ready
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            var resumed = false
            
            listener.stateUpdateHandler = { newState in
                guard !resumed else { return }
                
                switch newState {
                case .ready:
                    resumed = true
                    if let port = listener.port?.rawValue {
                        self.localPort = port
                    }
                    continuation.resume()
                case .failed(let error):
                    resumed = true
                    continuation.resume(throwing: error)
                default:
                    break
                }
            }
        }
    }
    
    private func createTXTRecord() -> NWTXTRecord {
        var record = NWTXTRecord()
        record["version"] = "1.0"
        if let nodeId = nodeId {
            record["nodeId"] = nodeId.prefix(8).map { String(format: "%02x", $0) }.joined()
        }
        return record
    }
    
    private func handleIncomingConnection(_ connection: NWConnection) {
        let peerId = UUID().uuidString
        let peerState = LANPeerState(id: peerId, endpoint: connection.endpoint)
        peerState.connection = connection
        peers[peerId] = peerState
        
        connection.stateUpdateHandler = { [weak self, weak peerState] newState in
            guard let self = self, let peerState = peerState else { return }
            self.handleConnectionStateChange(peerState: peerState, state: newState)
        }
        
        connection.start(queue: queue)
        
        print("[LANTransport] Incoming connection from: \(peerId)")
    }
    
    // MARK: - Browser
    
    private func startBrowser() async throws {
        let parameters = NWParameters()
        parameters.includePeerToPeer = true
        
        let descriptor = NWBrowser.Descriptor.bonjour(
            type: LANConstants.serviceType,
            domain: LANConstants.serviceDomain
        )
        
        let browser = NWBrowser(for: descriptor, using: parameters)
        self.browser = browser
        
        browser.browseResultsChangedHandler = { [weak self] results, changes in
            self?.handleBrowseResults(results, changes: changes)
        }
        
        browser.stateUpdateHandler = { newState in
            switch newState {
            case .ready:
                print("[LANTransport] Browser ready")
            case .failed(let error):
                print("[LANTransport] Browser failed: \(error)")
            default:
                break
            }
        }
        
        browser.start(queue: queue)
    }
    
    private func handleBrowseResults(_ results: Set<NWBrowser.Result>, changes: Set<NWBrowser.Result.Change>) {
        for change in changes {
            switch change {
            case .added(let result):
                handlePeerFound(result)
            case .removed(let result):
                handlePeerLost(result)
            case .changed(old: _, new: let new, flags: _):
                handlePeerFound(new) // Treat as update
            case .identical:
                break
            @unknown default:
                break
            }
        }
    }
    
    private func handlePeerFound(_ result: NWBrowser.Result) {
        // Extract service name
        guard case .service(let name, _, _, _) = result.endpoint else { return }
        
        // Don't discover ourselves
        guard name != displayName else { return }
        
        let peerId = name
        
        // Parse TXT record
        var nodeIdHex: String?
        if case .bonjour(let txtRecord) = result.metadata {
            nodeIdHex = txtRecord["nodeId"]
        }
        
        // Create or update peer
        if peers[peerId] == nil {
            let peerState = LANPeerState(id: peerId, endpoint: result.endpoint)
            peerState.displayName = name
            peerState.nodeId = nodeIdHex
            peers[peerId] = peerState
            
            eventsSubject.send(.peerDiscovered(peerInfo(from: peerState)))
            print("[LANTransport] Found peer: \(peerId)")
        }
        
        peers[peerId]?.lastSeen = Date()
    }
    
    private func handlePeerLost(_ result: NWBrowser.Result) {
        guard case .service(let name, _, _, _) = result.endpoint else { return }
        
        let peerId = name
        
        if let peerState = peers[peerId] {
            if peerState.connection?.state != .ready {
                peers.removeValue(forKey: peerId)
                eventsSubject.send(.peerLost(peerId))
                print("[LANTransport] Lost peer: \(peerId)")
            }
        }
    }
    
    // MARK: - Connection Handling
    
    private func handleConnectionStateChange(peerState: LANPeerState, state: NWConnection.State) {
        switch state {
        case .ready:
            peerState.lastSeen = Date()
            setupReceive(for: peerState)
            
        case .failed(let error):
            print("[LANTransport] Connection failed for \(peerState.id): \(error)")
            peerState.isHandshakeComplete = false
            eventsSubject.send(.peerDisconnected(peerState.id))
            
        case .cancelled:
            peerState.isHandshakeComplete = false
            eventsSubject.send(.peerDisconnected(peerState.id))
            
        default:
            break
        }
    }
    
    private func setupReceive(for peerState: LANPeerState) {
        peerState.connection?.receive(minimumIncompleteLength: 1, maximumLength: 65536) { [weak self, weak peerState] data, _, isComplete, error in
            guard let self = self, let peerState = peerState else { return }
            
            if let data = data, !data.isEmpty {
                peerState.receiveBuffer.append(data)
                self.processReceiveBuffer(for: peerState)
            }
            
            if let error = error {
                print("[LANTransport] Receive error: \(error)")
                return
            }
            
            if !isComplete {
                self.setupReceive(for: peerState)
            }
        }
    }
    
    private func processReceiveBuffer(for peerState: LANPeerState) {
        // Try to extract complete messages from buffer
        while peerState.receiveBuffer.count >= LANConstants.headerSize {
            // Read length prefix
            let lengthData = peerState.receiveBuffer.prefix(LANConstants.headerSize)
            let length = lengthData.withUnsafeBytes { $0.load(as: UInt32.self).bigEndian }
            
            let totalLength = LANConstants.headerSize + Int(length)
            
            // Do we have the complete message?
            if peerState.receiveBuffer.count >= totalLength {
                let messageData = peerState.receiveBuffer.subdata(in: LANConstants.headerSize..<totalLength)
                peerState.receiveBuffer.removeFirst(totalLength)
                
                handleReceivedMessage(messageData, from: peerState)
            } else {
                break // Wait for more data
            }
        }
    }
    
    private func handleReceivedMessage(_ data: Data, from peerState: LANPeerState) {
        peerState.lastSeen = Date()
        
        // Check if handshake message
        if let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let type = json["type"] as? String,
           type == "handshake" {
            handleHandshake(json, from: peerState)
            return
        }
        
        // Regular message
        eventsSubject.send(.messageReceived(data, from: peerState.id))
    }
    
    // MARK: - Handshake
    
    private func performHandshake(with peerState: LANPeerState) {
        var handshake: [String: Any] = [
            "type": "handshake",
            "version": "1.0",
            "name": displayName
        ]
        if let nodeId = nodeId {
            handshake["nodeId"] = nodeId.map { String(format: "%02x", $0) }.joined()
        }
        
        guard let data = try? JSONSerialization.data(withJSONObject: handshake),
              let connection = peerState.connection else { return }
        
        let framedData = frameMessage(data)
        connection.send(content: framedData, completion: .contentProcessed { error in
            if let error = error {
                print("[LANTransport] Failed to send handshake: \(error)")
            }
        })
    }
    
    private func handleHandshake(_ json: [String: Any], from peerState: LANPeerState) {
        if let nodeIdHex = json["nodeId"] as? String {
            peerState.nodeId = nodeIdHex
        }
        if let name = json["name"] as? String {
            peerState.displayName = name
        }
        
        // If we received handshake but haven't sent one, send ours
        if !peerState.isHandshakeComplete {
            performHandshake(with: peerState)
        }
        
        peerState.isHandshakeComplete = true
        eventsSubject.send(.peerConnected(peerInfo(from: peerState)))
        
        print("[LANTransport] Handshake complete with: \(peerState.id)")
    }
    
    // MARK: - Helpers
    
    private func frameMessage(_ data: Data) -> Data {
        var framedData = Data()
        var length = UInt32(data.count).bigEndian
        framedData.append(Data(bytes: &length, count: 4))
        framedData.append(data)
        return framedData
    }
    
    private func peerInfo(from state: LANPeerState) -> PeerInfo {
        var info = PeerInfo(
            id: state.id,
            nodeId: state.nodeId,
            transportType: .lan,
            displayName: state.displayName
        )
        info.isConnected = state.connection?.state == .ready && state.isHandshakeComplete
        info.lastSeenAt = state.lastSeen
        return info
    }
    
    private func startKeepAliveTimer() {
        DispatchQueue.main.async { [weak self] in
            self?.keepAliveTimer = Timer.scheduledTimer(withTimeInterval: LANConstants.keepAliveInterval, repeats: true) { [weak self] _ in
                self?.pruneStaleConnections()
            }
        }
    }
    
    private func pruneStaleConnections() {
        let staleThreshold = Date().addingTimeInterval(-LANConstants.keepAliveInterval * 3)
        
        for (peerId, peerState) in peers {
            if peerState.lastSeen < staleThreshold && peerState.connection?.state != .ready {
                peers.removeValue(forKey: peerId)
                eventsSubject.send(.peerLost(peerId))
            }
        }
    }
}
