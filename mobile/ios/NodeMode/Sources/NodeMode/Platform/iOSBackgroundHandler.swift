//
//  iOSBackgroundHandler.swift
//  RailGun Node Mode
//
//  iOS-specific background execution handlers
//  Manages background modes, push notifications for wake, and BGTasks
//

import Foundation
#if canImport(UIKit)
import UIKit
#endif
#if canImport(BackgroundTasks)
import BackgroundTasks
#endif
import UserNotifications

// MARK: - Background Mode

public enum BackgroundMode {
    case voip                   // VoIP push for instant wake
    case backgroundFetch       // Periodic fetch
    case backgroundProcessing  // Long-running tasks
    case remoteNotification    // Silent push
    case blePeripheral         // BLE background
    case bleCentral            // BLE scanning
}

// MARK: - Background Task Type

public enum BackgroundTaskType: String {
    case bundleSync = "com.railgun.nodemode.bundleSync"
    case peerMaintenance = "com.railgun.nodemode.peerMaintenance"
    case keyRotation = "com.railgun.nodemode.keyRotation"
}

// MARK: - iOS Background Handler

#if os(iOS)
public actor iOSBackgroundHandler {
    
    // MARK: - Properties
    
    public static let shared = iOSBackgroundHandler()
    
    private var isRegistered = false
    private var pendingTasks: [BackgroundTaskType: BGTask] = [:]
    private var wakeHandlers: [String: () async -> Void] = [:]
    
    // Background execution state
    private var backgroundTaskIdentifier: UIBackgroundTaskIdentifier = .invalid
    private var backgroundTimeRemaining: TimeInterval = 0
    
    // MARK: - Initialization
    
    private init() {}
    
    // MARK: - Registration
    
    /// Call this from application:didFinishLaunchingWithOptions:
    public func registerBackgroundTasks() {
        guard !isRegistered else { return }
        
        // Register BGTaskScheduler tasks
        BGTaskScheduler.shared.register(
            forTaskWithIdentifier: BackgroundTaskType.bundleSync.rawValue,
            using: nil
        ) { [weak self] task in
            Task {
                await self?.handleBundleSyncTask(task as! BGAppRefreshTask)
            }
        }
        
        BGTaskScheduler.shared.register(
            forTaskWithIdentifier: BackgroundTaskType.peerMaintenance.rawValue,
            using: nil
        ) { [weak self] task in
            Task {
                await self?.handlePeerMaintenanceTask(task as! BGAppRefreshTask)
            }
        }
        
        BGTaskScheduler.shared.register(
            forTaskWithIdentifier: BackgroundTaskType.keyRotation.rawValue,
            using: nil
        ) { [weak self] task in
            Task {
                await self?.handleKeyRotationTask(task as! BGProcessingTask)
            }
        }
        
        isRegistered = true
    }
    
    // MARK: - Task Scheduling
    
    /// Schedule bundle sync task
    public func scheduleBundleSync() {
        let request = BGAppRefreshTaskRequest(identifier: BackgroundTaskType.bundleSync.rawValue)
        request.earliestBeginDate = Date(timeIntervalSinceNow: 15 * 60) // 15 minutes
        
        do {
            try BGTaskScheduler.shared.submit(request)
        } catch {
            print("[Background] Failed to schedule bundle sync: \(error)")
        }
    }
    
    /// Schedule peer maintenance task
    public func schedulePeerMaintenance() {
        let request = BGAppRefreshTaskRequest(identifier: BackgroundTaskType.peerMaintenance.rawValue)
        request.earliestBeginDate = Date(timeIntervalSinceNow: 30 * 60) // 30 minutes
        
        do {
            try BGTaskScheduler.shared.submit(request)
        } catch {
            print("[Background] Failed to schedule peer maintenance: \(error)")
        }
    }
    
    /// Schedule key rotation task (requires charging + WiFi)
    public func scheduleKeyRotation() {
        let request = BGProcessingTaskRequest(identifier: BackgroundTaskType.keyRotation.rawValue)
        request.requiresNetworkConnectivity = true
        request.requiresExternalPower = true
        request.earliestBeginDate = Date(timeIntervalSinceNow: 60 * 60) // 1 hour
        
        do {
            try BGTaskScheduler.shared.submit(request)
        } catch {
            print("[Background] Failed to schedule key rotation: \(error)")
        }
    }
    
    // MARK: - Task Handlers
    
    private func handleBundleSyncTask(_ task: BGAppRefreshTask) async {
        // Schedule next occurrence
        scheduleBundleSync()
        
        task.expirationHandler = {
            task.setTaskCompleted(success: false)
        }
        
        // Perform bundle sync
        do {
            // Notify wake handlers
            if let handler = wakeHandlers["bundleSync"] {
                await handler()
            }
            
            task.setTaskCompleted(success: true)
        }
    }
    
    private func handlePeerMaintenanceTask(_ task: BGAppRefreshTask) async {
        schedulePeerMaintenance()
        
        task.expirationHandler = {
            task.setTaskCompleted(success: false)
        }
        
        // Perform peer maintenance
        if let handler = wakeHandlers["peerMaintenance"] {
            await handler()
        }
        
        task.setTaskCompleted(success: true)
    }
    
    private func handleKeyRotationTask(_ task: BGProcessingTask) async {
        scheduleKeyRotation()
        
        task.expirationHandler = {
            task.setTaskCompleted(success: false)
        }
        
        // Perform key rotation (longer running task)
        if let handler = wakeHandlers["keyRotation"] {
            await handler()
        }
        
        task.setTaskCompleted(success: true)
    }
    
    // MARK: - Wake Handlers
    
    public func registerWakeHandler(for task: String, handler: @escaping () async -> Void) {
        wakeHandlers[task] = handler
    }
    
    public func unregisterWakeHandler(for task: String) {
        wakeHandlers.removeValue(forKey: task)
    }
    
    // MARK: - Push Notification Wake
    
    /// Handle silent push notification wake
    public func handleSilentPush(userInfo: [AnyHashable: Any], completion: @escaping (UIBackgroundFetchResult) -> Void) async {
        // Check for RailGun-specific payload
        guard let railgunData = userInfo["railgun"] as? [String: Any] else {
            completion(.noData)
            return
        }
        
        // Determine push type
        if let pushType = railgunData["type"] as? String {
            switch pushType {
            case "bundle":
                // New bundle available
                if let handler = wakeHandlers["bundleSync"] {
                    await handler()
                }
                completion(.newData)
                
            case "peer":
                // Peer connection request
                if let handler = wakeHandlers["peerMaintenance"] {
                    await handler()
                }
                completion(.newData)
                
            case "wake":
                // General wake request
                for handler in wakeHandlers.values {
                    await handler()
                }
                completion(.newData)
                
            default:
                completion(.noData)
            }
        } else {
            completion(.noData)
        }
    }
    
    // MARK: - Background Execution
    
    /// Begin a background task with timeout
    public func beginBackgroundTask(name: String, timeout: TimeInterval = 30, work: @escaping () async -> Void) async {
        var taskId: UIBackgroundTaskIdentifier = .invalid
        
        taskId = await UIApplication.shared.beginBackgroundTask(withName: name) { [weak self] in
            Task {
                await self?.endBackgroundTask(taskId)
            }
        }
        
        guard taskId != .invalid else {
            // No background time available, run immediately
            await work()
            return
        }
        
        backgroundTaskIdentifier = taskId
        
        // Create timeout
        let timeoutTask = Task {
            try? await Task.sleep(nanoseconds: UInt64(timeout * 1_000_000_000))
            await self.endBackgroundTask(taskId)
        }
        
        // Perform work
        await work()
        
        // Cancel timeout and end task
        timeoutTask.cancel()
        await endBackgroundTask(taskId)
    }
    
    private func endBackgroundTask(_ taskId: UIBackgroundTaskIdentifier) async {
        guard taskId != .invalid else { return }
        await UIApplication.shared.endBackgroundTask(taskId)
        if backgroundTaskIdentifier == taskId {
            backgroundTaskIdentifier = .invalid
        }
    }
    
    /// Get remaining background time
    public func getRemainingBackgroundTime() async -> TimeInterval {
        return await UIApplication.shared.backgroundTimeRemaining
    }
    
    // MARK: - Local Notification Scheduling
    
    /// Schedule a local notification (for offline message notification)
    public func scheduleLocalNotification(title: String, body: String, identifier: String, delay: TimeInterval = 0) async {
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.sound = .default
        
        let trigger: UNNotificationTrigger?
        if delay > 0 {
            trigger = UNTimeIntervalNotificationTrigger(timeInterval: delay, repeats: false)
        } else {
            trigger = nil
        }
        
        let request = UNNotificationRequest(identifier: identifier, content: content, trigger: trigger)
        
        do {
            try await UNUserNotificationCenter.current().add(request)
        } catch {
            print("[Background] Failed to schedule notification: \(error)")
        }
    }
    
    /// Cancel a scheduled notification
    public func cancelNotification(identifier: String) {
        UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: [identifier])
    }
}

// MARK: - VoIP Push Handler

/// Handles VoIP push notifications for instant wake
/// Note: VoIP push requires CallKit integration in iOS 13+
public actor VoIPPushHandler {
    
    private var wakeCallback: (() async -> Void)?
    
    public init() {}
    
    /// Register callback for VoIP wake
    public func registerWakeCallback(_ callback: @escaping () async -> Void) {
        wakeCallback = callback
    }
    
    /// Handle incoming VoIP push
    public func handleVoIPPush(payload: [AnyHashable: Any]) async {
        // For privacy messaging, we use VoIP pushes to wake the app
        // but don't actually initiate a call
        
        // Wake the node mode components
        await wakeCallback?()
    }
}

#endif // os(iOS)

// MARK: - BLE Background Manager (Cross-platform)

/// Manages BLE background modes
public actor BLEBackgroundManager {
    
    public enum BLEBackgroundState {
        case foreground
        case background
        case suspended
    }
    
    private(set) var state: BLEBackgroundState = .foreground
    private var restorationHandler: ((Set<String>) -> Void)?
    
    public init() {}
    
    /// Handle BLE state restoration (called after app restart)
    public func handleStateRestoration(centralIdentifiers: [String]?, peripheralIdentifiers: [String]?) {
        var restoredIds = Set<String>()
        
        if let centrals = centralIdentifiers {
            restoredIds.formUnion(centrals)
        }
        
        if let peripherals = peripheralIdentifiers {
            restoredIds.formUnion(peripherals)
        }
        
        restorationHandler?(restoredIds)
    }
    
    /// Set handler for BLE restoration
    public func setRestorationHandler(_ handler: @escaping (Set<String>) -> Void) {
        restorationHandler = handler
    }
    
    /// Update state based on app lifecycle
    public func updateState(_ newState: BLEBackgroundState) {
        state = newState
    }
    
    /// Get recommended scan settings for current state
    public func getRecommendedScanSettings() -> BLEScanSettings {
        switch state {
        case .foreground:
            return BLEScanSettings(
                allowDuplicates: true,
                scanInterval: 1.0,
                scanWindow: 0.8
            )
        case .background:
            return BLEScanSettings(
                allowDuplicates: false,
                scanInterval: 10.0,
                scanWindow: 2.0
            )
        case .suspended:
            return BLEScanSettings(
                allowDuplicates: false,
                scanInterval: 30.0,
                scanWindow: 1.0
            )
        }
    }
}

public struct BLEScanSettings {
    public let allowDuplicates: Bool
    public let scanInterval: TimeInterval
    public let scanWindow: TimeInterval
}

// MARK: - Info.plist Requirements

/*
 Required Info.plist entries for background modes:
 
 <key>UIBackgroundModes</key>
 <array>
     <string>bluetooth-central</string>
     <string>bluetooth-peripheral</string>
     <string>fetch</string>
     <string>processing</string>
     <string>remote-notification</string>
 </array>
 
 <key>BGTaskSchedulerPermittedIdentifiers</key>
 <array>
     <string>com.railgun.nodemode.bundleSync</string>
     <string>com.railgun.nodemode.peerMaintenance</string>
     <string>com.railgun.nodemode.keyRotation</string>
 </array>
 
 <key>NSBluetoothAlwaysUsageDescription</key>
 <string>RailGun uses Bluetooth to communicate with nearby devices for private messaging.</string>
 
 <key>NSLocalNetworkUsageDescription</key>
 <string>RailGun uses local network for peer-to-peer messaging.</string>
 
 <key>NSBonjourServices</key>
 <array>
     <string>_railgun._tcp</string>
 </array>
 */
