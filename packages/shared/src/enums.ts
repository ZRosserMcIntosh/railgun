/**
 * Rail Gun - Protocol Enums
 * Defines constants and enumerations for the messaging protocol
 */

/** Current protocol version for message envelopes */
export const PROTOCOL_VERSION = 1;

/** Types of conversations supported */
export enum ConversationType {
  /** Direct message between users (1:1 or small group) */
  DM = 'DM',
  /** Channel within a community */
  CHANNEL = 'CHANNEL',
}

/** User presence states */
export enum PresenceStatus {
  ONLINE = 'ONLINE',
  AWAY = 'AWAY',
  DO_NOT_DISTURB = 'DND',
  INVISIBLE = 'INVISIBLE',
  OFFLINE = 'OFFLINE',
}

/** WebSocket event types */
export enum WSEventType {
  // Connection events
  CONNECT = 'connect',
  DISCONNECT = 'disconnect',
  AUTHENTICATE = 'authenticate',
  AUTHENTICATED = 'authenticated',
  AUTH_ERROR = 'auth_error',

  // Message events
  MESSAGE_SEND = 'message:send',
  MESSAGE_RECEIVED = 'message:received',
  MESSAGE_ACK = 'message:ack',
  MESSAGE_ERROR = 'message:error',

  // Presence events
  PRESENCE_UPDATE = 'presence:update',
  PRESENCE_SUBSCRIBE = 'presence:subscribe',

  // Typing indicators
  TYPING_START = 'typing:start',
  TYPING_STOP = 'typing:stop',

  // Key exchange events
  PREKEY_REQUEST = 'prekey:request',
  PREKEY_RESPONSE = 'prekey:response',
  SESSION_ESTABLISHED = 'session:established',

  // Community events
  COMMUNITY_UPDATE = 'community:update',
  CHANNEL_UPDATE = 'channel:update',
  MEMBER_UPDATE = 'member:update',
}

/** Message delivery status */
export enum MessageStatus {
  /** Message is being sent */
  SENDING = 'SENDING',
  /** Message was sent to server */
  SENT = 'SENT',
  /** Message was delivered to recipient's device */
  DELIVERED = 'DELIVERED',
  /** Message was read by recipient */
  READ = 'READ',
  /** Message failed to send */
  FAILED = 'FAILED',
}

/** Role permission flags */
export enum Permission {
  // Community permissions
  MANAGE_COMMUNITY = 'MANAGE_COMMUNITY',
  MANAGE_CHANNELS = 'MANAGE_CHANNELS',
  MANAGE_ROLES = 'MANAGE_ROLES',
  MANAGE_MEMBERS = 'MANAGE_MEMBERS',
  INVITE_MEMBERS = 'INVITE_MEMBERS',
  KICK_MEMBERS = 'KICK_MEMBERS',
  BAN_MEMBERS = 'BAN_MEMBERS',

  // Channel permissions
  READ_MESSAGES = 'READ_MESSAGES',
  SEND_MESSAGES = 'SEND_MESSAGES',
  MANAGE_MESSAGES = 'MANAGE_MESSAGES',

  // Voice channel permissions
  CONNECT_VOICE = 'CONNECT_VOICE',
  SPEAK_VOICE = 'SPEAK_VOICE',
  VIDEO_VOICE = 'VIDEO_VOICE',
  MUTE_MEMBERS = 'MUTE_MEMBERS',
  DEAFEN_MEMBERS = 'DEAFEN_MEMBERS',
  MOVE_MEMBERS = 'MOVE_MEMBERS',

  // General
  ADMINISTRATOR = 'ADMINISTRATOR',
}

/** Device types for key management */
export enum DeviceType {
  DESKTOP = 'DESKTOP',
  MOBILE = 'MOBILE',
  WEB = 'WEB',
}

/** Key types for Signal protocol */
export enum KeyType {
  IDENTITY = 'IDENTITY',
  SIGNED_PREKEY = 'SIGNED_PREKEY',
  ONE_TIME_PREKEY = 'ONE_TIME_PREKEY',
}
