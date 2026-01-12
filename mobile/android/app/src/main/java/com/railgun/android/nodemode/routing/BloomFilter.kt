package com.railgun.android.nodemode.routing

import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.security.MessageDigest
import java.util.BitSet
import java.util.UUID
import kotlin.math.ceil
import kotlin.math.ln
import kotlin.math.pow
import kotlin.math.roundToInt

/**
 * Space-efficient probabilistic data structure for bundle deduplication.
 * 
 * Used in epidemic routing to prevent message loops - peers exchange bloom
 * filters to efficiently determine which bundles the other already has.
 */
class BloomFilter(
    expectedElements: Int = 10_000,
    falsePositiveRate: Double = 0.01
) {
    
    // MARK: - Properties
    
    private val bits: BitSet
    val bitCount: Int
    val hashCount: Int
    var itemCount: Int = 0
        private set
    val createdAt: Long = System.currentTimeMillis()
    
    init {
        require(expectedElements > 0) { "Expected elements must be positive" }
        require(falsePositiveRate in 0.0..1.0) { "False positive rate must be between 0 and 1" }
        
        // Calculate optimal bit count: m = -n * ln(p) / (ln(2))^2
        val n = expectedElements.toDouble()
        val p = falsePositiveRate
        val m = -n * ln(p) / ln(2.0).pow(2)
        
        // Calculate optimal hash count: k = (m/n) * ln(2)
        val k = (m / n) * ln(2.0)
        
        bitCount = ceil(m).toInt()
        hashCount = maxOf(1, k.roundToInt())
        bits = BitSet(bitCount)
    }
    
    /**
     * Create a bloom filter from serialized data
     */
    constructor(data: ByteArray) : this(10_000, 0.01) {
        require(data.size >= 32) { "Invalid bloom filter data" }
        
        val buffer = ByteBuffer.wrap(data).order(ByteOrder.BIG_ENDIAN)
        
        val storedBitCount = buffer.getInt()
        val storedHashCount = buffer.getInt()
        val storedItemCount = buffer.getInt()
        // Skip createdAt (8 bytes) and padding (4 bytes)
        buffer.position(buffer.position() + 12)
        
        // Verify compatibility
        require(storedBitCount == bitCount && storedHashCount == hashCount) {
            "Incompatible bloom filter parameters"
        }
        
        itemCount = storedItemCount
        
        // Read bit array
        val wordCount = (bitCount + 63) / 64
        for (i in 0 until wordCount) {
            if (buffer.remaining() < 8) break
            val word = buffer.getLong()
            for (bit in 0 until 64) {
                if ((word and (1L shl bit)) != 0L) {
                    val bitIndex = i * 64 + bit
                    if (bitIndex < bitCount) {
                        bits.set(bitIndex)
                    }
                }
            }
        }
    }
    
    // MARK: - Computed Properties
    
    /**
     * Current estimated false positive rate
     */
    val estimatedFalsePositiveRate: Double
        get() {
            if (itemCount == 0) return 0.0
            val k = hashCount.toDouble()
            val n = itemCount.toDouble()
            val m = bitCount.toDouble()
            return (1.0 - Math.exp(-k * n / m)).pow(k)
        }
    
    /**
     * Fill ratio (proportion of bits set to 1)
     */
    val fillRatio: Double
        get() = bits.cardinality().toDouble() / bitCount
    
    // MARK: - Operations
    
    /**
     * Add a string to the bloom filter
     */
    fun add(item: String) {
        add(item.toByteArray(Charsets.UTF_8))
    }
    
    /**
     * Add bytes to the bloom filter
     */
    fun add(item: ByteArray) {
        val hashes = computeHashes(item)
        for (hash in hashes) {
            val index = (hash % bitCount.toLong()).toInt().let { if (it < 0) it + bitCount else it }
            bits.set(index)
        }
        itemCount++
    }
    
    /**
     * Add a UUID to the bloom filter
     */
    fun add(uuid: UUID) {
        add(uuid.toString())
    }
    
    /**
     * Check if an item might be in the set
     * Returns false if definitely not in set, true if possibly in set
     */
    fun mightContain(item: String): Boolean {
        return mightContain(item.toByteArray(Charsets.UTF_8))
    }
    
    /**
     * Check if bytes might be in the set
     */
    fun mightContain(item: ByteArray): Boolean {
        val hashes = computeHashes(item)
        for (hash in hashes) {
            val index = (hash % bitCount.toLong()).toInt().let { if (it < 0) it + bitCount else it }
            if (!bits.get(index)) {
                return false
            }
        }
        return true
    }
    
    /**
     * Check if a UUID might be in the set
     */
    fun mightContain(uuid: UUID): Boolean {
        return mightContain(uuid.toString())
    }
    
    /**
     * Union two bloom filters (combine their sets)
     */
    fun union(other: BloomFilter) {
        require(bitCount == other.bitCount && hashCount == other.hashCount) {
            "Bloom filters must have compatible parameters"
        }
        bits.or(other.bits)
        itemCount = maxOf(itemCount, other.itemCount)
    }
    
    /**
     * Clear all items
     */
    fun clear() {
        bits.clear()
        itemCount = 0
    }
    
    // MARK: - Serialization
    
    /**
     * Serialize bloom filter to bytes
     */
    fun serialize(): ByteArray {
        val wordCount = (bitCount + 63) / 64
        val buffer = ByteBuffer.allocate(32 + wordCount * 8).order(ByteOrder.BIG_ENDIAN)
        
        // Header
        buffer.putInt(bitCount)
        buffer.putInt(hashCount)
        buffer.putInt(itemCount)
        buffer.putLong(createdAt)
        buffer.putInt(0) // padding
        
        // Bit array as 64-bit words
        for (i in 0 until wordCount) {
            var word = 0L
            for (bit in 0 until 64) {
                val bitIndex = i * 64 + bit
                if (bitIndex < bitCount && bits.get(bitIndex)) {
                    word = word or (1L shl bit)
                }
            }
            buffer.putLong(word)
        }
        
        return buffer.array()
    }
    
    // MARK: - Hash Functions
    
    /**
     * Compute multiple hash values using double hashing
     * h_i(x) = h1(x) + i * h2(x)
     */
    private fun computeHashes(data: ByteArray): LongArray {
        // Use SHA-256 to get two 64-bit hash values
        val digest = MessageDigest.getInstance("SHA-256")
        val hash = digest.digest(data)
        
        // Split into two 64-bit values
        val hash1 = ByteBuffer.wrap(hash, 0, 8).order(ByteOrder.BIG_ENDIAN).getLong()
        val hash2 = ByteBuffer.wrap(hash, 8, 8).order(ByteOrder.BIG_ENDIAN).getLong()
        
        // Generate k hashes using double hashing
        return LongArray(hashCount) { i ->
            hash1 + i * hash2
        }
    }
    
    companion object {
        /**
         * Calculate optimal parameters for a bloom filter
         */
        fun optimalParameters(expectedElements: Int, falsePositiveRate: Double): Pair<Int, Int> {
            val n = expectedElements.toDouble()
            val p = falsePositiveRate
            val m = -n * ln(p) / ln(2.0).pow(2)
            val k = (m / n) * ln(2.0)
            return Pair(ceil(m).toInt(), maxOf(1, k.roundToInt()))
        }
    }
}

/**
 * A bloom filter that automatically scales by adding new filters
 * when the false positive rate exceeds a threshold
 */
class ScalableBloomFilter(
    private val initialCapacity: Int = 10_000,
    private val targetFalsePositiveRate: Double = 0.01,
    private val growthFactor: Double = 2.0
) {
    private val filters = mutableListOf<BloomFilter>()
    
    init {
        filters.add(BloomFilter(initialCapacity, targetFalsePositiveRate))
    }
    
    val itemCount: Int
        get() = filters.sumOf { it.itemCount }
    
    val filterCount: Int
        get() = filters.size
    
    fun add(item: String) {
        add(item.toByteArray(Charsets.UTF_8))
    }
    
    fun add(item: ByteArray) {
        // Check if current filter is getting full
        val lastFilter = filters.last()
        if (lastFilter.estimatedFalsePositiveRate > targetFalsePositiveRate) {
            // Add a new filter with larger capacity
            val newCapacity = (initialCapacity * growthFactor.pow(filters.size.toDouble())).toInt()
            val newFPRate = maxOf(targetFalsePositiveRate * 0.5.pow(filters.size.toDouble()), 0.001)
            filters.add(BloomFilter(newCapacity, newFPRate))
        }
        
        filters.last().add(item)
    }
    
    fun add(uuid: UUID) {
        add(uuid.toString())
    }
    
    fun mightContain(item: String): Boolean {
        return mightContain(item.toByteArray(Charsets.UTF_8))
    }
    
    fun mightContain(item: ByteArray): Boolean {
        return filters.any { it.mightContain(item) }
    }
    
    fun mightContain(uuid: UUID): Boolean {
        return mightContain(uuid.toString())
    }
    
    fun clear() {
        filters.clear()
        filters.add(BloomFilter(initialCapacity, targetFalsePositiveRate))
    }
}
