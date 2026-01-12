//
//  BloomFilter.swift
//  RailGun Node Mode
//
//  Space-efficient probabilistic data structure for bundle deduplication
//

import Foundation
import CommonCrypto

// MARK: - Bloom Filter

/// A space-efficient probabilistic set membership data structure.
/// Used for deduplication in epidemic routing - prevents message loops.
public struct BloomFilter {
    
    // MARK: - Properties
    
    /// The bit array
    private var bits: [UInt64]
    
    /// Number of bits in the filter
    public let bitCount: Int
    
    /// Number of hash functions
    public let hashCount: Int
    
    /// Number of items added
    public private(set) var itemCount: Int = 0
    
    /// Timestamp when created
    public let createdAt: Int64
    
    // MARK: - Computed Properties
    
    /// Current estimated false positive rate
    public var estimatedFalsePositiveRate: Double {
        let k = Double(hashCount)
        let n = Double(itemCount)
        let m = Double(bitCount)
        
        guard n > 0 else { return 0 }
        
        return pow(1.0 - exp(-k * n / m), k)
    }
    
    /// Fill ratio (proportion of bits set to 1)
    public var fillRatio: Double {
        var setCount = 0
        for word in bits {
            setCount += word.nonzeroBitCount
        }
        return Double(setCount) / Double(bitCount)
    }
    
    // MARK: - Initialization
    
    /// Create a bloom filter with specified parameters
    /// - Parameters:
    ///   - expectedElements: Expected number of elements to store
    ///   - falsePositiveRate: Desired false positive rate (0.01 = 1%)
    public init(expectedElements: Int = 10_000, falsePositiveRate: Double = 0.01) {
        precondition(expectedElements > 0, "Expected elements must be positive")
        precondition(falsePositiveRate > 0 && falsePositiveRate < 1, "False positive rate must be between 0 and 1")
        
        // Calculate optimal bit count: m = -n * ln(p) / (ln(2))^2
        let n = Double(expectedElements)
        let p = falsePositiveRate
        let m = -n * log(p) / pow(log(2), 2)
        
        // Calculate optimal hash count: k = (m/n) * ln(2)
        let k = (m / n) * log(2)
        
        self.bitCount = Int(m.rounded(.up))
        self.hashCount = max(1, Int(k.rounded()))
        
        // Initialize bit array (using 64-bit words)
        let wordCount = (bitCount + 63) / 64
        self.bits = [UInt64](repeating: 0, count: wordCount)
        
        self.createdAt = Int64(Date().timeIntervalSince1970 * 1000)
    }
    
    /// Create from serialized data
    public init(data: Data) throws {
        guard data.count >= 24 else {
            throw BloomFilterError.invalidData
        }
        
        var offset = 0
        
        // Read header
        let bitCount = data.subdata(in: offset..<(offset + 8))
            .withUnsafeBytes { $0.load(as: Int.self) }
        offset += 8
        
        let hashCount = data.subdata(in: offset..<(offset + 8))
            .withUnsafeBytes { $0.load(as: Int.self) }
        offset += 8
        
        let itemCount = data.subdata(in: offset..<(offset + 8))
            .withUnsafeBytes { $0.load(as: Int.self) }
        offset += 8
        
        let createdAt = data.subdata(in: offset..<(offset + 8))
            .withUnsafeBytes { $0.load(as: Int64.self) }
        offset += 8
        
        // Calculate expected word count
        let wordCount = (bitCount + 63) / 64
        let expectedDataSize = 32 + (wordCount * 8)
        
        guard data.count >= expectedDataSize else {
            throw BloomFilterError.invalidData
        }
        
        // Read bit array
        var bits = [UInt64]()
        bits.reserveCapacity(wordCount)
        
        for _ in 0..<wordCount {
            let word = data.subdata(in: offset..<(offset + 8))
                .withUnsafeBytes { $0.load(as: UInt64.self) }
            bits.append(word)
            offset += 8
        }
        
        self.bitCount = bitCount
        self.hashCount = hashCount
        self.itemCount = itemCount
        self.createdAt = createdAt
        self.bits = bits
    }
    
    // MARK: - Operations
    
    /// Add an item to the bloom filter
    public mutating func add(_ item: String) {
        add(item.data(using: .utf8)!)
    }
    
    /// Add an item to the bloom filter
    public mutating func add(_ item: Data) {
        let hashes = computeHashes(item)
        
        for hash in hashes {
            let index = hash % UInt64(bitCount)
            let wordIndex = Int(index / 64)
            let bitIndex = Int(index % 64)
            bits[wordIndex] |= (1 << bitIndex)
        }
        
        itemCount += 1
    }
    
    /// Add a UUID to the bloom filter
    public mutating func add(_ uuid: UUID) {
        add(uuid.uuidString)
    }
    
    /// Check if an item might be in the set
    /// Returns false if definitely not in set, true if possibly in set
    public func mightContain(_ item: String) -> Bool {
        mightContain(item.data(using: .utf8)!)
    }
    
    /// Check if an item might be in the set
    public func mightContain(_ item: Data) -> Bool {
        let hashes = computeHashes(item)
        
        for hash in hashes {
            let index = hash % UInt64(bitCount)
            let wordIndex = Int(index / 64)
            let bitIndex = Int(index % 64)
            
            if (bits[wordIndex] & (1 << bitIndex)) == 0 {
                return false
            }
        }
        
        return true
    }
    
    /// Check if a UUID might be in the set
    public func mightContain(_ uuid: UUID) -> Bool {
        mightContain(uuid.uuidString)
    }
    
    /// Union two bloom filters (combine their sets)
    public mutating func union(with other: BloomFilter) throws {
        guard bitCount == other.bitCount && hashCount == other.hashCount else {
            throw BloomFilterError.incompatibleFilters
        }
        
        for i in 0..<bits.count {
            bits[i] |= other.bits[i]
        }
        
        // Item count is approximate after union
        itemCount = max(itemCount, other.itemCount)
    }
    
    /// Clear all items
    public mutating func clear() {
        for i in 0..<bits.count {
            bits[i] = 0
        }
        itemCount = 0
    }
    
    // MARK: - Serialization
    
    /// Serialize bloom filter to Data
    public func serialize() -> Data {
        var data = Data()
        
        // Header
        withUnsafeBytes(of: bitCount) { data.append(contentsOf: $0) }
        withUnsafeBytes(of: hashCount) { data.append(contentsOf: $0) }
        withUnsafeBytes(of: itemCount) { data.append(contentsOf: $0) }
        withUnsafeBytes(of: createdAt) { data.append(contentsOf: $0) }
        
        // Bit array
        for word in bits {
            withUnsafeBytes(of: word) { data.append(contentsOf: $0) }
        }
        
        return data
    }
    
    // MARK: - Hash Functions
    
    /// Compute multiple hash values using double hashing
    /// h_i(x) = h1(x) + i * h2(x)
    private func computeHashes(_ data: Data) -> [UInt64] {
        // Use SHA-256 to get two 128-bit hash values
        var hash = [UInt8](repeating: 0, count: 32)
        data.withUnsafeBytes { ptr in
            _ = CC_SHA256(ptr.baseAddress, CC_LONG(data.count), &hash)
        }
        
        // Split into two 64-bit values
        let hash1 = hash[0..<8].withUnsafeBytes { $0.load(as: UInt64.self) }
        let hash2 = hash[8..<16].withUnsafeBytes { $0.load(as: UInt64.self) }
        
        // Generate k hashes using double hashing
        var hashes = [UInt64]()
        hashes.reserveCapacity(hashCount)
        
        for i in 0..<hashCount {
            let combined = hash1 &+ UInt64(i) &* hash2
            hashes.append(combined)
        }
        
        return hashes
    }
}

// MARK: - Bloom Filter Error

public enum BloomFilterError: Error, LocalizedError {
    case invalidData
    case incompatibleFilters
    
    public var errorDescription: String? {
        switch self {
        case .invalidData:
            return "Invalid bloom filter data"
        case .incompatibleFilters:
            return "Bloom filters have incompatible parameters"
        }
    }
}

// MARK: - Scalable Bloom Filter

/// A bloom filter that automatically scales by adding new filters
/// when the false positive rate exceeds a threshold
public class ScalableBloomFilter {
    
    // MARK: - Properties
    
    private var filters: [BloomFilter] = []
    private let initialCapacity: Int
    private let targetFalsePositiveRate: Double
    private let growthFactor: Double
    
    /// Total number of items across all filters
    public var itemCount: Int {
        filters.reduce(0) { $0 + $1.itemCount }
    }
    
    /// Number of internal filters
    public var filterCount: Int {
        filters.count
    }
    
    // MARK: - Initialization
    
    public init(
        initialCapacity: Int = 10_000,
        falsePositiveRate: Double = 0.01,
        growthFactor: Double = 2.0
    ) {
        self.initialCapacity = initialCapacity
        self.targetFalsePositiveRate = falsePositiveRate
        self.growthFactor = growthFactor
        
        // Create initial filter
        filters.append(BloomFilter(
            expectedElements: initialCapacity,
            falsePositiveRate: falsePositiveRate
        ))
    }
    
    // MARK: - Operations
    
    /// Add an item to the bloom filter
    public func add(_ item: String) {
        add(item.data(using: .utf8)!)
    }
    
    /// Add an item to the bloom filter
    public func add(_ item: Data) {
        // Check if current filter is getting full
        if let lastFilter = filters.last,
           lastFilter.estimatedFalsePositiveRate > targetFalsePositiveRate {
            // Add a new filter with larger capacity
            let newCapacity = Int(Double(initialCapacity) * pow(growthFactor, Double(filters.count)))
            let newFPRate = targetFalsePositiveRate * pow(0.5, Double(filters.count))
            filters.append(BloomFilter(
                expectedElements: newCapacity,
                falsePositiveRate: max(newFPRate, 0.001)
            ))
        }
        
        // Add to the last filter
        filters[filters.count - 1].add(item)
    }
    
    /// Add a UUID to the bloom filter
    public func add(_ uuid: UUID) {
        add(uuid.uuidString)
    }
    
    /// Check if an item might be in the set
    public func mightContain(_ item: String) -> Bool {
        mightContain(item.data(using: .utf8)!)
    }
    
    /// Check if an item might be in the set
    public func mightContain(_ item: Data) -> Bool {
        // Check all filters (any positive is a positive)
        for filter in filters {
            if filter.mightContain(item) {
                return true
            }
        }
        return false
    }
    
    /// Check if a UUID might be in the set
    public func mightContain(_ uuid: UUID) -> Bool {
        mightContain(uuid.uuidString)
    }
    
    /// Clear all filters
    public func clear() {
        filters.removeAll()
        filters.append(BloomFilter(
            expectedElements: initialCapacity,
            falsePositiveRate: targetFalsePositiveRate
        ))
    }
}
