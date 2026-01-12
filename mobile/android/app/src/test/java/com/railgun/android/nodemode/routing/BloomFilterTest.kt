package com.railgun.android.nodemode.routing

import org.junit.Assert.*
import org.junit.Test

class BloomFilterTest {
    
    @Test
    fun `test basic insertion`() {
        val filter = BloomFilter(expectedItems = 1000, falsePositiveRate = 0.01)
        
        filter.add("test-item-1")
        filter.add("test-item-2")
        filter.add("test-item-3")
        
        assertTrue(filter.mightContain("test-item-1"))
        assertTrue(filter.mightContain("test-item-2"))
        assertTrue(filter.mightContain("test-item-3"))
    }
    
    @Test
    fun `test item not present`() {
        val filter = BloomFilter(expectedItems = 1000, falsePositiveRate = 0.01)
        
        filter.add("exists")
        
        // This might occasionally fail due to false positives, but unlikely with low fill rate
        assertFalse(filter.mightContain("does-not-exist"))
    }
    
    @Test
    fun `test byte array insertion`() {
        val filter = BloomFilter(expectedItems = 1000, falsePositiveRate = 0.01)
        
        val data1 = byteArrayOf(0x01, 0x02, 0x03, 0x04)
        val data2 = byteArrayOf(0x05, 0x06, 0x07, 0x08)
        
        filter.add(data1)
        
        assertTrue(filter.mightContain(data1))
        assertFalse(filter.mightContain(data2))
    }
    
    @Test
    fun `test serialization`() {
        val filter = BloomFilter(expectedItems = 1000, falsePositiveRate = 0.01)
        
        filter.add("item-1")
        filter.add("item-2")
        filter.add("item-3")
        
        // Serialize
        val data = filter.toByteArray()
        assertNotNull(data)
        
        // Deserialize
        val restored = BloomFilter.fromByteArray(data)
        
        // Verify items are still present
        assertTrue(restored.mightContain("item-1"))
        assertTrue(restored.mightContain("item-2"))
        assertTrue(restored.mightContain("item-3"))
    }
    
    @Test
    fun `test approximate count`() {
        val filter = BloomFilter(expectedItems = 1000, falsePositiveRate = 0.01)
        
        for (i in 0 until 100) {
            filter.add("item-$i")
        }
        
        val count = filter.approximateCount()
        // Should be approximately 100, with some error margin
        assertTrue(count > 80)
        assertTrue(count < 150)
    }
    
    @Test
    fun `test clear`() {
        val filter = BloomFilter(expectedItems = 1000, falsePositiveRate = 0.01)
        
        filter.add("test-item")
        assertTrue(filter.mightContain("test-item"))
        assertFalse(filter.isEmpty)
        
        filter.clear()
        
        // After clearing, the item should not be found
        assertTrue(filter.isEmpty)
    }
    
    @Test
    fun `test union`() {
        val filter1 = BloomFilter(expectedItems = 1000, falsePositiveRate = 0.01)
        val filter2 = BloomFilter(expectedItems = 1000, falsePositiveRate = 0.01)
        
        filter1.add("filter1-item")
        filter2.add("filter2-item")
        
        filter1.union(filter2)
        
        assertTrue(filter1.mightContain("filter1-item"))
        assertTrue(filter1.mightContain("filter2-item"))
    }
    
    @Test
    fun `test false positive rate stays reasonable`() {
        val filter = BloomFilter(expectedItems = 10000, falsePositiveRate = 0.01)
        
        // Add 1000 items
        for (i in 0 until 1000) {
            filter.add("inserted-$i")
        }
        
        // Test 10000 non-existent items
        var falsePositives = 0
        for (i in 0 until 10000) {
            if (filter.mightContain("not-inserted-$i")) {
                falsePositives++
            }
        }
        
        // False positive rate should be around 1% (target) or less
        // We allow up to 5% for statistical variance
        val actualRate = falsePositives / 10000.0
        assertTrue("False positive rate too high: $actualRate", actualRate < 0.05)
    }
}
