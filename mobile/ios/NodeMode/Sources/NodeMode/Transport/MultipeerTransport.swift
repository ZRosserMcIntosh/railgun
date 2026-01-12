//
//  MultipeerTransport.swift
//  RailGun Node Mode
//
//  MultipeerConnectivity transport for Wi-Fi Direct / AWDL mesh communication
//  Provides higher bandwidth (~10 Mbps) and longer range (~30m) than BLE
//

import Foundation
import MultipeerConnectivity
import Combine

// MARK: - Multipeer Constants

private enum MultipeerConstants {
    /// Service type (must be 1-15 characters, only lowercase ASCII letters, numbers, and hyphens)
    static let serviceType = "railgun-mesh"
    
    /// Discovery timeout
    static let discoveryTimeout: TimeInterval = 30.0
    
    /// Connection timeout
    static let connectionTimeout: TimeInterval = 15.0
    
    /// Keep-alive interval
    static let keepAliveInterval: TimeInterval = 30.0
    
    /// Maximum data size per send (1MB)
    static let maxDataSize = 1024 * 1024
    
    /// Reliable mode threshold (use reliable for messages under this size)
    static let reliableThreshold = 64 * 1024  // 64KB
}

// MARK: - Multipeer Peer State

private class MultipeerPeerState {
    let peerId: MCPeerID
    var nodeId: String?
    var isHandshakeComplete = false
    var lastSeen: Date = Date()
    var connectionState: MCSessionState = .notConnected
    
    init(peerId: MCPeerID) {
        self.peerId = peerId
    }
}

// MARK: - Multipeer Transport

public class MultipeerTransport: NSObject, Transport {
    
    // MARK: - Transport Protocol Properties
    
    public let transportType: TransportType = .multipeer
    
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
            .filter { $0.connectionState == .connected && $0.isHandshakeComplete }
            .map { peerInfo(from: $0) }
    }
    
    // MARK: - Private Properties
    
    private var localPeerId: MCPeerID!
    private var session: MCSession!
    private var advertiser: MCNearbyServiceAdvertiser!
    private var browser: MCNearbyServiceBrowser!
    
    private var peers: [String: MultipeerPeerState] = [:] // keyed by MCPeerID.displayName
    private var nodeId: Data?
    private var displayName: String = "Railgun-\(UUID().uuidString.prefix(4))"
    
    private let eventsSubject = PassthroughSubject<TransportEvent, Never>()
    private var isAdvertising = false
    private var isBrowsing = false
    
    private var keepAliveTimer: Timer?
    private var cancellables = Set<AnyCancellable>()
    
    // MARK: - Initialization
    
    public override init() {
        super.init()
    }
    
    // MARK: - Transport Protocol Methods
    
    public func start() async throws {
        guard state == .idle else {
            throw TransportError.alreadyRunning
        }
        
        state = .starting
        
        // Create peer ID with display name
        localPeerId = MCPeerID(displayName: displayName)
        
        // Create session
        session = MCSession(
            peer: localPeerId,
            securityIdentity: nil,
            encryptionPreference: .required
        )
        session.delegate = self
        
        // Create and start advertiser
        var discoveryInfo: [String: String] = [:]
        if let nodeId = nodeId {
            discoveryInfo["nodeId"] = nodeId.prefix(8).mpHexString
        }
        
        advertiser = MCNearbyServiceAdvertiser(
            peer: localPeerId,
            discoveryInfo: discoveryInfo.isEmpty ? nil : discoveryInfo,
            serviceType: MultipeerConstants.serviceType
        )
        advertiser.delegate = self
        advertiser.startAdvertisingPeer()
        isAdvertising = true
        
        // Create and start browser
        browser = MCNearbyServiceBrowser(
            peer: localPeerId,
            serviceType: MultipeerConstants.serviceType
        )
        browser.delegate = self
        browser.startBrowsingForPeers()
        isBrowsing = true
        
        // Start keep-alive timer
        startKeepAliveTimer()
        
        state = .running
        
        print("[MultipeerTransport] Started - advertising and browsing")
    }
    
    public func stop() async {
        state = .stopping
        
        // Stop keep-alive
        keepAliveTimer?.invalidate()
        keepAliveTimer = nil
        
        // Stop advertising
        if isAdvertising {
            advertiser?.stopAdvertisingPeer()
            isAdvertising = false
        }
        
        // Stop browsing
        if isBrowsing {
            browser?.stopBrowsingForPeers()
            isBrowsing = false
        }
        
        // Disconnect all peers
        session?.disconnect()
        
        // Clear state
        peers.removeAll()
        
        state = .idle
        
        print("[MultipeerTransport] Stopped")
    }
    
    public func connect(to peerId: String) async throws {
        guard let peerState = peers[peerId] else {
            throw TransportError.peerNotFound
        }
        
        guard peerState.connectionState != .connected else {
            return // Already connected
        }
        
        // Invite peer to session
        browser.invitePeer(
            peerState.peerId,
            to: session,
            withContext: createInvitationContext(),
            timeout: MultipeerConstants.connectionTimeout
        )
        
        print("[MultipeerTransport] Invited peer: \(peerId)")
    }
    
    public func disconnect(from peerId: String) async {
        guard let peerState = peers[peerId] else { return }
        
        // Note: MCSession doesn't have per-peer disconnect, but we can track locally
        peerState.connectionState = .notConnected
        peerState.isHandshakeComplete = false
        
        eventsSubject.send(.peerDisconnected(peerId))
        
        print("[MultipeerTransport] Disconnected from peer: \(peerId)")
    }
    
    public func send(_ data: Data, to peerId: String) async throws {
        guard let peerState = peers[peerId],
              peerState.connectionState == .connected else {
            throw TransportError.peerNotConnected
        }
        
        guard data.count <= MultipeerConstants.maxDataSize else {
            throw TransportError.dataTooLarge
        }
        
        // Use reliable mode for smaller messages, unreliable for large
        let mode: MCSessionSendDataMode = data.count < MultipeerConstants.reliableThreshold ? .reliable : .unreliable
        
        do {
            try session.send(data, toPeers: [peerState.peerId], with: mode)
            
            let messageId = UUID().uuidString
            eventsSubject.send(.messageSent(messageId, to: peerId))
            
        } catch {
            throw TransportError.sendFailed(error.localizedDescription)
        }
    }
    
    public func broadcast(_ data: Data) async throws {
        let connectedPeerIds = peers.values
            .filter { $0.connectionState == .connected && $0.isHandshakeComplete }
            .map { $0.peerId }
        
        guard !connectedPeerIds.isEmpty else {
            return // No peers to broadcast to
        }
        
        guard data.count <= MultipeerConstants.maxDataSize else {
            throw TransportError.dataTooLarge
        }
        
        let mode: MCSessionSendDataMode = data.count < MultipeerConstants.reliableThreshold ? .reliable : .unreliable
        
        do {
            try session.send(data, toPeers: connectedPeerIds, with: mode)
        } catch {
            throw TransportError.sendFailed(error.localizedDescription)
        }
    }
    
    public func setNodeId(_ nodeId: Data) {
        self.nodeId = nodeId
        
        // Restart advertising with new discovery info
        if isAdvertising {
            advertiser?.stopAdvertisingPeer()
            
            var discoveryInfo: [String: String] = [:]
            discoveryInfo["nodeId"] = nodeId.prefix(8).mpHexString
            
            advertiser = MCNearbyServiceAdvertiser(
                peer: localPeerId,
                discoveryInfo: discoveryInfo,
                serviceType: MultipeerConstants.serviceType
            )
            advertiser.delegate = self
            advertiser.startAdvertisingPeer()
        }
    }
    
    public func setDisplayName(_ name: String) {
        self.displayName = name
        // Note: Display name can't be changed after session creation
        // Would need to recreate session (not implemented for simplicity)
    }
    
    // MARK: - Private Helpers
    
    private func peerInfo(from state: MultipeerPeerState) -> PeerInfo {
        var info = PeerInfo(
            id: state.peerId.displayName,
            nodeId: state.nodeId,
            transportType: .multipeer,
            displayName: state.peerId.displayName
        )
        info.isConnected = state.connectionState == .connected
        info.lastSeenAt = state.lastSeen
        return info
    }
    
    private func createInvitationContext() -> Data? {
        // Include our node ID in invitation context
        var context: [String: Any] = [:]
        if let nodeId = nodeId {
            context["nodeId"] = nodeId.mpHexString
        }
        context["version"] = "1.0"
        
        return try? JSONSerialization.data(withJSONObject: context)
    }
    
    private func parseInvitationContext(_ context: Data?) -> [String: Any]? {
        guard let data = context else { return nil }
        return try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    }
    
    private func startKeepAliveTimer() {
        keepAliveTimer = Timer.scheduledTimer(withTimeInterval: MultipeerConstants.keepAliveInterval, repeats: true) { [weak self] _ in
            self?.pruneStaleConnections()
        }
    }
    
    private func pruneStaleConnections() {
        let staleThreshold = Date().addingTimeInterval(-MultipeerConstants.keepAliveInterval * 2)
        
        for (peerId, peerState) in peers {
            if peerState.lastSeen < staleThreshold && peerState.connectionState != .connected {
                peers.removeValue(forKey: peerId)
                eventsSubject.send(.peerLost(peerId))
            }
        }
    }
    
    private func performHandshake(with peerId: MCPeerID) {
        // Send handshake message with our node ID
        var handshake: [String: Any] = [
            "type": "handshake",
            "version": "1.0"
        ]
        if let nodeId = nodeId {
            handshake["nodeId"] = nodeId.mpHexString
        }
        
        guard let data = try? JSONSerialization.data(withJSONObject: handshake) else { return }
        
        do {
            try session.send(data, toPeers: [peerId], with: .reliable)
        } catch {
            print("[MultipeerTransport] Failed to send handshake: \(error)")
        }
    }
    
    private func handleHandshake(_ data: Data, from peerId: MCPeerID) {
        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let type = json["type"] as? String,
              type == "handshake" else {
            return
        }
        
        let peerIdString = peerId.displayName
        guard let peerState = peers[peerIdString] else { return }
        
        // Extract node ID
        if let nodeIdHex = json["nodeId"] as? String {
            peerState.nodeId = nodeIdHex
        }
        
        peerState.isHandshakeComplete = true
        
        // Emit connected event
        eventsSubject.send(.peerConnected(peerInfo(from: peerState)))
        
        print("[MultipeerTransport] Handshake complete with: \(peerIdString)")
    }
}

// MARK: - MCSessionDelegate

extension MultipeerTransport: MCSessionDelegate {
    
    public func session(_ session: MCSession, peer peerID: MCPeerID, didChange state: MCSessionState) {
        let peerIdString = peerID.displayName
        
        // Create or update peer state
        if peers[peerIdString] == nil {
            peers[peerIdString] = MultipeerPeerState(peerId: peerID)
        }
        
        guard let peerState = peers[peerIdString] else { return }
        peerState.connectionState = state
        peerState.lastSeen = Date()
        
        switch state {
        case .notConnected:
            peerState.isHandshakeComplete = false
            eventsSubject.send(.peerDisconnected(peerIdString))
            print("[MultipeerTransport] Peer disconnected: \(peerIdString)")
            
        case .connecting:
            print("[MultipeerTransport] Peer connecting: \(peerIdString)")
            
        case .connected:
            print("[MultipeerTransport] Peer connected: \(peerIdString)")
            // Start handshake
            performHandshake(with: peerID)
            
        @unknown default:
            break
        }
    }
    
    public func session(_ session: MCSession, didReceive data: Data, fromPeer peerID: MCPeerID) {
        let peerIdString = peerID.displayName
        
        // Update last seen
        peers[peerIdString]?.lastSeen = Date()
        
        // Check if this is a handshake message
        if let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let type = json["type"] as? String,
           type == "handshake" {
            handleHandshake(data, from: peerID)
            return
        }
        
        // Regular message
        eventsSubject.send(.messageReceived(data, from: peerIdString))
    }
    
    public func session(_ session: MCSession, didReceive stream: InputStream, withName streamName: String, fromPeer peerID: MCPeerID) {
        // Not used - we use data messages
        stream.close()
    }
    
    public func session(_ session: MCSession, didStartReceivingResourceWithName resourceName: String, fromPeer peerID: MCPeerID, with progress: Progress) {
        // Not used
    }
    
    public func session(_ session: MCSession, didFinishReceivingResourceWithName resourceName: String, fromPeer peerID: MCPeerID, at localURL: URL?, withError error: Error?) {
        // Not used
    }
}

// MARK: - MCNearbyServiceAdvertiserDelegate

extension MultipeerTransport: MCNearbyServiceAdvertiserDelegate {
    
    public func advertiser(_ advertiser: MCNearbyServiceAdvertiser, didReceiveInvitationFromPeer peerID: MCPeerID, withContext context: Data?, invitationHandler: @escaping (Bool, MCSession?) -> Void) {
        
        let peerIdString = peerID.displayName
        print("[MultipeerTransport] Received invitation from: \(peerIdString)")
        
        // Parse invitation context
        if let contextData = parseInvitationContext(context) {
            print("[MultipeerTransport] Invitation context: \(contextData)")
        }
        
        // Auto-accept invitations
        // In production, you might want to validate the peer first
        invitationHandler(true, session)
        
        // Create peer state if needed
        if peers[peerIdString] == nil {
            peers[peerIdString] = MultipeerPeerState(peerId: peerID)
        }
    }
    
    public func advertiser(_ advertiser: MCNearbyServiceAdvertiser, didNotStartAdvertisingPeer error: Error) {
        print("[MultipeerTransport] Failed to start advertising: \(error)")
        eventsSubject.send(.error(error))
        state = .error(error.localizedDescription)
    }
}

// MARK: - MCNearbyServiceBrowserDelegate

extension MultipeerTransport: MCNearbyServiceBrowserDelegate {
    
    public func browser(_ browser: MCNearbyServiceBrowser, foundPeer peerID: MCPeerID, withDiscoveryInfo info: [String : String]?) {
        let peerIdString = peerID.displayName
        
        // Don't discover ourselves
        guard peerID != localPeerId else { return }
        
        print("[MultipeerTransport] Found peer: \(peerIdString), info: \(info ?? [:])")
        
        // Create or update peer state
        if peers[peerIdString] == nil {
            let peerState = MultipeerPeerState(peerId: peerID)
            
            // Extract node ID from discovery info
            if let nodeIdHex = info?["nodeId"] {
                peerState.nodeId = nodeIdHex
            }
            
            peers[peerIdString] = peerState
            
            // Emit discovered event
            eventsSubject.send(.peerDiscovered(peerInfo(from: peerState)))
        }
        
        peers[peerIdString]?.lastSeen = Date()
    }
    
    public func browser(_ browser: MCNearbyServiceBrowser, lostPeer peerID: MCPeerID) {
        let peerIdString = peerID.displayName
        
        print("[MultipeerTransport] Lost peer: \(peerIdString)")
        
        if let peerState = peers[peerIdString] {
            // Only emit lost if not currently connected
            if peerState.connectionState != .connected {
                peers.removeValue(forKey: peerIdString)
                eventsSubject.send(.peerLost(peerIdString))
            }
        }
    }
    
    public func browser(_ browser: MCNearbyServiceBrowser, didNotStartBrowsingForPeers error: Error) {
        print("[MultipeerTransport] Failed to start browsing: \(error)")
        eventsSubject.send(.error(error))
        state = .error(error.localizedDescription)
    }
}

// MARK: - Data Extension (Multipeer)

private extension Data {
    var mpHexString: String {
        map { String(format: "%02x", $0) }.joined()
    }
}
