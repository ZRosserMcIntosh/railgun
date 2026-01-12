package com.railgun.android.nodemode.core

import org.junit.Assert.*
import org.junit.Test
import java.nio.ByteBuffer

class BundleTest {
    
    @Test
    fun `test bundle creation`() {
        val sourceId = ByteArray(32) { 0x01 }
        val destId = ByteArray(32) { 0x02 }
        val payload = "Hello, Node Mode!".toByteArray()
        
        val bundle = Bundle(
            id = "test-bundle-id",
            sourceNodeId = sourceId,
            destinationNodeId = destId,
            payload = payload
        )
        
        assertEquals("test-bundle-id", bundle.id)
        assertArrayEquals(sourceId, bundle.sourceNodeId)
        assertArrayEquals(destId, bundle.destinationNodeId)
        assertArrayEquals(payload, bundle.payload)
        assertEquals(0, bundle.hopCount)
        assertFalse(bundle.isExpired)
    }
    
    @Test
    fun `test bundle serialization`() {
        val sourceId = ByteArray(32) { 0x01 }
        val destId = ByteArray(32) { 0x02 }
        val payload = "Test payload data".toByteArray()
        
        val original = Bundle(
            id = "serialization-test",
            sourceNodeId = sourceId,
            destinationNodeId = destId,
            payload = payload,
            priority = BundlePriority.HIGH,
            flags = BundleFlags(
                encrypted = true,
                compressed = false,
                acknowledgmentRequested = true,
                routingHints = false
            )
        )
        
        val serialized = original.serialize()
        val deserialized = Bundle.deserialize(serialized)
        
        assertEquals(original.id, deserialized.id)
        assertArrayEquals(original.sourceNodeId, deserialized.sourceNodeId)
        assertArrayEquals(original.destinationNodeId, deserialized.destinationNodeId)
        assertArrayEquals(original.payload, deserialized.payload)
        assertEquals(original.priority, deserialized.priority)
        assertEquals(original.flags.encrypted, deserialized.flags.encrypted)
        assertEquals(original.flags.acknowledgmentRequested, deserialized.flags.acknowledgmentRequested)
    }
    
    @Test
    fun `test bundle hop increment`() {
        val sourceId = ByteArray(32) { 0x01 }
        val destId = ByteArray(32) { 0x02 }
        val relayId = ByteArray(32) { 0x03 }
        
        var bundle = Bundle(
            id = "hop-test",
            sourceNodeId = sourceId,
            destinationNodeId = destId,
            payload = ByteArray(0)
        )
        
        assertEquals(0, bundle.hopCount)
        assertTrue(bundle.hopPath.isEmpty())
        
        bundle = bundle.incrementHop(relayId)
        
        assertEquals(1, bundle.hopCount)
        assertEquals(1, bundle.hopPath.size)
        assertArrayEquals(relayId, bundle.hopPath.first())
    }
    
    @Test
    fun `test bundle expiration`() {
        val sourceId = ByteArray(32) { 0x01 }
        val destId = ByteArray(32) { 0x02 }
        
        // Create bundle that expires in the past
        val expiredBundle = Bundle(
            id = "expired-test",
            sourceNodeId = sourceId,
            destinationNodeId = destId,
            payload = ByteArray(0),
            expiresAt = System.currentTimeMillis() - 3600_000 // 1 hour ago
        )
        
        assertTrue(expiredBundle.isExpired)
        
        // Create bundle that expires in the future
        val validBundle = Bundle(
            id = "valid-test",
            sourceNodeId = sourceId,
            destinationNodeId = destId,
            payload = ByteArray(0),
            expiresAt = System.currentTimeMillis() + 3600_000 // 1 hour from now
        )
        
        assertFalse(validBundle.isExpired)
    }
    
    @Test
    fun `test bundle flags encoding`() {
        val flags = BundleFlags(
            encrypted = true,
            compressed = true,
            acknowledgmentRequested = false,
            routingHints = true
        )
        
        val encoded = flags.toByte()
        val decoded = BundleFlags.fromByte(encoded)
        
        assertEquals(flags.encrypted, decoded.encrypted)
        assertEquals(flags.compressed, decoded.compressed)
        assertEquals(flags.acknowledgmentRequested, decoded.acknowledgmentRequested)
        assertEquals(flags.routingHints, decoded.routingHints)
    }
    
    @Test
    fun `test bundle priority ordering`() {
        val priorities = listOf(
            BundlePriority.LOW,
            BundlePriority.NORMAL,
            BundlePriority.HIGH,
            BundlePriority.CRITICAL
        )
        
        assertEquals(0, BundlePriority.LOW.value)
        assertEquals(1, BundlePriority.NORMAL.value)
        assertEquals(2, BundlePriority.HIGH.value)
        assertEquals(3, BundlePriority.CRITICAL.value)
        
        // Verify ordering
        for (i in 0 until priorities.size - 1) {
            assertTrue(priorities[i].value < priorities[i + 1].value)
        }
    }
    
    @Test
    fun `test bundle size calculation`() {
        val sourceId = ByteArray(32) { 0x01 }
        val destId = ByteArray(32) { 0x02 }
        val payload = ByteArray(1000) { it.toByte() }
        
        val bundle = Bundle(
            id = "size-test",
            sourceNodeId = sourceId,
            destinationNodeId = destId,
            payload = payload
        )
        
        val size = bundle.size
        
        // Size should include all fields: id, sourceNodeId, destNodeId, payload, metadata
        assertTrue(size > payload.size)
        assertTrue(size > 1000) // At minimum, larger than payload
    }
}

class NodeTest {
    
    @Test
    fun `test node creation`() {
        val nodeId = ByteArray(32) { 0xAB.toByte() }
        val publicKey = ByteArray(32) { 0xCD.toByte() }
        
        val node = Node(
            id = nodeId.toHexString(),
            publicKey = publicKey,
            displayName = "Test Node"
        )
        
        assertEquals(nodeId.toHexString(), node.id)
        assertArrayEquals(publicKey, node.publicKey)
        assertEquals("Test Node", node.displayName)
        assertTrue(node.capabilities.isRelay)
        assertTrue(node.capabilities.canStoreBundles)
    }
    
    @Test
    fun `test node capabilities`() {
        var capabilities = NodeCapabilities()
        
        assertTrue(capabilities.isRelay)
        assertTrue(capabilities.canStoreBundles)
        assertFalse(capabilities.hasInternet)
        assertFalse(capabilities.isGateway)
        
        // Modify capabilities
        capabilities = NodeCapabilities(
            isRelay = false,
            canStoreBundles = true,
            hasInternet = true,
            isGateway = true
        )
        
        assertFalse(capabilities.isRelay)
        assertTrue(capabilities.hasInternet)
        assertTrue(capabilities.isGateway)
    }
    
    @Test
    fun `test node capabilities encoding`() {
        val capabilities = NodeCapabilities(
            isRelay = true,
            canStoreBundles = false,
            hasInternet = true,
            isGateway = false,
            maxBundleSize = 256 * 1024,
            storageCapacity = 10 * 1024 * 1024
        )
        
        val encoded = capabilities.toByte()
        val decoded = NodeCapabilities.fromByte(encoded)
        
        assertEquals(capabilities.isRelay, decoded.isRelay)
        assertEquals(capabilities.canStoreBundles, decoded.canStoreBundles)
        assertEquals(capabilities.hasInternet, decoded.hasInternet)
        assertEquals(capabilities.isGateway, decoded.isGateway)
    }
}
