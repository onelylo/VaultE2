export type UserRole = 'ADMIN' | 'SUPERVISOR' | 'MEMBER';

export interface User {
  userId: string;
  username: string;
  fullName: string;
  email: string;
  role: UserRole;
  avatarUrl?: string;
  socketId?: string;
  publicKey: string;
  signingPublicKey?: string;
  isOnline?: boolean;
  isAway?: boolean;
  statusMessage?: string;
  keyVersion?: number;
  keyRotationSignature?: string;
  oldPublicKey?: string;
  oldSigningPublicKey?: string;
  createdAt?: number;
  blockedByMe?: boolean;
  blockedByThem?: boolean;
  phone?: string;
}

export interface Channel {
  id: string;
  name: string;
  description: string;
  type: 'official' | 'team' | 'public' | 'private';
  createdBy: string;
  createdAt: number;
  memberIds: string[];
  isAnnouncement?: boolean;
  allowedRoles?: string[];
  slowModeSeconds?: number;
}

export interface ChannelKey {
  channelId: string;
  keyJwk: JsonWebKey;
  keyBase64?: string;
}

export interface AttachmentPayload {
  attachmentId: string;
  encryptedMetadata: string; // AES-GCM encrypted JSON of AttachmentMeta
  iv: string;                // Base64 IV used to encrypt the metadata
  binaryIv: string;          // Base64 IV used to encrypt the binary file payload
}

export interface AttachmentMeta {
  fileName: string;
  fileSize: number;
  mimeType: string;
  thumbnailDataUrl?: string; // base64 canvas thumbnail (images only)
}

/**
 * Fully-encrypted attachment queued for upload while the sender is offline.
 * The server receives only these ciphertexts; it never sees plaintext.
 */
export interface PendingUpload {
  encryptedBinary: string;
  binaryIv: string;
  encryptedMetadata: string;
  metadataIv: string;
}

export interface EncryptedPayload {
  id: string;
  tempId?: string;
  senderId: string;
  recipientId?: string;
  channelId?: string;
  ciphertext: string; // Base64 AES-GCM ciphertext (empty string if attachment-only)
  iv: string;         // Base64 12-byte IV
  timestamp: number;
  isEdited?: boolean;
  isDeleted?: boolean;
  replyTo?: string;
  attachment?: AttachmentPayload;
}

export interface LocalMessage {
  id: string;
  tempId?: string;
  senderId: string;
  recipientId?: string;
  channelId?: string;
  text: string;          // Decrypted text (or fallback message if decryption fails)
  ciphertext: string;    // Raw Base64 ciphertext
  iv: string;            // Raw Base64 IV
  timestamp: number;
  status: 'pending_sync' | 'sent' | 'delivered' | 'read' | 'received';
  isDecrypted: boolean;
  isEdited?: boolean;
  isDeleted?: boolean;
  replyTo?: string;
  attachment?: AttachmentPayload;
  attachmentMeta?: AttachmentMeta; // Decrypted locally — not persisted in cleartext
  pendingUpload?: PendingUpload;   // Attachment queued while offline (cleared after upload)
}

export interface UserKeyPair {
  userId: string;
  username: string;
  fullName?: string;
  email?: string;
  avatarUrl?: string;
  role: UserRole;
  statusMessage?: string;
  publicKeyBase64: string;
  privateKeyJwk: JsonWebKey;
  publicKeyJwk: JsonWebKey;
  signingPublicKeyBase64?: string;
  privateSigningKeyJwk?: JsonWebKey;
  publicSigningKeyJwk?: JsonWebKey;
  createdAt: number;
}

export interface TrustedKey {
  peerUserId: string;
  fingerprint: string;
  firstSeenAt: number;
  lastValidatedAt: number;
  publicKey?: string;
  keyVersion?: number;
}

export interface AdminUser extends User {
  isOnline: boolean;
}
