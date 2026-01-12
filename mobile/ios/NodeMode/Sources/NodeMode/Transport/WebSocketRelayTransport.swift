//
//  WebSocketRelayTransport.swift
//  RailGun Node Mode
//
//  WebSocket-based relay transport for NAT traversal
//  Used as fallback when direct P2P connections fail
//

import Foundation
import Combine

// MARK: - Relay Constants

private enum RelayConstants {
    /// Default relay server URLs (should be configurable)
    static let defaultRelayURLs = [
        "wss://relay1.railgun.app/mesh",
        "wss://relay2.railgun.app/mesh"
    ]
    
    /// Reconnection delay
    static let reconnectDelay: TimeInterval = 5.0
    
    /// Maximum reconnection attempts
    static let maxReconnectAttempts = 5
    
    /// Ping interval
    static let pingInterval: TimeInterval = 30.0
    
    /// Connection timeout
    static let connectionTimeout: TimeInterval = 10.0
    
    /// Message types
    enum MessageType: String {
        case register = "register"
        case unregister = "unregister"
        case route = "route"
        case ping = "ping"
        case pong = "pong"
        case peers = "peers"
        case error = "error"
    }
}

// MARK: - Relay Message

private struct RelayMessage: Codable {
    let type: String
    let from: String?
    let to: String?
    let payload: String?  // Base64 encoded
    let peers: [String]?
    let error: String?
    let timestamp: Int64
    
    init(type: RelayConstants.MessageType, from: String? = nil, to: String? = nil, payload: Data? = nil, peers: [String]? = nil, error: String? = nil) {
        self.type = type.rawValue
        self.from = from
        self.to = to
        self.payload = payload?.base64EncodedString()
        self.peers = peers
        self.error = error
        self.timestamp = Int64(Date().timeIntervalSince1970 * 1000)
    }
}

// MARK: - Relay Peer State

private class RelayPeerState {
    let nodeId: String
    var lastSeen: Date = Date()
    var isConnected: Bool = false
    
    init(nodeId: String) {
        self.nodeId = nodeId
    }
}

// MARK: - WebSocket Relay Transport

public class WebSocketRelayTransport: NSObject, Transport {
    
    // MARK: - Transport Protocol Properties
    
    public let transportType: TransportType = .lan // Using .lan as placeholder for .relay
    
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
        peers.values.filter { $0.isConnected }.map { peerInfo(from: $0) }
    }
    
    // MARK: - Private Properties
    
    private var webSocket: URLSessionWebSocketTask?
    private var session: URLSession!
    private var relayURLs: [String]
    private var currentRelayIndex = 0
    
    private var nodeId: Data?
    private var nodeIdString: String?
    private var displayName: String = "Railgun-Relay"
    
    private var peers: [String: RelayPeerState] = [:]
    private let eventsSubject = PassthroughSubject<TransportEvent, Never>()
    
    private var isConnected = false
    private var reconnectAttempts = 0
    private var pingTimer: Timer?
    
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()
    
    // MARK: - Initialization
    
    public init(relayURLs: [String]? = nil) {
        self.relayURLs = relayURLs ?? RelayConstants.defaultRelayURLs
        super.init()
        
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = RelayConstants.connectionTimeout
        session = URLSession(configuration: config, delegate: self, delegateQueue: .main)
    }
    
    // MARK: - Transport Protocol Methods
    
    public func start() async throws {
        guard state == .idle else {
            throw TransportError.alreadyRunning
        }
        
        state = .starting
        
        // Connect to relay server
        try await connectToRelay()
        
        // Start ping timer
        startPingTimer()
        
        state = .running
        print("[RelayTransport] Started")
    }
    
    public func stop() async {
        state = .stopping
        
        // Stop ping timer
        pingTimer?.invalidate()
        pingTimer = nil
        
        // Unregister from relay
        if isConnected, let nodeId = nodeIdString {
            let msg = RelayMessage(type: .unregister, from: nodeId)
            sendMessage(msg)
        }
        
        // Close WebSocket
        webSocket?.cancel(with: .normalClosure, reason: nil)
        webSocket = nil
        isConnected = false
        
        // Clear peers
        peers.removeAll()
        
        state = .idle
        print("[RelayTransport] Stopped")
    }
    
    public func connect(to peerId: String) async throws {
        guard isConnected else {
            throw TransportError.notConnected
        }
        
        // In relay mode, "connecting" means we're ready to route messages
        // The relay server handles the actual routing
        if peers[peerId] == nil {
            peers[peerId] = RelayPeerState(nodeId: peerId)
        }
        peers[peerId]?.isConnected = true
        
        eventsSubject.send(.peerConnected(peerInfo(from: peers[peerId]!)))
    }
    
    public func disconnect(from peerId: String) async {
        if let peer = peers[peerId] {
            peer.isConnected = false
            eventsSubject.send(.peerDisconnected(peerId))
        }
    }
    
    public func send(_ data: Data, to peerId: String) async throws {
        guard isConnected else {
            throw TransportError.notConnected
        }
        
        guard let nodeId = nodeIdString else {
            throw TransportError.sendFailed("Node ID not set")
        }
        
        let msg = RelayMessage(type: .route, from: nodeId, to: peerId, payload: data)
        sendMessage(msg)
        
        let messageId = UUID().uuidString
        eventsSubject.send(.messageSent(messageId, to: peerId))
    }
    
    public func broadcast(_ data: Data) async throws {
        // Send to all known peers through relay
        for peerId in peers.keys {
            try? await send(data, to: peerId)
        }
    }
    
    public func setNodeId(_ nodeId: Data) {
        self.nodeId = nodeId
        self.nodeIdString = nodeId.map { String(format: "%02x", $0) }.joined()
        
        // Re-register with new node ID if connected
        if isConnected {
            registerWithRelay()
        }
    }
    
    public func setDisplayName(_ name: String) {
        self.displayName = name
    }
    
    // MARK: - Private Methods
    
    private func connectToRelay() async throws {
        guard currentRelayIndex < relayURLs.count else {
            currentRelayIndex = 0
            throw TransportError.connectionFailed("All relay servers unavailable")
        }
        
        let urlString = relayURLs[currentRelayIndex]
        guard let url = URL(string: urlString) else {
            throw TransportError.connectionFailed("Invalid relay URL")
        }
        
        print("[RelayTransport] Connecting to: \(urlString)")
        
        webSocket = session.webSocketTask(with: url)
        webSocket?.resume()
        
        // Wait for connection
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            // Set up receive loop
            receiveMessages()
            
            // Give it a moment to connect
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) { [weak self] in
                if self?.webSocket?.state == .running {
                    self?.isConnected = true
                    self?.reconnectAttempts = 0
                    self?.registerWithRelay()
                    continuation.resume()
                } else {
                    continuation.resume(throwing: TransportError.connectionFailed("WebSocket connection failed"))
                }
            }
        }
    }
    
    private func registerWithRelay() {
        guard let nodeId = nodeIdString else { return }
        
        let msg = RelayMessage(type: .register, from: nodeId)
        sendMessage(msg)
        
        print("[RelayTransport] Registered with relay as: \(nodeId.prefix(16))...")
    }
    
    private func sendMessage(_ message: RelayMessage) {
        guard let data = try? encoder.encode(message),
              let json = String(data: data, encoding: .utf8) else {
            return
        }
        
        webSocket?.send(.string(json)) { error in
            if let error = error {
                print("[RelayTransport] Send error: \(error)")
            }
        }
    }
    
    private func receiveMessages() {
        webSocket?.receive { [weak self] result in
            guard let self = self else { return }
            
            switch result {
            case .success(let message):
                self.handleMessage(message)
                // Continue receiving
                self.receiveMessages()
                
            case .failure(let error):
                print("[RelayTransport] Receive error: \(error)")
                self.handleDisconnection()
            }
        }
    }
    
    private func handleMessage(_ message: URLSessionWebSocketTask.Message) {
        var data: Data?
        
        switch message {
        case .string(let text):
            data = text.data(using: .utf8)
        case .data(let d):
            data = d
        @unknown default:
            return
        }
        
        guard let messageData = data,
              let relayMessage = try? decoder.decode(RelayMessage.self, from: messageData) else {
            return
        }
        
        switch RelayConstants.MessageType(rawValue: relayMessage.type) {
        case .route:
            handleRouteMessage(relayMessage)
            
        case .peers:
            handlePeersMessage(relayMessage)
            
        case .pong:
            // Ping response received
            break
            
        case .error:
            print("[RelayTransport] Server error: \(relayMessage.error ?? "unknown")")
            
        default:
            break
        }
    }
    
    private func handleRouteMessage(_ message: RelayMessage) {
        guard let from = message.from,
              let payloadBase64 = message.payload,
              let payload = Data(base64Encoded: payloadBase64) else {
            return
        }
        
        // Update peer state
        if peers[from] == nil {
            let peer = RelayPeerState(nodeId: from)
            peers[from] = peer
            eventsSubject.send(.peerDiscovered(peerInfo(from: peer)))
        }
        peers[from]?.lastSeen = Date()
        
        // Emit message received event
        eventsSubject.send(.messageReceived(payload, from: from))
    }
    
    private func handlePeersMessage(_ message: RelayMessage) {
        guard let peerList = message.peers else { return }
        
        for peerId in peerList {
            if peerId != nodeIdString && peers[peerId] == nil {
                let peer = RelayPeerState(nodeId: peerId)
                peers[peerId] = peer
                eventsSubject.send(.peerDiscovered(peerInfo(from: peer)))
            }
        }
    }
    
    private func handleDisconnection() {
        isConnected = false
        
        guard state == .running else { return }
        
        // Attempt reconnection
        if reconnectAttempts < RelayConstants.maxReconnectAttempts {
            reconnectAttempts += 1
            
            DispatchQueue.main.asyncAfter(deadline: .now() + RelayConstants.reconnectDelay) { [weak self] in
                Task {
                    try? await self?.reconnect()
                }
            }
        } else {
            // Try next relay server
            currentRelayIndex += 1
            reconnectAttempts = 0
            
            Task {
                try? await reconnect()
            }
        }
    }
    
    private func reconnect() async throws {
        print("[RelayTransport] Reconnecting (attempt \(reconnectAttempts))...")
        
        webSocket?.cancel()
        webSocket = nil
        
        try await connectToRelay()
    }
    
    private func startPingTimer() {
        pingTimer = Timer.scheduledTimer(withTimeInterval: RelayConstants.pingInterval, repeats: true) { [weak self] _ in
            self?.sendPing()
        }
    }
    
    private func sendPing() {
        guard isConnected, let nodeId = nodeIdString else { return }
        
        let msg = RelayMessage(type: .ping, from: nodeId)
        sendMessage(msg)
    }
    
    private func peerInfo(from state: RelayPeerState) -> PeerInfo {
        var info = PeerInfo(
            id: state.nodeId,
            nodeId: state.nodeId,
            transportType: .lan, // Placeholder for .relay
            displayName: "Relay-\(state.nodeId.prefix(8))"
        )
        info.isConnected = state.isConnected
        info.lastSeenAt = state.lastSeen
        return info
    }
}

// MARK: - URLSessionWebSocketDelegate

extension WebSocketRelayTransport: URLSessionWebSocketDelegate {
    
    public func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didOpenWithProtocol protocol: String?) {
        print("[RelayTransport] WebSocket connected")
        isConnected = true
    }
    
    public func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didCloseWith closeCode: URLSessionWebSocketTask.CloseCode, reason: Data?) {
        print("[RelayTransport] WebSocket closed: \(closeCode)")
        handleDisconnection()
    }
}
