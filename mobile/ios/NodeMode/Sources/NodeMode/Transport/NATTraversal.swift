//
//  NATTraversal.swift
//  RailGun Node Mode
//
//  STUN/TURN client for NAT traversal and public IP discovery
//

import Foundation
import Network

// MARK: - STUN Constants

private enum STUNConstants {
    /// Default STUN servers
    static let defaultSTUNServers = [
        "stun.l.google.com:19302",
        "stun1.l.google.com:19302",
        "stun.cloudflare.com:3478"
    ]
    
    /// STUN message types
    static let bindingRequest: UInt16 = 0x0001
    static let bindingResponse: UInt16 = 0x0101
    static let bindingError: UInt16 = 0x0111
    
    /// STUN attributes
    static let mappedAddress: UInt16 = 0x0001
    static let xorMappedAddress: UInt16 = 0x0020
    static let software: UInt16 = 0x8022
    static let fingerprint: UInt16 = 0x8028
    
    /// STUN magic cookie
    static let magicCookie: UInt32 = 0x2112A442
    
    /// Request timeout
    static let requestTimeout: TimeInterval = 3.0
}

// MARK: - NAT Type

public enum NATType: String {
    case unknown = "unknown"
    case open = "open"               // No NAT, public IP
    case fullCone = "full_cone"      // Any external host can send
    case restrictedCone = "restricted_cone"  // Only hosts we've sent to can reply
    case portRestricted = "port_restricted"  // Only host:port we've sent to can reply
    case symmetric = "symmetric"     // Different mapping for each destination
    case blocked = "blocked"         // UDP blocked
}

// MARK: - Public Address Info

public struct PublicAddressInfo {
    public let address: String
    public let port: UInt16
    public let natType: NATType
    public let localAddress: String?
    public let localPort: UInt16?
    
    public var isNATed: Bool {
        if let local = localAddress {
            return local != address
        }
        return true
    }
}

// MARK: - STUN Error

public enum STUNError: Error, LocalizedError {
    case noServersAvailable
    case timeout
    case invalidResponse
    case networkError(String)
    
    public var errorDescription: String? {
        switch self {
        case .noServersAvailable: return "No STUN servers available"
        case .timeout: return "STUN request timed out"
        case .invalidResponse: return "Invalid STUN response"
        case .networkError(let msg): return "Network error: \(msg)"
        }
    }
}

// MARK: - NAT Traversal Manager

public actor NATTraversalManager {
    
    // MARK: - Properties
    
    private var stunServers: [String]
    private var cachedPublicAddress: PublicAddressInfo?
    private var lastCheck: Date?
    private let cacheTimeout: TimeInterval = 300 // 5 minutes
    
    // MARK: - Initialization
    
    public init(stunServers: [String]? = nil) {
        self.stunServers = stunServers ?? STUNConstants.defaultSTUNServers
    }
    
    // MARK: - Public Methods
    
    /// Discover public IP address using STUN
    public func discoverPublicAddress(forceRefresh: Bool = false) async throws -> PublicAddressInfo {
        // Return cached result if still valid
        if !forceRefresh,
           let cached = cachedPublicAddress,
           let lastCheck = lastCheck,
           Date().timeIntervalSince(lastCheck) < cacheTimeout {
            return cached
        }
        
        // Try each STUN server
        for server in stunServers {
            do {
                let result = try await performSTUNRequest(server: server)
                cachedPublicAddress = result
                lastCheck = Date()
                return result
            } catch {
                print("[NATTraversal] STUN server \(server) failed: \(error)")
                continue
            }
        }
        
        throw STUNError.noServersAvailable
    }
    
    /// Detect NAT type (requires multiple STUN servers)
    public func detectNATType() async throws -> NATType {
        guard stunServers.count >= 2 else {
            // Can't reliably detect NAT type with one server
            let info = try await discoverPublicAddress()
            return info.natType
        }
        
        // Get mappings from two different servers
        var mappings: [(server: String, address: String, port: UInt16)] = []
        
        for server in stunServers.prefix(2) {
            do {
                let result = try await performSTUNRequest(server: server)
                mappings.append((server, result.address, result.port))
            } catch {
                continue
            }
        }
        
        guard mappings.count >= 2 else {
            return .unknown
        }
        
        // Compare mappings
        let first = mappings[0]
        let second = mappings[1]
        
        if first.address == second.address && first.port == second.port {
            // Same mapping = Cone NAT
            // Would need more tests to distinguish full/restricted/port-restricted
            return .fullCone
        } else {
            // Different mappings = Symmetric NAT
            return .symmetric
        }
    }
    
    /// Check if UDP hole punching is likely to work
    public func canUsePeerToPeer() async -> Bool {
        do {
            let natType = try await detectNATType()
            switch natType {
            case .open, .fullCone, .restrictedCone, .portRestricted:
                return true
            case .symmetric, .blocked, .unknown:
                return false
            }
        } catch {
            return false
        }
    }
    
    // MARK: - Private Methods
    
    private func performSTUNRequest(server: String) async throws -> PublicAddressInfo {
        let components = server.split(separator: ":")
        guard components.count == 2,
              let port = UInt16(components[1]) else {
            throw STUNError.networkError("Invalid server format")
        }
        
        let host = String(components[0])
        
        return try await withCheckedThrowingContinuation { continuation in
            performSTUNRequestInternal(host: host, port: port) { result in
                continuation.resume(with: result)
            }
        }
    }
    
    private nonisolated func performSTUNRequestInternal(
        host: String,
        port: UInt16,
        completion: @escaping (Result<PublicAddressInfo, Error>) -> Void
    ) {
        // Create UDP connection
        let endpoint = NWEndpoint.hostPort(host: NWEndpoint.Host(host), port: NWEndpoint.Port(rawValue: port)!)
        let connection = NWConnection(to: endpoint, using: .udp)
        
        var completed = false
        let timeoutWork = DispatchWorkItem { [weak connection] in
            if !completed {
                completed = true
                connection?.cancel()
                completion(.failure(STUNError.timeout))
            }
        }
        
        connection.stateUpdateHandler = { state in
            switch state {
            case .ready:
                // Send STUN binding request
                let request = self.createBindingRequest()
                connection.send(content: request, completion: .contentProcessed { error in
                    if let error = error {
                        if !completed {
                            completed = true
                            timeoutWork.cancel()
                            completion(.failure(STUNError.networkError(error.localizedDescription)))
                        }
                        connection.cancel()
                    }
                })
                
                // Receive response
                connection.receive(minimumIncompleteLength: 20, maximumLength: 548) { data, _, _, error in
                    timeoutWork.cancel()
                    
                    if completed { return }
                    completed = true
                    
                    if let error = error {
                        completion(.failure(STUNError.networkError(error.localizedDescription)))
                    } else if let data = data {
                        if let result = self.parseBindingResponse(data) {
                            completion(.success(result))
                        } else {
                            completion(.failure(STUNError.invalidResponse))
                        }
                    } else {
                        completion(.failure(STUNError.invalidResponse))
                    }
                    
                    connection.cancel()
                }
                
            case .failed(let error):
                if !completed {
                    completed = true
                    timeoutWork.cancel()
                    completion(.failure(STUNError.networkError(error.localizedDescription)))
                }
                
            default:
                break
            }
        }
        
        // Set timeout
        DispatchQueue.main.asyncAfter(deadline: .now() + STUNConstants.requestTimeout, execute: timeoutWork)
        
        connection.start(queue: .main)
    }
    
    private nonisolated func createBindingRequest() -> Data {
        var data = Data()
        
        // Message type: Binding Request
        data.append(contentsOf: withUnsafeBytes(of: STUNConstants.bindingRequest.bigEndian) { Array($0) })
        
        // Message length (0 for simple request)
        data.append(contentsOf: [0x00, 0x00])
        
        // Magic cookie
        data.append(contentsOf: withUnsafeBytes(of: STUNConstants.magicCookie.bigEndian) { Array($0) })
        
        // Transaction ID (12 random bytes)
        var transactionId = [UInt8](repeating: 0, count: 12)
        for i in 0..<12 {
            transactionId[i] = UInt8.random(in: 0...255)
        }
        data.append(contentsOf: transactionId)
        
        return data
    }
    
    private nonisolated func parseBindingResponse(_ data: Data) -> PublicAddressInfo? {
        guard data.count >= 20 else { return nil }
        
        // Check message type
        let messageType = UInt16(data[0]) << 8 | UInt16(data[1])
        guard messageType == STUNConstants.bindingResponse else { return nil }
        
        // Get message length
        let messageLength = Int(UInt16(data[2]) << 8 | UInt16(data[3]))
        guard data.count >= 20 + messageLength else { return nil }
        
        // Parse attributes
        var offset = 20
        var mappedAddress: String?
        var mappedPort: UInt16?
        
        while offset + 4 <= data.count {
            let attrType = UInt16(data[offset]) << 8 | UInt16(data[offset + 1])
            let attrLength = Int(UInt16(data[offset + 2]) << 8 | UInt16(data[offset + 3]))
            offset += 4
            
            guard offset + attrLength <= data.count else { break }
            
            if attrType == STUNConstants.xorMappedAddress || attrType == STUNConstants.mappedAddress {
                // Parse address
                let family = data[offset + 1]
                
                if family == 0x01 { // IPv4
                    let portBytes = [data[offset + 2], data[offset + 3]]
                    var port = UInt16(portBytes[0]) << 8 | UInt16(portBytes[1])
                    
                    var ip = [data[offset + 4], data[offset + 5], data[offset + 6], data[offset + 7]]
                    
                    // XOR for XOR-MAPPED-ADDRESS
                    if attrType == STUNConstants.xorMappedAddress {
                        port ^= UInt16(STUNConstants.magicCookie >> 16)
                        ip[0] ^= UInt8((STUNConstants.magicCookie >> 24) & 0xFF)
                        ip[1] ^= UInt8((STUNConstants.magicCookie >> 16) & 0xFF)
                        ip[2] ^= UInt8((STUNConstants.magicCookie >> 8) & 0xFF)
                        ip[3] ^= UInt8(STUNConstants.magicCookie & 0xFF)
                    }
                    
                    mappedAddress = "\(ip[0]).\(ip[1]).\(ip[2]).\(ip[3])"
                    mappedPort = port
                    break
                }
            }
            
            // Move to next attribute (4-byte aligned)
            offset += (attrLength + 3) & ~3
        }
        
        guard let address = mappedAddress, let port = mappedPort else {
            return nil
        }
        
        return PublicAddressInfo(
            address: address,
            port: port,
            natType: .unknown, // Would need more tests
            localAddress: nil,
            localPort: nil
        )
    }
}

// MARK: - ICE Candidate

public struct ICECandidate: Codable, Equatable {
    public let foundation: String
    public let component: Int
    public let transport: String
    public let priority: UInt32
    public let address: String
    public let port: UInt16
    public let type: CandidateType
    public let relatedAddress: String?
    public let relatedPort: UInt16?
    
    public enum CandidateType: String, Codable {
        case host = "host"
        case serverReflexive = "srflx"
        case peerReflexive = "prflx"
        case relay = "relay"
    }
    
    public init(
        foundation: String,
        component: Int = 1,
        transport: String = "udp",
        priority: UInt32,
        address: String,
        port: UInt16,
        type: CandidateType,
        relatedAddress: String? = nil,
        relatedPort: UInt16? = nil
    ) {
        self.foundation = foundation
        self.component = component
        self.transport = transport
        self.priority = priority
        self.address = address
        self.port = port
        self.type = type
        self.relatedAddress = relatedAddress
        self.relatedPort = relatedPort
    }
    
    /// Calculate priority based on ICE spec
    public static func calculatePriority(type: CandidateType, localPreference: UInt32 = 65535, component: Int = 1) -> UInt32 {
        let typePreference: UInt32
        switch type {
        case .host: typePreference = 126
        case .peerReflexive: typePreference = 110
        case .serverReflexive: typePreference = 100
        case .relay: typePreference = 0
        }
        
        return (typePreference << 24) | (localPreference << 8) | UInt32(256 - component)
    }
}

// MARK: - ICE Gatherer

public actor ICEGatherer {
    
    private let natManager: NATTraversalManager
    private var candidates: [ICECandidate] = []
    
    public init(natManager: NATTraversalManager? = nil) {
        self.natManager = natManager ?? NATTraversalManager()
    }
    
    /// Gather all ICE candidates
    public func gatherCandidates() async -> [ICECandidate] {
        candidates.removeAll()
        
        // Gather host candidates (local addresses)
        await gatherHostCandidates()
        
        // Gather server-reflexive candidates (STUN)
        await gatherServerReflexiveCandidates()
        
        // Sort by priority
        candidates.sort { $0.priority > $1.priority }
        
        return candidates
    }
    
    private func gatherHostCandidates() async {
        // Get local network interfaces
        var ifaddr: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&ifaddr) == 0, let firstAddr = ifaddr else { return }
        defer { freeifaddrs(ifaddr) }
        
        var currentAddr: UnsafeMutablePointer<ifaddrs>? = firstAddr
        
        while let addr = currentAddr {
            let interface = addr.pointee
            let family = interface.ifa_addr.pointee.sa_family
            
            if family == UInt8(AF_INET) { // IPv4
                var hostname = [CChar](repeating: 0, count: Int(NI_MAXHOST))
                let result = getnameinfo(
                    interface.ifa_addr,
                    socklen_t(MemoryLayout<sockaddr_in>.size),
                    &hostname,
                    socklen_t(hostname.count),
                    nil,
                    0,
                    NI_NUMERICHOST
                )
                
                if result == 0 {
                    let address = String(cString: hostname)
                    
                    // Skip loopback
                    if !address.hasPrefix("127.") {
                        let candidate = ICECandidate(
                            foundation: "host-\(address.hashValue)",
                            priority: ICECandidate.calculatePriority(type: .host),
                            address: address,
                            port: 0, // Actual port determined when binding
                            type: .host
                        )
                        candidates.append(candidate)
                    }
                }
            }
            
            currentAddr = interface.ifa_next
        }
    }
    
    private func gatherServerReflexiveCandidates() async {
        do {
            let publicInfo = try await natManager.discoverPublicAddress()
            
            let candidate = ICECandidate(
                foundation: "srflx-\(publicInfo.address.hashValue)",
                priority: ICECandidate.calculatePriority(type: .serverReflexive),
                address: publicInfo.address,
                port: publicInfo.port,
                type: .serverReflexive,
                relatedAddress: publicInfo.localAddress,
                relatedPort: publicInfo.localPort
            )
            candidates.append(candidate)
            
        } catch {
            print("[ICEGatherer] Failed to gather server-reflexive candidates: \(error)")
        }
    }
}
