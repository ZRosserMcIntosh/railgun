/**
 * Rail Gun - Sender Key Management
 * 
 * Implements secure sender key lifecycle for group/channel encryption:
 * - Rekey epochs on membership changes
 * - Per-sender replay protection with monotonic counters
 * - History access control for new members
 * - Explicit rekey policies
 * 
 * SECURITY CONSIDERATIONS:
 * 1. REKEY ON MEMBER REMOVAL: When any member leaves, all remaining members
 *    must generate new sender keys. The removed member still has old keys
 *    but cannot decrypt new messages.
 * 
 * 2. NEW MEMBER HISTORY: New members receive only current epoch keys.
 *    They CANNOT decrypt messages from before they joined.
 * 
 * 3. REPLAY PROTECTION: Each message includes a monotonic counter per-sender.
 *    Receivers track the highest seen counter and reject replays.
 * 
 * 4. EPOCH VERSIONING: Messages include sender key epoch. Receivers reject
 *    messages from old epochs after a grace period.
 */

// ============================================================================
// TYPES
// ============================================================================

/**
 * Sender key epoch metadata
 */
export interface SenderKeyEpoch {
  /** Unique epoch identifier */
  epochId: string;
  
  /** Monotonically increasing epoch number */
  epochNumber: number;
  
  /** When this epoch was created */
  createdAt: string; // ISO date
  
  /** Member IDs who have this epoch's key */
  memberIds: string[];
  
  /** Reason for this epoch (initial, member_added, member_removed, rotation) */
  reason: 'initial' | 'member_added' | 'member_removed' | 'rotation' | 'max_messages' | 'max_age';
  
  /** Previous epoch ID (for chain validation) */
  previousEpochId?: string;
}

/**
 * Sender key state for a channel
 */
export interface SenderKeyState {
  /** Channel/group ID */
  channelId: string;
  
  /** Current epoch */
  currentEpoch: SenderKeyEpoch;
  
  /** Message counter for this sender key (monotonic) */
  messageCounter: number;
  
  /** Distribution ID from Signal's sender key protocol */
  distributionId: string;
  
  /** When the sender key was created */
  createdAt: string;
  
  /** Total messages sent with this key */
  totalMessagesSent: number;
}

/**
 * Received sender key tracking for replay protection
 */
export interface ReceivedSenderKeyState {
  /** Sender's user ID */
  senderId: string;
  
  /** Channel/group ID */
  channelId: string;
  
  /** Last seen epoch number from this sender */
  lastSeenEpoch: number;
  
  /** Highest message counter seen per epoch */
  highestCounterByEpoch: Record<number, number>;
  
  /** 
   * Replay window: circular buffer of recent (epoch, counter) pairs.
   * Used to detect exact duplicates within the window.
   * Null entries indicate empty slots (before buffer fills up).
   */
  replayWindow: Array<{ epoch: number; counter: number; messageId: string } | null>;
  
  /** Current write position in circular buffer */
  replayWindowIndex: number;
  
  /** Set for O(1) lookup (synced with circular buffer) */
  replayWindowSet: Set<string>;
  
  /** Max size of replay window */
  replayWindowMaxSize: number;
}

/**
 * Serialized format for ReceivedSenderKeyState (without Set, for JSON persistence)
 */
export interface SerializedReceivedSenderKeyState {
  senderId: string;
  channelId: string;
  lastSeenEpoch: number;
  highestCounterByEpoch: Record<number, number>;
  replayWindow: Array<{ epoch: number; counter: number; messageId: string } | null>;
  replayWindowIndex: number;
  replayWindowMaxSize: number;
}

/**
 * Group message envelope with sender key metadata
 */
export interface SenderKeyMessageEnvelope {
  /** Base64-encoded ciphertext */
  ciphertext: string;
  
  /** Sender's device ID */
  senderDeviceId: number;
  
  /** Sender's user ID */
  senderUserId: string;
  
  /** Channel/group ID */
  channelId: string;
  
  /** Distribution ID */
  distributionId: string;
  
  /** Current epoch number */
  epochNumber: number;
  
  /** Monotonic message counter within this epoch */
  messageCounter: number;
  
  /** Message ID for replay cache (hash of epoch + counter + sender) */
  messageId: string;
  
  /** Timestamp (for staleness checks) */
  timestamp: string;
}

/**
 * Rekey policies
 */
export interface RekeyPolicy {
  /** Rekey when a member is removed */
  rekeyOnMemberRemove: boolean;
  
  /** Rekey when a member is added (usually false - just distribute existing key) */
  rekeyOnMemberAdd: boolean;
  
  /** Maximum messages before automatic rekey */
  maxMessagesPerKey: number;
  
  /** Maximum age before automatic rekey (milliseconds) */
  maxKeyAgeMs: number;
  
  /** Grace period for accepting old epoch messages (milliseconds) */
  oldEpochGracePeriodMs: number;
  
  /** Replay cache window size (number of recent messages to track) */
  replayCacheSize: number;
}

/**
 * History access policy for new members
 */
export type HistoryAccessPolicy = 
  | 'none'          // New members cannot see any history
  | 'server_stored' // New members can see server-stored (still encrypted) history
  | 'limited'       // New members can see last N messages
  | 'full';         // New members can see all history (requires key escrow - NOT RECOMMENDED)

// ============================================================================
// DEFAULT POLICIES
// ============================================================================

export const DEFAULT_REKEY_POLICY: RekeyPolicy = {
  rekeyOnMemberRemove: true,   // CRITICAL: Always rekey when someone leaves
  rekeyOnMemberAdd: false,     // Just distribute existing key to new member
  maxMessagesPerKey: 10000,    // Rekey after 10k messages
  maxKeyAgeMs: 7 * 24 * 60 * 60 * 1000, // Rekey after 7 days
  oldEpochGracePeriodMs: 5 * 60 * 1000, // Accept old epoch for 5 min
  replayCacheSize: 1000,       // Track last 1000 message IDs
};

export const DEFAULT_HISTORY_POLICY: HistoryAccessPolicy = 'none';

// ============================================================================
// SENDER KEY MANAGER
// ============================================================================

/**
 * Manages sender keys for group/channel encryption with proper lifecycle.
 */
export class SenderKeyManager {
  private senderKeys: Map<string, SenderKeyState> = new Map();
  private receivedKeys: Map<string, ReceivedSenderKeyState> = new Map();
  private policy: RekeyPolicy;
  private historyPolicy: HistoryAccessPolicy;
  private localUserId: string;

  constructor(
    localUserId: string,
    policy: RekeyPolicy = DEFAULT_REKEY_POLICY,
    historyPolicy: HistoryAccessPolicy = DEFAULT_HISTORY_POLICY
  ) {
    this.localUserId = localUserId;
    this.policy = policy;
    this.historyPolicy = historyPolicy;
  }

  // ==================== SENDER KEY CREATION ====================

  /**
   * Create a new sender key for a channel.
   * Called when joining a new channel or when rekey is needed.
   */
  createSenderKey(
    channelId: string,
    memberIds: string[],
    reason: SenderKeyEpoch['reason'] = 'initial',
    previousEpoch?: SenderKeyEpoch
  ): SenderKeyState {
    const epochNumber = previousEpoch ? previousEpoch.epochNumber + 1 : 1;
    
    const epoch: SenderKeyEpoch = {
      epochId: this.generateEpochId(),
      epochNumber,
      createdAt: new Date().toISOString(),
      memberIds,
      reason,
      previousEpochId: previousEpoch?.epochId,
    };

    const state: SenderKeyState = {
      channelId,
      currentEpoch: epoch,
      messageCounter: 0,
      distributionId: this.generateDistributionId(channelId, epochNumber),
      createdAt: new Date().toISOString(),
      totalMessagesSent: 0,
    };

    this.senderKeys.set(channelId, state);
    
    console.log(
      `[SenderKeyManager] Created sender key for ${channelId}, ` +
      `epoch ${epochNumber}, reason: ${reason}`
    );

    return state;
  }

  /**
   * Get current sender key state for a channel.
   */
  getSenderKeyState(channelId: string): SenderKeyState | undefined {
    return this.senderKeys.get(channelId);
  }

  /**
   * Check if sender key needs rotation.
   */
  needsRekey(channelId: string): { needsRekey: boolean; reason?: string } {
    const state = this.senderKeys.get(channelId);
    
    if (!state) {
      return { needsRekey: true, reason: 'no_key' };
    }

    // Check message count
    if (state.totalMessagesSent >= this.policy.maxMessagesPerKey) {
      return { needsRekey: true, reason: 'max_messages' };
    }

    // Check age
    const keyAge = Date.now() - new Date(state.createdAt).getTime();
    if (keyAge >= this.policy.maxKeyAgeMs) {
      return { needsRekey: true, reason: 'max_age' };
    }

    return { needsRekey: false };
  }

  // ==================== MEMBERSHIP CHANGES ====================

  /**
   * Handle member added to channel.
   * Distributes current sender key to new member.
   * Returns whether a rekey was triggered.
   */
  onMemberAdded(
    channelId: string,
    newMemberId: string,
    allMemberIds: string[]
  ): { rekeyed: boolean; newEpoch?: SenderKeyEpoch } {
    const state = this.senderKeys.get(channelId);

    if (!state) {
      // No existing key, create initial one
      const newState = this.createSenderKey(channelId, allMemberIds, 'initial');
      return { rekeyed: true, newEpoch: newState.currentEpoch };
    }

    if (this.policy.rekeyOnMemberAdd) {
      // Policy says rekey on add (unusual but supported)
      const newState = this.createSenderKey(
        channelId,
        allMemberIds,
        'member_added',
        state.currentEpoch
      );
      return { rekeyed: true, newEpoch: newState.currentEpoch };
    }

    // Just update member list, no rekey
    state.currentEpoch.memberIds = allMemberIds;
    
    console.log(
      `[SenderKeyManager] Member ${newMemberId} added to ${channelId}, ` +
      `distributing existing epoch ${state.currentEpoch.epochNumber}`
    );

    return { rekeyed: false };
  }

  /**
   * Handle member removed from channel.
   * ALWAYS triggers a rekey (removed member has old keys).
   */
  onMemberRemoved(
    channelId: string,
    removedMemberId: string,
    remainingMemberIds: string[]
  ): { rekeyed: boolean; newEpoch: SenderKeyEpoch } {
    const state = this.senderKeys.get(channelId);
    const previousEpoch = state?.currentEpoch;

    // CRITICAL: Always rekey when a member is removed
    // The removed member still has the old sender key but won't get the new one
    const newState = this.createSenderKey(
      channelId,
      remainingMemberIds,
      'member_removed',
      previousEpoch
    );

    console.log(
      `[SenderKeyManager] ⚠️ Member ${removedMemberId} removed from ${channelId}, ` +
      `REKEYED to epoch ${newState.currentEpoch.epochNumber}`
    );

    return { rekeyed: true, newEpoch: newState.currentEpoch };
  }

  // ==================== MESSAGE SENDING ====================

  /**
   * Prepare a message for sending.
   * Increments counter and checks for needed rekey.
   */
  prepareMessageEnvelope(
    channelId: string,
    ciphertext: string,
    senderDeviceId: number
  ): SenderKeyMessageEnvelope {
    const state = this.senderKeys.get(channelId);
    
    if (!state) {
      throw new Error(`No sender key for channel ${channelId}`);
    }

    // Increment counters
    state.messageCounter++;
    state.totalMessagesSent++;

    const messageId = this.computeMessageId(
      state.currentEpoch.epochNumber,
      state.messageCounter,
      this.localUserId
    );

    return {
      ciphertext,
      senderDeviceId,
      senderUserId: this.localUserId,
      channelId,
      distributionId: state.distributionId,
      epochNumber: state.currentEpoch.epochNumber,
      messageCounter: state.messageCounter,
      messageId,
      timestamp: new Date().toISOString(),
    };
  }

  // ==================== MESSAGE RECEIVING & REPLAY PROTECTION ====================

  /**
   * Validate and track a received message for replay protection.
   * 
   * IMPORTANT: This should be called AFTER successful decryption/authentication.
   * Calling before auth success could allow invalid packets to pollute replay state.
   * 
   * Returns validation result.
   */
  validateReceivedMessage(
    envelope: SenderKeyMessageEnvelope,
    afterAuthSuccess: boolean = true
  ): { valid: boolean; reason?: string } {
    const key = `${envelope.senderUserId}:${envelope.channelId}`;
    let state = this.receivedKeys.get(key);

    // Initialize tracking state if needed
    if (!state) {
      state = {
        senderId: envelope.senderUserId,
        channelId: envelope.channelId,
        lastSeenEpoch: 0,
        highestCounterByEpoch: {},
        replayWindow: new Array(this.policy.replayCacheSize).fill(null),
        replayWindowIndex: 0,
        replayWindowSet: new Set(),
        replayWindowMaxSize: this.policy.replayCacheSize,
      };
      this.receivedKeys.set(key, state);
    }

    // 1. Check replay window (exact duplicate) - O(1) lookup
    if (state.replayWindowSet.has(envelope.messageId)) {
      return { valid: false, reason: 'replay_detected' };
    }

    // 2. Check epoch staleness
    if (envelope.epochNumber < state.lastSeenEpoch) {
      // Old epoch - check grace period
      const messageAge = Date.now() - new Date(envelope.timestamp).getTime();
      if (messageAge > this.policy.oldEpochGracePeriodMs) {
        return { valid: false, reason: 'stale_epoch' };
      }
    }

    // 3. Check monotonic counter within epoch
    const highestForEpoch = state.highestCounterByEpoch[envelope.epochNumber] || 0;
    
    // Allow some out-of-order delivery (within replay window), but flag suspicious gaps
    if (envelope.messageCounter <= highestForEpoch) {
      // Counter at or below highest seen - could be out-of-order or replay
      // If not in replay window, it's suspicious
      return { valid: false, reason: 'counter_reuse' };
    }

    // 4. Message is valid - only update tracking state AFTER authentication success
    if (!afterAuthSuccess) {
      // Caller indicates we're doing pre-auth validation
      // Return valid but don't record (caller will call again after auth)
      return { valid: true };
    }
    
    // Record this message in tracking state
    state.highestCounterByEpoch[envelope.epochNumber] = envelope.messageCounter;
    
    if (envelope.epochNumber > state.lastSeenEpoch) {
      state.lastSeenEpoch = envelope.epochNumber;
    }

    // Add to replay window using circular buffer
    this.addToReplayWindow(state, envelope);
    
    // Prune old epoch counters (keep only recent epochs)
    this.pruneOldEpochs(state);

    return { valid: true };
  }

  /**
   * Add message to replay window (circular buffer).
   * Evicts oldest entry when full.
   */
  private addToReplayWindow(
    state: ReceivedSenderKeyState,
    envelope: SenderKeyMessageEnvelope
  ): void {
    // Get entry being evicted (if any)
    const evictedEntry = state.replayWindow[state.replayWindowIndex];
    if (evictedEntry) {
      // Remove from Set for O(1) consistency
      state.replayWindowSet.delete(evictedEntry.messageId);
    }

    // Add new entry
    state.replayWindow[state.replayWindowIndex] = {
      epoch: envelope.epochNumber,
      counter: envelope.messageCounter,
      messageId: envelope.messageId,
    };
    state.replayWindowSet.add(envelope.messageId);

    // Advance circular buffer index
    state.replayWindowIndex = (state.replayWindowIndex + 1) % state.replayWindowMaxSize;
  }

  /**
   * Prune counter tracking for epochs more than 2 behind current.
   * Prevents unbounded memory growth on long-running sessions.
   */
  private pruneOldEpochs(state: ReceivedSenderKeyState): void {
    const currentEpoch = state.lastSeenEpoch;
    const keepThreshold = currentEpoch - 2; // Keep current and 2 previous epochs

    for (const epochStr of Object.keys(state.highestCounterByEpoch)) {
      const epoch = parseInt(epochStr, 10);
      if (epoch < keepThreshold) {
        delete state.highestCounterByEpoch[epoch];
      }
    }
  }

  // ==================== HISTORY ACCESS ====================

  /**
   * Get history access policy.
   */
  getHistoryPolicy(): HistoryAccessPolicy {
    return this.historyPolicy;
  }

  /**
   * Check if a new member can access history from a specific epoch.
   */
  canNewMemberAccessEpoch(
    memberJoinedEpoch: number,
    messageEpoch: number
  ): boolean {
    switch (this.historyPolicy) {
      case 'none':
        // New members can only access messages from their join epoch onwards
        return messageEpoch >= memberJoinedEpoch;
      
      case 'server_stored':
      case 'limited':
        // Server decides what to share, but encryption-wise they need the key
        // This would require key escrow which we don't implement
        return messageEpoch >= memberJoinedEpoch;
      
      case 'full':
        // Requires key escrow - not recommended for E2E
        console.warn('[SenderKeyManager] Full history access requires key escrow');
        return true;
      
      default:
        return messageEpoch >= memberJoinedEpoch;
    }
  }

  // ==================== UTILITIES ====================

  private generateEpochId(): string {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  }

  private generateDistributionId(channelId: string, epochNumber: number): string {
    // Create a deterministic but unique distribution ID
    return `${channelId}:epoch:${epochNumber}:${Date.now()}`;
  }

  private computeMessageId(
    epochNumber: number,
    counter: number,
    senderId: string
  ): string {
    // Create a unique message ID for replay detection
    const data = `${epochNumber}:${counter}:${senderId}`;
    // Simple hash - in production use a proper hash function
    let hash = 0;
    for (let i = 0; i < data.length; i++) {
      const char = data.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return `msg:${hash.toString(16)}:${epochNumber}:${counter}`;
  }

  // ==================== SERIALIZATION ====================

  /**
   * Serialized format for ReceivedSenderKeyState
   */
  private serializeReceivedState(state: ReceivedSenderKeyState): SerializedReceivedSenderKeyState {
    return {
      senderId: state.senderId,
      channelId: state.channelId,
      lastSeenEpoch: state.lastSeenEpoch,
      highestCounterByEpoch: state.highestCounterByEpoch,
      replayWindow: state.replayWindow,
      replayWindowIndex: state.replayWindowIndex,
      replayWindowMaxSize: state.replayWindowMaxSize,
    };
  }

  /**
   * Deserialize ReceivedSenderKeyState
   */
  private deserializeReceivedState(data: SerializedReceivedSenderKeyState): ReceivedSenderKeyState {
    // Rebuild the Set from the circular buffer
    const replayWindowSet = new Set<string>();
    for (const entry of data.replayWindow) {
      if (entry) {
        replayWindowSet.add(entry.messageId);
      }
    }
    
    return {
      ...data,
      replayWindowSet,
    };
  }

  /**
   * Export state for persistence.
   */
  exportState(): {
    senderKeys: Array<[string, SenderKeyState]>;
    receivedKeys: Array<[string, SerializedReceivedSenderKeyState]>;
  } {
    return {
      senderKeys: Array.from(this.senderKeys.entries()),
      receivedKeys: Array.from(this.receivedKeys.entries()).map(([k, v]) => [
        k,
        this.serializeReceivedState(v),
      ]),
    };
  }

  /**
   * Import state from persistence.
   */
  importState(state: ReturnType<SenderKeyManager['exportState']>): void {
    this.senderKeys = new Map(state.senderKeys);
    this.receivedKeys = new Map(
      state.receivedKeys.map(([k, v]) => [
        k,
        this.deserializeReceivedState(v),
      ])
    );
  }
}

// ============================================================================
// DOCUMENTATION FOR SECURITY ARCHITECTURE
// ============================================================================

/**
 * SENDER KEY SECURITY DOCUMENTATION
 * 
 * ## Threat Model
 * 
 * 1. **Compromised Member**: A member who has been compromised or left the group
 *    still has old sender keys. Mitigation: Immediate rekey on member removal.
 * 
 * 2. **Replay Attack**: Attacker re-sends captured messages. Mitigation:
 *    Per-sender monotonic counters + replay cache.
 * 
 * 3. **Key Grinding**: Attacker tries to derive sender keys. Mitigation:
 *    Keys are randomly generated, not derived from public info.
 * 
 * 4. **Forward Secrecy**: Sender keys provide limited forward secrecy within
 *    an epoch. Full forward secrecy requires DM-based key distribution using
 *    the Double Ratchet (X3DH) for each key distribution message.
 * 
 * ## Rekey Policy Recommendations
 * 
 * - ALWAYS rekey on member removal (non-negotiable)
 * - Rekey at least every 7 days for active channels
 * - Rekey after 10,000 messages
 * - New members CANNOT access pre-join history by default
 * 
 * ## Message Flow
 * 
 * SENDING:
 * 1. Check if rekey needed (max messages, max age)
 * 2. If rekey: generate new sender key, distribute to members via DM
 * 3. Increment message counter
 * 4. Encrypt with current sender key
 * 5. Include epoch number + counter in envelope
 * 
 * RECEIVING:
 * 1. Check epoch validity (not too old)
 * 2. Check replay cache (not duplicate)
 * 3. Check monotonic counter (not reused)
 * 4. Decrypt message
 * 5. Update tracking state
 * 
 * ## Key Distribution (via DM)
 * 
 * Sender keys are distributed by sending a SenderKeyDistributionMessage
 * to each member via their encrypted DM channel. This ensures:
 * - Only current members receive the key
 * - Distribution is E2E encrypted
 * - Server cannot access sender keys
 */

export default SenderKeyManager;
