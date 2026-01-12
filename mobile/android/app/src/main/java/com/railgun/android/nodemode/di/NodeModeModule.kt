package com.railgun.android.nodemode.di

import android.content.Context
import com.railgun.android.nodemode.core.NodeModeConfig
import com.railgun.android.nodemode.core.NodeModeManager
import com.railgun.android.nodemode.data.NodeModeDatabase
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object NodeModeModule {
    
    @Provides
    @Singleton
    fun provideNodeModeConfig(): NodeModeConfig {
        return NodeModeConfig(
            enableBLE = true,
            enableWifiDirect = false,
            maxStoredBundles = 1000,
            maxBundleSize = 256 * 1024,
            bundleTTLHours = 72,
            maxHops = 10,
            bloomFilterFalsePositiveRate = 0.01,
            bloomFilterExpectedItems = 10000,
            forwardingEnabled = true,
            autoConnectPeers = true,
            connectionCooldownMs = 30_000,
            maxConcurrentConnections = 5,
            broadcastIntervalMs = 5_000
        )
    }
    
    @Provides
    @Singleton
    fun provideNodeModeDatabase(
        @ApplicationContext context: Context
    ): NodeModeDatabase {
        return NodeModeDatabase.getInstance(context)
    }
    
    @Provides
    @Singleton
    fun provideNodeModeManager(
        @ApplicationContext context: Context,
        config: NodeModeConfig
    ): NodeModeManager {
        return NodeModeManager.getInstance(context, config)
    }
}
