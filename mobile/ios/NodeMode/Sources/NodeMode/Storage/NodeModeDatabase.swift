//
//  NodeModeDatabase.swift
//  RailGun Node Mode
//
//  SQLite database for bundle storage and node registry
//

import Foundation
import SQLite3

// MARK: - Database Error

public enum DatabaseError: Error, LocalizedError {
    case openFailed(String)
    case prepareFailed(String)
    case executeFailed(String)
    case bindFailed(String)
    case stepFailed(String)
    case notFound
    case duplicateKey
    case storageLimitExceeded
    
    public var errorDescription: String? {
        switch self {
        case .openFailed(let msg): return "Failed to open database: \(msg)"
        case .prepareFailed(let msg): return "Failed to prepare statement: \(msg)"
        case .executeFailed(let msg): return "Failed to execute: \(msg)"
        case .bindFailed(let msg): return "Failed to bind parameter: \(msg)"
        case .stepFailed(let msg): return "Failed to step: \(msg)"
        case .notFound: return "Record not found"
        case .duplicateKey: return "Duplicate key"
        case .storageLimitExceeded: return "Storage limit exceeded"
        }
    }
}

// MARK: - Node Mode Database

public actor NodeModeDatabase {
    
    // MARK: - Properties
    
    private var db: OpaquePointer?
    private let path: String
    private var isOpen = false
    
    // MARK: - Initialization
    
    public init(path: String? = nil) {
        if let path = path {
            self.path = path
        } else {
            let documentsPath = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
            try? FileManager.default.createDirectory(at: documentsPath, withIntermediateDirectories: true)
            self.path = documentsPath.appendingPathComponent("nodemode.db").path
        }
    }
    
    deinit {
        if let db = db {
            sqlite3_close(db)
        }
    }
    
    // MARK: - Open / Close
    
    public func open() throws {
        guard !isOpen else { return }
        
        var dbPointer: OpaquePointer?
        let result = sqlite3_open(path, &dbPointer)
        
        guard result == SQLITE_OK, let pointer = dbPointer else {
            let errorMsg = String(cString: sqlite3_errmsg(dbPointer))
            sqlite3_close(dbPointer)
            throw DatabaseError.openFailed(errorMsg)
        }
        
        db = pointer
        isOpen = true
        
        // Enable WAL mode for better concurrency
        try execute("PRAGMA journal_mode=WAL")
        try execute("PRAGMA foreign_keys=ON")
        
        // Create tables
        try createTables()
    }
    
    public func close() {
        guard isOpen, let db = db else { return }
        sqlite3_close(db)
        self.db = nil
        isOpen = false
    }
    
    // MARK: - Schema
    
    private func createTables() throws {
        // Bundles table
        try execute("""
            CREATE TABLE IF NOT EXISTS bundles (
                id TEXT PRIMARY KEY NOT NULL,
                version INTEGER NOT NULL DEFAULT 1,
                flags INTEGER NOT NULL DEFAULT 0,
                priority INTEGER NOT NULL DEFAULT 1,
                hop_count INTEGER NOT NULL DEFAULT 0,
                max_hops INTEGER NOT NULL DEFAULT 10,
                created_at INTEGER NOT NULL,
                expires_at INTEGER NOT NULL,
                received_at INTEGER NOT NULL,
                source_node BLOB NOT NULL,
                destination_type INTEGER NOT NULL,
                destination BLOB NOT NULL,
                geo_hash TEXT,
                payload BLOB NOT NULL,
                payload_size INTEGER NOT NULL,
                signature BLOB NOT NULL,
                state INTEGER NOT NULL DEFAULT 0,
                delivery_attempts INTEGER NOT NULL DEFAULT 0,
                last_attempt_at INTEGER,
                delivered_at INTEGER,
                delivered_to BLOB,
                is_own_message INTEGER NOT NULL DEFAULT 0,
                is_outgoing INTEGER NOT NULL DEFAULT 0
            )
        """)
        
        // Bundle indexes
        try execute("CREATE INDEX IF NOT EXISTS idx_bundles_expires ON bundles(expires_at)")
        try execute("CREATE INDEX IF NOT EXISTS idx_bundles_state ON bundles(state)")
        try execute("CREATE INDEX IF NOT EXISTS idx_bundles_destination ON bundles(destination_type, destination)")
        try execute("CREATE INDEX IF NOT EXISTS idx_bundles_priority ON bundles(priority DESC, created_at ASC)")
        
        // Nodes table
        try execute("""
            CREATE TABLE IF NOT EXISTS nodes (
                node_id TEXT PRIMARY KEY NOT NULL,
                user_id TEXT,
                display_name TEXT,
                capabilities INTEGER NOT NULL DEFAULT 0,
                first_seen INTEGER NOT NULL,
                last_seen INTEGER NOT NULL,
                times_seen INTEGER NOT NULL DEFAULT 1,
                last_geo_hash TEXT,
                last_geo_accuracy INTEGER,
                reputation REAL NOT NULL DEFAULT 0.5,
                reputation_samples INTEGER NOT NULL DEFAULT 0,
                bundles_received_from INTEGER NOT NULL DEFAULT 0,
                bundles_sent_to INTEGER NOT NULL DEFAULT 0,
                bytes_received_from INTEGER NOT NULL DEFAULT 0,
                bytes_sent_to INTEGER NOT NULL DEFAULT 0,
                delivery_successes INTEGER NOT NULL DEFAULT 0,
                delivery_failures INTEGER NOT NULL DEFAULT 0,
                delivery_predictability REAL NOT NULL DEFAULT 0.0,
                predictability_updated_at INTEGER,
                last_connection_type TEXT,
                last_rssi INTEGER
            )
        """)
        
        // Node indexes
        try execute("CREATE INDEX IF NOT EXISTS idx_nodes_last_seen ON nodes(last_seen DESC)")
        try execute("CREATE INDEX IF NOT EXISTS idx_nodes_user_id ON nodes(user_id)")
        try execute("CREATE INDEX IF NOT EXISTS idx_nodes_reputation ON nodes(reputation DESC)")
        
        // Routing hints table
        try execute("""
            CREATE TABLE IF NOT EXISTS routing_hints (
                destination BLOB NOT NULL,
                destination_type INTEGER NOT NULL,
                next_hop TEXT NOT NULL,
                hops_away INTEGER NOT NULL,
                predictability REAL NOT NULL DEFAULT 0.0,
                last_updated INTEGER NOT NULL,
                confidence REAL NOT NULL DEFAULT 0.5,
                times_used INTEGER NOT NULL DEFAULT 0,
                times_succeeded INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (destination, destination_type, next_hop),
                FOREIGN KEY (next_hop) REFERENCES nodes(node_id) ON DELETE CASCADE
            )
        """)
        
        // Bloom filter state
        try execute("""
            CREATE TABLE IF NOT EXISTS bloom_state (
                id INTEGER PRIMARY KEY,
                filter_data BLOB NOT NULL,
                entry_count INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL,
                bit_count INTEGER NOT NULL,
                hash_count INTEGER NOT NULL
            )
        """)
        
        // Metrics table
        try execute("""
            CREATE TABLE IF NOT EXISTS metrics (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                bucket_start INTEGER NOT NULL UNIQUE,
                bucket_end INTEGER NOT NULL,
                peers_discovered INTEGER NOT NULL DEFAULT 0,
                peers_connected INTEGER NOT NULL DEFAULT 0,
                bundles_created INTEGER NOT NULL DEFAULT 0,
                bundles_received INTEGER NOT NULL DEFAULT 0,
                bundles_relayed INTEGER NOT NULL DEFAULT 0,
                bundles_delivered INTEGER NOT NULL DEFAULT 0,
                bundles_expired INTEGER NOT NULL DEFAULT 0,
                bytes_sent INTEGER NOT NULL DEFAULT 0,
                bytes_received INTEGER NOT NULL DEFAULT 0
            )
        """)
    }
    
    // MARK: - Execute Helpers
    
    private func execute(_ sql: String) throws {
        guard let db = db else { throw DatabaseError.openFailed("Database not open") }
        
        var errorMsg: UnsafeMutablePointer<CChar>?
        let result = sqlite3_exec(db, sql, nil, nil, &errorMsg)
        
        if result != SQLITE_OK {
            let error = errorMsg.map { String(cString: $0) } ?? "Unknown error"
            sqlite3_free(errorMsg)
            throw DatabaseError.executeFailed(error)
        }
    }
    
    private func prepare(_ sql: String) throws -> OpaquePointer {
        guard let db = db else { throw DatabaseError.openFailed("Database not open") }
        
        var stmt: OpaquePointer?
        let result = sqlite3_prepare_v2(db, sql, -1, &stmt, nil)
        
        guard result == SQLITE_OK, let statement = stmt else {
            let error = String(cString: sqlite3_errmsg(db))
            throw DatabaseError.prepareFailed(error)
        }
        
        return statement
    }
    
    // MARK: - Bundle Operations
    
    public func insertBundle(_ bundle: Bundle) throws {
        let sql = """
            INSERT INTO bundles (
                id, version, flags, priority, hop_count, max_hops,
                created_at, expires_at, received_at, source_node,
                destination_type, destination, geo_hash, payload,
                payload_size, signature, state, is_own_message, is_outgoing
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """
        
        let stmt = try prepare(sql)
        defer { sqlite3_finalize(stmt) }
        
        sqlite3_bind_text(stmt, 1, bundle.id.uuidString, -1, nil)
        sqlite3_bind_int(stmt, 2, Int32(bundle.version))
        sqlite3_bind_int(stmt, 3, Int32(bundle.flags.rawValue))
        sqlite3_bind_int(stmt, 4, Int32(bundle.priority.rawValue))
        sqlite3_bind_int(stmt, 5, Int32(bundle.hopCount))
        sqlite3_bind_int(stmt, 6, Int32(bundle.maxHops))
        sqlite3_bind_int64(stmt, 7, bundle.createdAt)
        sqlite3_bind_int64(stmt, 8, bundle.expiresAt)
        sqlite3_bind_int64(stmt, 9, bundle.receivedAt)
        bundle.sourceNode.withUnsafeBytes { ptr in
            sqlite3_bind_blob(stmt, 10, ptr.baseAddress, Int32(bundle.sourceNode.count), nil)
        }
        sqlite3_bind_int(stmt, 11, Int32(bundle.destinationType.rawValue))
        bundle.destination.withUnsafeBytes { ptr in
            sqlite3_bind_blob(stmt, 12, ptr.baseAddress, Int32(bundle.destination.count), nil)
        }
        if let geoHash = bundle.geoHash {
            sqlite3_bind_text(stmt, 13, geoHash, -1, nil)
        } else {
            sqlite3_bind_null(stmt, 13)
        }
        bundle.payload.withUnsafeBytes { ptr in
            sqlite3_bind_blob(stmt, 14, ptr.baseAddress, Int32(bundle.payload.count), nil)
        }
        sqlite3_bind_int(stmt, 15, Int32(bundle.payloadSize))
        bundle.signature.withUnsafeBytes { ptr in
            sqlite3_bind_blob(stmt, 16, ptr.baseAddress, Int32(bundle.signature.count), nil)
        }
        sqlite3_bind_int(stmt, 17, Int32(bundle.state.rawValue))
        sqlite3_bind_int(stmt, 18, bundle.isOwnMessage ? 1 : 0)
        sqlite3_bind_int(stmt, 19, bundle.isOutgoing ? 1 : 0)
        
        let result = sqlite3_step(stmt)
        guard result == SQLITE_DONE else {
            if result == SQLITE_CONSTRAINT {
                throw DatabaseError.duplicateKey
            }
            throw DatabaseError.stepFailed(String(cString: sqlite3_errmsg(db)))
        }
    }
    
    public func getBundle(id: UUID) throws -> Bundle? {
        let sql = "SELECT * FROM bundles WHERE id = ?"
        let stmt = try prepare(sql)
        defer { sqlite3_finalize(stmt) }
        
        sqlite3_bind_text(stmt, 1, id.uuidString, -1, nil)
        
        guard sqlite3_step(stmt) == SQLITE_ROW else {
            return nil
        }
        
        return bundleFromStatement(stmt)
    }
    
    public func getRelayQueue(limit: Int) throws -> [Bundle] {
        let sql = """
            SELECT * FROM bundles
            WHERE is_own_message = 0 AND state = 0 AND expires_at > ?
            ORDER BY priority DESC, created_at ASC
            LIMIT ?
        """
        
        let stmt = try prepare(sql)
        defer { sqlite3_finalize(stmt) }
        
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        sqlite3_bind_int64(stmt, 1, now)
        sqlite3_bind_int(stmt, 2, Int32(limit))
        
        var bundles: [Bundle] = []
        while sqlite3_step(stmt) == SQLITE_ROW {
            if let bundle = bundleFromStatement(stmt) {
                bundles.append(bundle)
            }
        }
        
        return bundles
    }
    
    public func getOwnPendingMessages() throws -> [Bundle] {
        let sql = "SELECT * FROM bundles WHERE is_own_message = 1 AND state = 0 ORDER BY created_at DESC"
        let stmt = try prepare(sql)
        defer { sqlite3_finalize(stmt) }
        
        var bundles: [Bundle] = []
        while sqlite3_step(stmt) == SQLITE_ROW {
            if let bundle = bundleFromStatement(stmt) {
                bundles.append(bundle)
            }
        }
        
        return bundles
    }
    
    public func markDelivered(bundleId: UUID, toNode: Data) throws {
        let sql = "UPDATE bundles SET state = 1, delivered_at = ?, delivered_to = ? WHERE id = ?"
        let stmt = try prepare(sql)
        defer { sqlite3_finalize(stmt) }
        
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        sqlite3_bind_int64(stmt, 1, now)
        toNode.withUnsafeBytes { ptr in
            sqlite3_bind_blob(stmt, 2, ptr.baseAddress, Int32(toNode.count), nil)
        }
        sqlite3_bind_text(stmt, 3, bundleId.uuidString, -1, nil)
        
        guard sqlite3_step(stmt) == SQLITE_DONE else {
            throw DatabaseError.stepFailed(String(cString: sqlite3_errmsg(db)))
        }
    }
    
    public func expireOldBundles() throws -> Int {
        let sql = "UPDATE bundles SET state = 3 WHERE state = 0 AND expires_at < ?"
        let stmt = try prepare(sql)
        defer { sqlite3_finalize(stmt) }
        
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        sqlite3_bind_int64(stmt, 1, now)
        
        guard sqlite3_step(stmt) == SQLITE_DONE else {
            throw DatabaseError.stepFailed(String(cString: sqlite3_errmsg(db)))
        }
        
        return Int(sqlite3_changes(db))
    }
    
    public func deleteBundle(id: UUID) throws {
        let sql = "DELETE FROM bundles WHERE id = ?"
        let stmt = try prepare(sql)
        defer { sqlite3_finalize(stmt) }
        
        sqlite3_bind_text(stmt, 1, id.uuidString, -1, nil)
        
        guard sqlite3_step(stmt) == SQLITE_DONE else {
            throw DatabaseError.stepFailed(String(cString: sqlite3_errmsg(db)))
        }
    }
    
    public func getStorageStats() throws -> (bundleCount: Int, totalBytes: Int64) {
        let countSql = "SELECT COUNT(*) FROM bundles"
        let bytesSql = "SELECT COALESCE(SUM(payload_size), 0) FROM bundles"
        
        let countStmt = try prepare(countSql)
        defer { sqlite3_finalize(countStmt) }
        
        let bytesStmt = try prepare(bytesSql)
        defer { sqlite3_finalize(bytesStmt) }
        
        var count = 0
        if sqlite3_step(countStmt) == SQLITE_ROW {
            count = Int(sqlite3_column_int(countStmt, 0))
        }
        
        var bytes: Int64 = 0
        if sqlite3_step(bytesStmt) == SQLITE_ROW {
            bytes = sqlite3_column_int64(bytesStmt, 0)
        }
        
        return (count, bytes)
    }
    
    private func bundleFromStatement(_ stmt: OpaquePointer) -> Bundle? {
        guard let idString = sqlite3_column_text(stmt, 0).map({ String(cString: $0) }),
              let id = UUID(uuidString: idString) else {
            return nil
        }
        
        let version = UInt8(sqlite3_column_int(stmt, 1))
        let flags = BundleFlags(rawValue: UInt8(sqlite3_column_int(stmt, 2)))
        let priority = BundlePriority(rawValue: Int(sqlite3_column_int(stmt, 3))) ?? .normal
        let hopCount = UInt8(sqlite3_column_int(stmt, 4))
        let maxHops = UInt8(sqlite3_column_int(stmt, 5))
        let createdAt = sqlite3_column_int64(stmt, 6)
        let expiresAt = sqlite3_column_int64(stmt, 7)
        let receivedAt = sqlite3_column_int64(stmt, 8)
        
        let sourceNodePtr = sqlite3_column_blob(stmt, 9)
        let sourceNodeLen = sqlite3_column_bytes(stmt, 9)
        let sourceNode = Data(bytes: sourceNodePtr!, count: Int(sourceNodeLen))
        
        let destinationType = DestinationType(rawValue: Int(sqlite3_column_int(stmt, 10))) ?? .user
        
        let destPtr = sqlite3_column_blob(stmt, 11)
        let destLen = sqlite3_column_bytes(stmt, 11)
        let destination = Data(bytes: destPtr!, count: Int(destLen))
        
        let geoHash = sqlite3_column_text(stmt, 12).map { String(cString: $0) }
        
        let payloadPtr = sqlite3_column_blob(stmt, 13)
        let payloadLen = sqlite3_column_bytes(stmt, 13)
        let payload = Data(bytes: payloadPtr!, count: Int(payloadLen))
        
        let sigPtr = sqlite3_column_blob(stmt, 15)
        let sigLen = sqlite3_column_bytes(stmt, 15)
        let signature = Data(bytes: sigPtr!, count: Int(sigLen))
        
        var bundle = Bundle(
            id: id,
            version: version,
            flags: flags,
            priority: priority,
            hopCount: hopCount,
            maxHops: maxHops,
            createdAt: createdAt,
            expiresAt: expiresAt,
            sourceNode: sourceNode,
            destinationType: destinationType,
            destination: destination,
            geoHash: geoHash,
            payload: payload,
            signature: signature
        )
        
        bundle.receivedAt = receivedAt
        bundle.state = BundleState(rawValue: Int(sqlite3_column_int(stmt, 16))) ?? .pending
        bundle.deliveryAttempts = Int(sqlite3_column_int(stmt, 17))
        bundle.isOwnMessage = sqlite3_column_int(stmt, 21) != 0
        bundle.isOutgoing = sqlite3_column_int(stmt, 22) != 0
        
        return bundle
    }
    
    // MARK: - Node Operations
    
    public func upsertNode(_ node: Node) throws {
        let sql = """
            INSERT INTO nodes (
                node_id, user_id, display_name, capabilities, first_seen, last_seen,
                times_seen, last_geo_hash, last_geo_accuracy, reputation,
                reputation_samples, bundles_received_from, bundles_sent_to,
                bytes_received_from, bytes_sent_to, delivery_successes,
                delivery_failures, delivery_predictability, predictability_updated_at,
                last_connection_type, last_rssi
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(node_id) DO UPDATE SET
                user_id = excluded.user_id,
                display_name = excluded.display_name,
                capabilities = excluded.capabilities,
                last_seen = excluded.last_seen,
                times_seen = excluded.times_seen,
                last_geo_hash = excluded.last_geo_hash,
                last_geo_accuracy = excluded.last_geo_accuracy,
                reputation = excluded.reputation,
                reputation_samples = excluded.reputation_samples,
                bundles_received_from = excluded.bundles_received_from,
                bundles_sent_to = excluded.bundles_sent_to,
                bytes_received_from = excluded.bytes_received_from,
                bytes_sent_to = excluded.bytes_sent_to,
                delivery_successes = excluded.delivery_successes,
                delivery_failures = excluded.delivery_failures,
                delivery_predictability = excluded.delivery_predictability,
                predictability_updated_at = excluded.predictability_updated_at,
                last_connection_type = excluded.last_connection_type,
                last_rssi = excluded.last_rssi
        """
        
        let stmt = try prepare(sql)
        defer { sqlite3_finalize(stmt) }
        
        sqlite3_bind_text(stmt, 1, node.id, -1, nil)
        if let userId = node.userId {
            sqlite3_bind_text(stmt, 2, userId, -1, nil)
        } else {
            sqlite3_bind_null(stmt, 2)
        }
        if let displayName = node.displayName {
            sqlite3_bind_text(stmt, 3, displayName, -1, nil)
        } else {
            sqlite3_bind_null(stmt, 3)
        }
        sqlite3_bind_int(stmt, 4, Int32(node.capabilities.rawValue))
        sqlite3_bind_int64(stmt, 5, node.firstSeen)
        sqlite3_bind_int64(stmt, 6, node.lastSeen)
        sqlite3_bind_int(stmt, 7, Int32(node.timesSeen))
        if let geoHash = node.lastGeoHash {
            sqlite3_bind_text(stmt, 8, geoHash, -1, nil)
        } else {
            sqlite3_bind_null(stmt, 8)
        }
        if let accuracy = node.lastGeoAccuracy {
            sqlite3_bind_int(stmt, 9, Int32(accuracy))
        } else {
            sqlite3_bind_null(stmt, 9)
        }
        sqlite3_bind_double(stmt, 10, node.reputation)
        sqlite3_bind_int(stmt, 11, Int32(node.reputationSamples))
        sqlite3_bind_int(stmt, 12, Int32(node.bundlesReceivedFrom))
        sqlite3_bind_int(stmt, 13, Int32(node.bundlesSentTo))
        sqlite3_bind_int64(stmt, 14, node.bytesReceivedFrom)
        sqlite3_bind_int64(stmt, 15, node.bytesSentTo)
        sqlite3_bind_int(stmt, 16, Int32(node.deliverySuccesses))
        sqlite3_bind_int(stmt, 17, Int32(node.deliveryFailures))
        sqlite3_bind_double(stmt, 18, node.deliveryPredictability)
        if let updatedAt = node.predictabilityUpdatedAt {
            sqlite3_bind_int64(stmt, 19, updatedAt)
        } else {
            sqlite3_bind_null(stmt, 19)
        }
        if let connType = node.lastConnectionType?.rawValue {
            sqlite3_bind_text(stmt, 20, connType, -1, nil)
        } else {
            sqlite3_bind_null(stmt, 20)
        }
        if let rssi = node.lastRssi {
            sqlite3_bind_int(stmt, 21, Int32(rssi))
        } else {
            sqlite3_bind_null(stmt, 21)
        }
        
        guard sqlite3_step(stmt) == SQLITE_DONE else {
            throw DatabaseError.stepFailed(String(cString: sqlite3_errmsg(db)))
        }
    }
    
    public func getNode(id: String) throws -> Node? {
        let sql = "SELECT * FROM nodes WHERE node_id = ?"
        let stmt = try prepare(sql)
        defer { sqlite3_finalize(stmt) }
        
        sqlite3_bind_text(stmt, 1, id, -1, nil)
        
        guard sqlite3_step(stmt) == SQLITE_ROW else {
            return nil
        }
        
        return nodeFromStatement(stmt)
    }
    
    public func getActiveNodes(since: TimeInterval = 3600) throws -> [Node] {
        let sql = "SELECT * FROM nodes WHERE last_seen > ? ORDER BY last_seen DESC"
        let stmt = try prepare(sql)
        defer { sqlite3_finalize(stmt) }
        
        let cutoff = Int64((Date().timeIntervalSince1970 - since) * 1000)
        sqlite3_bind_int64(stmt, 1, cutoff)
        
        var nodes: [Node] = []
        while sqlite3_step(stmt) == SQLITE_ROW {
            if let node = nodeFromStatement(stmt) {
                nodes.append(node)
            }
        }
        
        return nodes
    }
    
    public func getTrustedNodes(minReputation: Double = 0.5) throws -> [Node] {
        let sql = "SELECT * FROM nodes WHERE reputation >= ? ORDER BY reputation DESC"
        let stmt = try prepare(sql)
        defer { sqlite3_finalize(stmt) }
        
        sqlite3_bind_double(stmt, 1, minReputation)
        
        var nodes: [Node] = []
        while sqlite3_step(stmt) == SQLITE_ROW {
            if let node = nodeFromStatement(stmt) {
                nodes.append(node)
            }
        }
        
        return nodes
    }
    
    private func nodeFromStatement(_ stmt: OpaquePointer) -> Node? {
        guard let nodeId = sqlite3_column_text(stmt, 0).map({ String(cString: $0) }) else {
            return nil
        }
        
        let userId = sqlite3_column_text(stmt, 1).map { String(cString: $0) }
        let displayName = sqlite3_column_text(stmt, 2).map { String(cString: $0) }
        let capabilities = NodeCapabilities(rawValue: UInt8(sqlite3_column_int(stmt, 3)))
        let firstSeen = sqlite3_column_int64(stmt, 4)
        let lastSeen = sqlite3_column_int64(stmt, 5)
        let timesSeen = Int(sqlite3_column_int(stmt, 6))
        let lastGeoHash = sqlite3_column_text(stmt, 7).map { String(cString: $0) }
        let lastGeoAccuracy = sqlite3_column_type(stmt, 8) != SQLITE_NULL ? Int(sqlite3_column_int(stmt, 8)) : nil
        let reputation = sqlite3_column_double(stmt, 9)
        let reputationSamples = Int(sqlite3_column_int(stmt, 10))
        let bundlesReceivedFrom = Int(sqlite3_column_int(stmt, 11))
        let bundlesSentTo = Int(sqlite3_column_int(stmt, 12))
        let bytesReceivedFrom = sqlite3_column_int64(stmt, 13)
        let bytesSentTo = sqlite3_column_int64(stmt, 14)
        let deliverySuccesses = Int(sqlite3_column_int(stmt, 15))
        let deliveryFailures = Int(sqlite3_column_int(stmt, 16))
        let deliveryPredictability = sqlite3_column_double(stmt, 17)
        let predictabilityUpdatedAt = sqlite3_column_type(stmt, 18) != SQLITE_NULL ? sqlite3_column_int64(stmt, 18) : nil
        let lastConnectionType = sqlite3_column_text(stmt, 19).flatMap { ConnectionType(rawValue: String(cString: $0)) }
        let lastRssi = sqlite3_column_type(stmt, 20) != SQLITE_NULL ? Int(sqlite3_column_int(stmt, 20)) : nil
        
        return Node(
            id: nodeId,
            userId: userId,
            displayName: displayName,
            capabilities: capabilities,
            firstSeen: firstSeen,
            lastSeen: lastSeen,
            timesSeen: timesSeen,
            lastGeoHash: lastGeoHash,
            lastGeoAccuracy: lastGeoAccuracy,
            reputation: reputation,
            reputationSamples: reputationSamples,
            bundlesReceivedFrom: bundlesReceivedFrom,
            bundlesSentTo: bundlesSentTo,
            bytesReceivedFrom: bytesReceivedFrom,
            bytesSentTo: bytesSentTo,
            deliverySuccesses: deliverySuccesses,
            deliveryFailures: deliveryFailures,
            deliveryPredictability: deliveryPredictability,
            predictabilityUpdatedAt: predictabilityUpdatedAt,
            lastConnectionType: lastConnectionType,
            lastRssi: lastRssi
        )
    }
    
    // MARK: - Bundle ID Check (for bloom filter)
    
    public func bundleExists(id: UUID) throws -> Bool {
        let sql = "SELECT 1 FROM bundles WHERE id = ? LIMIT 1"
        let stmt = try prepare(sql)
        defer { sqlite3_finalize(stmt) }
        
        sqlite3_bind_text(stmt, 1, id.uuidString, -1, nil)
        
        return sqlite3_step(stmt) == SQLITE_ROW
    }
    
    public func getAllBundleIds() throws -> [String] {
        let sql = "SELECT id FROM bundles WHERE state = 0"
        let stmt = try prepare(sql)
        defer { sqlite3_finalize(stmt) }
        
        var ids: [String] = []
        while sqlite3_step(stmt) == SQLITE_ROW {
            if let id = sqlite3_column_text(stmt, 0).map({ String(cString: $0) }) {
                ids.append(id)
            }
        }
        
        return ids
    }
}
