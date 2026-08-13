import 'dotenv/config';
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import crypto from 'crypto';
import bcrypt from 'bcrypt';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import {
  initDatabase,
  getUploadsDir,
  shutdownDatabase,
  insertUser,
  getUserById,
  getUserByIdIncludingDeleted,
  getUserByUsername,
  getAllUsers,
  updateUserVaultKeys,
  rotateUserKeys,
  updateUserRole,
  updateUserProfile,
  updateUserAvatar,
  updateUserPassword,
  deleteUser,
  addChannelMember,
  getChannelMembers,
  removeChannelMember,
  getChannelsForUser,
  getChannelById,
  insertChannel,
  getAllChannels,
  updateChannel,
  deleteChannel,
  upsertChannelKeys,
  getChannelKey,
  getDatabaseSize,
  getUploadsSize,
  insertMessage,
  getDirectMessages,
  getChannelMessages,
  getMessagesForUser,
  markIncomingDelivered,
  updateMessageEdit,
  markMessageDeleted,
  insertAttachment,
  getAttachmentById,
  getAttachmentByMessageId,
  getMessageById,
  linkAttachmentToMessage,
  getDatabaseStats,
  addReaction,
  removeReaction,
  getReactionsForMessage,
  getReactionsForMessages,
  pinMessage,
  unpinMessage,
  getPinnedMessages,
  type DbUser,
  type DbChannel,
  type DbMessage,
} from './db/index.js';

const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024; // 25 MB

// ── Security Configuration ────────────────────────────────────────────────────
const JWT_SECRET: string = process.env.JWT_SECRET!;
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  console.error('[FATAL] JWT_SECRET environment variable is required (min 32 chars).');
  process.exit(1);
}
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:5173';
const BCRYPT_ROUNDS = 12;
const JWT_EXPIRY_MS = 60 * 60 * 1000; // 1 hour

const app = express();
app.use(helmet());
app.use(cors({ origin: CORS_ORIGIN, credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Rate limiting for auth endpoints
const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: 'Too many attempts, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: CORS_ORIGIN, methods: ['GET', 'POST'] },
  maxHttpBufferSize: MAX_ATTACHMENT_BYTES + 1024 * 1024,
});

// ── JWT Helpers ────────────────────────────────────────────────────────────────

function base64UrlEncode(str: string): string {
  return Buffer.from(str).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}
function base64UrlDecode(str: string): string {
  let b = str.replace(/-/g, '+').replace(/_/g, '/');
  while (b.length % 4) b += '=';
  return Buffer.from(b, 'base64').toString('utf8');
}
function signJwt(payload: object): string {
  const now = Date.now();
  const withExpiry = { ...payload, iat: now, exp: now + JWT_EXPIRY_MS };
  const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64UrlEncode(JSON.stringify(withExpiry));
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64')
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${header}.${body}.${sig}`;
}
function verifyJwt(token: string): any {
  try {
    const [header, payload, signature] = token.split('.');
    if (!header || !payload || !signature) return null;
    const expected = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${payload}`).digest('base64')
      .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    // Timing-safe comparison to prevent side-channel attacks
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
    const decoded = JSON.parse(base64UrlDecode(payload));
    // Check expiration
    if (decoded.exp && Date.now() > decoded.exp) return null;
    return decoded;
  } catch { return null; }
}
function requireAuth(req: express.Request, res: express.Response): string | null {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) { res.status(401).json({ error: 'Unauthorized' }); return null; }
  const decoded = verifyJwt(auth.split(' ')[1]);
  if (!decoded?.userId) { res.status(401).json({ error: 'Invalid token' }); return null; }
  return decoded.userId as string;
}

function requireAdmin(req: express.Request, res: express.Response): string | null {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) { res.status(401).json({ error: 'Unauthorized' }); return null; }
  const decoded = verifyJwt(auth.split(' ')[1]);
  if (!decoded?.userId || decoded.role !== 'ADMIN') {
    res.status(403).json({ error: 'Admin access required' });
    return null;
  }
  return decoded.userId as string;
}

// ── Types ──────────────────────────────────────────────────────────────────────

type UserRole = 'ADMIN' | 'SUPERVISOR' | 'MEMBER';

interface ActiveUser {
  userId: string;
  username: string;
  fullName: string;
  email: string;
  role: UserRole;
  avatarUrl?: string;
  socketId: string;
  publicKey: string;
}

export interface AttachmentPayload {
  attachmentId: string;
  encryptedMetadata: string; // AES-GCM ciphertext of AttachmentMeta JSON
  iv: string;                // IV used for the metadata ciphertext
  binaryIv: string;          // IV used for the encrypted binary payload
}

interface StoredMessage {
  id: string;
  tempId?: string;
  senderId: string;
  recipientId?: string;
  channelId?: string;
  ciphertext: string;
  iv: string;
  timestamp: number;
  status?: string;
  isEdited?: boolean;
  isDeleted?: boolean;
  replyTo?: string;
  attachment?: AttachmentPayload;
}

// ── Runtime (volatile) Presence State — the rest lives in PostgreSQL ──────────
const activeUsers  = new Map<string, ActiveUser>();
const socketToUser = new Map<string, string>();
const userToSocket = new Map<string, string>();

// ── Message Row Mappers ────────────────────────────────────────────────────────

function toDbMessage(payload: StoredMessage): DbMessage {
  return {
    id: payload.id,
    tempId: payload.tempId,
    senderId: payload.senderId,
    recipientId: payload.recipientId,
    channelId: payload.channelId,
    ciphertext: payload.ciphertext,
    iv: payload.iv,
    status: payload.status || 'sent',
    isEdited: payload.isEdited,
    isDeleted: payload.isDeleted,
    replyTo: payload.replyTo,
    createdAt: payload.timestamp,
  };
}

function toApiMessage(m: DbMessage): StoredMessage {
  return {
    id: m.id,
    tempId: m.tempId,
    senderId: m.senderId,
    recipientId: m.recipientId,
    channelId: m.channelId,
    ciphertext: m.ciphertext,
    iv: m.iv,
    timestamp: m.createdAt,
    status: m.status,
    isEdited: m.isEdited,
    isDeleted: m.isDeleted,
    replyTo: m.replyTo,
  };
}

/** Attach the linked encrypted payload to each stored message in history */
async function enrichMessagesWithAttachments(msgs: DbMessage[]): Promise<StoredMessage[]> {
  const out: StoredMessage[] = [];
  for (const m of msgs) {
    const api = toApiMessage(m);
    const att = await getAttachmentByMessageId(m.id);
    if (att) {
      api.attachment = {
        attachmentId: att.id,
        encryptedMetadata: att.encryptedMetadata,
        iv: att.metadataIv,
        binaryIv: att.iv,
      };
    }
    out.push(api);
  }
  return out;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function hashPassword(pwd: string): Promise<string> {
  return bcrypt.hash(pwd, BCRYPT_ROUNDS);
}

async function verifyPassword(pwd: string, hash: string): Promise<boolean> {
  // Check if hash is a legacy SHA-256 hash (64 hex chars, no $ prefix)
  if (hash.length === 64 && !hash.startsWith('$')) {
    // Legacy SHA-256 hash — compare directly
    const legacyHash = crypto.createHash('sha256').update(pwd).digest('hex');
    return legacyHash === hash;
  }
  // Modern bcrypt hash
  return bcrypt.compare(pwd, hash);
}

/** Canonical key for a DM pair (order-independent) */
function dmKey(a: string, b: string) {
  return [a, b].sort().join('::');
}

function publicUser(u: DbUser) {
  const avatar = u.avatarUrl || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent((u.fullName || u.username).trim())}`;
  return {
    userId:   u.userId,
    username: u.username,
    fullName: u.fullName,
    email:    u.email,
    role:     u.role,
    avatarUrl: avatar,
    avatar:   avatar,
    status:   u.status || 'ACTIVE',
    statusMessage: u.statusMessage,
    publicKey: u.publicKey,
    signingPublicKey: u.signingPublicKey,
    keyVersion: u.keyVersion ?? 1,
    keyRotationSignature: u.keyRotationSignature,
    oldPublicKey: u.oldPublicKey,
    oldSigningPublicKey: u.oldSigningPublicKey,
    createdAt: u.createdAt,
  };
}

async function buildUserDirectory(requestingUserId?: string) {
  const users = await getAllUsers();
  return users
    .map(u => ({
      ...publicUser(u),
      isOnline: activeUsers.has(u.userId),
      socketId: activeUsers.get(u.userId)?.socketId,
    }))
    .filter(u => u.userId !== requestingUserId); // exclude self from directory
}

function userToActive(data: { userId: string; username: string; fullName?: string; role?: UserRole; publicKey: string; avatarUrl?: string }, socketId: string, regUser?: DbUser): ActiveUser {
  const role: UserRole = (regUser?.role as UserRole) || 'MEMBER';
  const fullName = data.fullName || regUser?.fullName || data.username;
  const avatarUrl = data.avatarUrl || regUser?.avatarUrl || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(fullName.trim())}`;
  return {
    userId: data.userId,
    username: data.username,
    fullName,
    email: regUser?.email || `${data.username}@vaultchat.internal`,
    role,
    avatarUrl,
    socketId,
    publicKey: data.publicKey,
  };
}

// ── Auth Routes ───────────────────────────────────────────────────────────────

app.get('/api/auth/me', async (req, res) => {
  const userId = requireAuth(req, res);
  if (!userId) return;
  try {
    const user = await getUserById(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const pUser = publicUser(user);
    return res.json({
      user: { ...pUser, encryptedPrivateKey: user.encryptedPrivateKey, keySalt: user.keySalt },
      avatar: pUser.avatarUrl
    });
  } catch (e) {
    console.error('[Auth] /me error:', e);
    return res.status(500).json({ error: 'Server error' });
  }
});

const handleProfileUpdate = async (req: any, res: any) => {
  const userId = requireAuth(req, res);
  if (!userId) return;
  try {
    const { fullName, email, avatarUrl, avatar, status, statusMessage } = req.body;
    const finalAvatarUrl = avatarUrl || avatar;
    await updateUserProfile(userId, { fullName, email, avatarUrl: finalAvatarUrl, status, statusMessage });
    const user = await getUserById(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    io.emit('user:profile-update', { userId, fullName: user.fullName, avatarUrl: user.avatarUrl, avatar: user.avatarUrl, status: user.status, statusMessage: user.statusMessage });
    return res.json({ user: publicUser(user) });
  } catch (e) {
    console.error('[Profile] Update error:', e);
    return res.status(500).json({ error: 'Server error' });
  }
};

app.put('/api/auth/profile', handleProfileUpdate);
app.put('/api/user/profile', handleProfileUpdate);

app.post('/api/users/me/avatar', async (req, res) => {
  const userId = requireAuth(req, res);
  if (!userId) return;
  try {
    const { avatarData } = req.body;
    if (!avatarData || !avatarData.startsWith('data:image/')) {
      return res.status(400).json({ error: 'Invalid avatar data' });
    }
    // Store the data URL directly (base64-encoded image)
    await updateUserAvatar(userId, avatarData);
    io.emit('user:profile-update', { userId, avatarUrl: avatarData });
    return res.json({ avatarUrl: avatarData });
  } catch (e) {
    console.error('[Avatar] Upload error:', e);
    return res.status(500).json({ error: 'Server error' });
  }
});

app.put('/api/auth/password', async (req, res) => {
  const userId = requireAuth(req, res);
  if (!userId) return;
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Current and new password are required' });
  }
  try {
    const user = await getUserById(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (!await verifyPassword(currentPassword, user.passwordHash)) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }
    // Always store new passwords as bcrypt (even if old was SHA-256)
    await updateUserPassword(userId, await hashPassword(newPassword));
    console.log(`[Auth] Password changed for ${user.username}`);
    return res.json({ success: true });
  } catch (e) {
    console.error('[Auth] Password change error:', e);
    return res.status(500).json({ error: 'Password change failed' });
  }
});

app.post('/api/auth/register', authLimiter, async (req, res) => {
  const { username, fullName, email, password, role, publicKey, signingPublicKey, encryptedPrivateKey, keySalt } = req.body;
  if (!username || !password || !publicKey) {
    return res.status(400).json({ error: 'Username, password, and public key are required.' });
  }
  const normalized = username.trim().toLowerCase();
  const userId = `usr_${normalized.replace(/[^a-z0-9]/g, '')}`;
  try {
    const existing = await getUserByIdIncludingDeleted(userId);
    if (existing) {
      if (existing.deletedAt) {
        return res.status(400).json({ error: 'Username was deleted and cannot be re-registered.' });
      }
      return res.status(400).json({ error: 'Username already registered.' });
    }
    // Always assign MEMBER role on registration — roles are managed by admins only
    const userRole: UserRole = 'MEMBER';
    const newUser: DbUser = {
      userId,
      username: username.trim(),
      fullName: (fullName || username).trim(),
      email: (email || `${normalized}@vaultchat.internal`).trim(),
      role: userRole,
      passwordHash: await hashPassword(password),
      publicKey,
      signingPublicKey,
      encryptedPrivateKey,
      keySalt,
      createdAt: Date.now(),
    };
    await insertUser(newUser);
    const token = signJwt({ userId, username: newUser.username, role: userRole });
    console.log(`[Auth] Registered: ${newUser.username} (${userId}) [${userRole}]`);
    io.emit('user:registered', { user: publicUser(newUser) });
    return res.json({
      token,
      user: { ...publicUser(newUser), encryptedPrivateKey, keySalt }
    });
  } catch (e) {
    console.error('[Auth] Register error:', e);
    return res.status(500).json({ error: 'Registration failed' });
  }
});

app.post('/api/auth/login', authLimiter, async (req, res) => {
  const { username, password, publicKey, signingPublicKey, encryptedPrivateKey, keySalt, forceKeyRotation } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required.' });
  const normalized = username.trim().toLowerCase();
  const userId = `usr_${normalized.replace(/[^a-z0-9]/g, '')}`;
  try {
    const user = await getUserById(userId);
    if (!user) {
      const tombstone = await getUserByIdIncludingDeleted(userId);
      if (tombstone?.deletedAt) {
        return res.status(403).json({ error: 'Account has been deleted.' });
      }
      return res.status(401).json({ error: 'Invalid credentials.' });
    }
    if (!await verifyPassword(password, user.passwordHash)) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }
    // One-time migration: re-hash legacy SHA-256 passwords with bcrypt
    if (user.passwordHash.length === 64 && !user.passwordHash.startsWith('$')) {
      const newBcryptHash = await hashPassword(password);
      await updateUserPassword(userId, newBcryptHash).catch(() => {});
      console.log(`[Auth] Migrated ${user.username} password from SHA-256 to bcrypt`);
    }
    // Update vault keys if key rotation requested or missing
    if (forceKeyRotation && publicKey && encryptedPrivateKey && keySalt) {
      await updateUserVaultKeys(userId, publicKey, encryptedPrivateKey, keySalt, signingPublicKey);
      console.log(`[Auth] Key rotation applied for ${username}`);
    } else if (publicKey && !user.publicKey) {
      await updateUserVaultKeys(userId, publicKey, encryptedPrivateKey || '', keySalt || '', signingPublicKey);
    }
    const token = signJwt({ userId, username: user.username, role: user.role });
    console.log(`[Auth] Login: ${user.username} (${userId})`);
    return res.json({
      token,
      user: {
        ...publicUser(user),
        encryptedPrivateKey: user.encryptedPrivateKey,
        keySalt: user.keySalt,
      }
    });
  } catch (e) {
    console.error('[Auth] Login error:', e);
    return res.status(500).json({ error: 'Login failed' });
  }
});

// ── Signed Key Rotation ────────────────────────────────────────────────────────

/**
 * POST /api/auth/rotate-key
 * Client proves it still holds the OLD signing private key by signing the new
 * public keys. Server verifies against the pinned ECDSA signing public key,
 * then bumps key_version and pins the new keys for TOFU chain verification.
 */
app.post('/api/auth/rotate-key', async (req, res) => {
  const userId = requireAuth(req, res);
  if (!userId) return;
  const { publicKey, signingPublicKey, encryptedPrivateKey, keySalt, signature, oldPublicKey } = req.body;
  if (!publicKey || !signingPublicKey || !encryptedPrivateKey || !keySalt || !signature || !oldPublicKey) {
    return res.status(400).json({ error: 'publicKey, signingPublicKey, encryptedPrivateKey, keySalt, signature, and oldPublicKey are required.' });
  }
  try {
    const user = await getUserById(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (!user.publicKey || !user.signingPublicKey) {
      return res.status(400).json({ error: 'No pinned key to rotate from' });
    }
    if (user.oldPublicKey && user.oldPublicKey !== user.publicKey) {
      return res.status(400).json({ error: 'A rotation is already pending verification' });
    }
    if (user.publicKey !== oldPublicKey) {
      return res.status(409).json({ error: 'Key rotation conflict: server is pinned to a different key' });
    }

    const verifier = crypto.createVerify('SHA256');
    verifier.update(`petroshield-key-rotation-v1\n${publicKey}\n${signingPublicKey}\n${oldPublicKey}`);
    const ok = verifier.verify(
      {
        key: Buffer.from(user.signingPublicKey, 'base64'),
        format: 'der',
        type: 'spki',
        dsaEncoding: 'ieee-p1363',
      },
      signature,
      'base64'
    );
    if (!ok) {
      return res.status(403).json({ error: 'Signature invalid: not signed by the previous private key' });
    }

    await rotateUserKeys(userId, publicKey, encryptedPrivateKey, keySalt, signature, oldPublicKey, signingPublicKey);
    console.log(`[KeyRotation] ${user.username} (${userId}) rotated key → version ${(user.keyVersion ?? 1) + 1}`);
    io.emit('user:key_rotated', {
      userId,
      publicKey,
      signingPublicKey,
      keyVersion: (user.keyVersion ?? 1) + 1,
      keyRotationSignature: signature,
      oldPublicKey,
    });
    return res.json({ success: true, keyVersion: (user.keyVersion ?? 1) + 1 });
  } catch (e) {
    console.error('[KeyRotation] Error:', e);
    return res.status(500).json({ error: 'Key rotation failed' });
  }
});

/**
 * GET /api/users/:id/keys — TOFU fingerprint endpoint.
 * Clients compare the pinned key metadata after every rotation to detect MITM.
 */
app.get('/api/users/:id/keys', async (req, res) => {
  const userId = requireAuth(req, res);
  if (!userId) return;
  try {
    const user = await getUserById(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    return res.json({
      publicKey: user.publicKey,
      signingPublicKey: user.signingPublicKey,
      keyVersion: user.keyVersion ?? 1,
      keyRotationSignature: user.keyRotationSignature,
      oldPublicKey: user.oldPublicKey,
      oldSigningPublicKey: user.oldSigningPublicKey,
      createdAt: user.createdAt,
    });
  } catch (e) {
    console.error('[Keys] Fetch error:', e);
    return res.status(500).json({ error: 'Key fetch failed' });
  }
});

// ── User Directory Route ──────────────────────────────────────────────────────

app.get('/api/users', async (req, res) => {
  const userId = requireAuth(req, res);
  if (!userId) return;
  try {
    return res.json({ users: await buildUserDirectory(userId) });
  } catch (e) {
    console.error('[Directory] Error:', e);
    return res.status(500).json({ error: 'Directory fetch failed' });
  }
});

// ── Admin RBAC Routes ─────────────────────────────────────────────────────────

app.get('/api/admin/users', async (req, res) => {
  const adminId = requireAdmin(req, res);
  if (!adminId) return;
  try {
    const users = await getAllUsers();
    return res.json({
      users: users.map(u => ({
        ...publicUser(u),
        isOnline: activeUsers.has(u.userId),
      })),
    });
  } catch (e) {
    console.error('[Admin] List error:', e);
    return res.status(500).json({ error: 'Admin user list failed' });
  }
});

app.patch('/api/admin/users/:id/role', async (req, res) => {
  const adminId = requireAdmin(req, res);
  if (!adminId) return;
  const { role } = req.body;
  if (role !== 'ADMIN' && role !== 'SUPERVISOR' && role !== 'MEMBER') {
    return res.status(400).json({ error: 'role must be ADMIN, SUPERVISOR, or MEMBER' });
  }
  try {
    const target = await getUserById(req.params.id);
    if (!target) return res.status(404).json({ error: 'User not found' });
    if (target.userId === adminId) {
      return res.status(400).json({ error: 'Cannot change your own role' });
    }
    await updateUserRole(target.userId, role);
    console.log(`[Admin] ${adminId} set ${target.username} role → ${role}`);
    io.emit('user:role_change', { userId: target.userId, role });
    return res.json({ success: true, user: { ...publicUser(target), role } });
  } catch (e) {
    console.error('[Admin] Role change error:', e);
    return res.status(500).json({ error: 'Role change failed' });
  }
});

app.delete('/api/admin/users/:id', async (req, res) => {
  const adminId = requireAdmin(req, res);
  if (!adminId) return;
  try {
    const target = await getUserById(req.params.id);
    if (!target) return res.status(404).json({ error: 'User not found' });
    if (target.userId === adminId) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }
    await deleteUser(target.userId);
    console.log(`[Admin] ${adminId} deleted user ${target.username} (${target.userId})`);
    io.emit('user:removed', { userId: target.userId });
    return res.json({ success: true });
  } catch (e) {
    console.error('[Admin] Delete error:', e);
    return res.status(500).json({ error: 'User deletion failed' });
  }
});

// ── Admin Stats Route ─────────────────────────────────────────────────────────

app.get('/api/admin/stats', async (req, res) => {
  const adminId = requireAdmin(req, res);
  if (!adminId) return;
  try {
    const stats = await getDatabaseStats();
    const users = await getAllUsers();
    const onlineCount = users.filter(u => activeUsers.has(u.userId)).length;
    const adminCount = users.filter(u => u.role === 'ADMIN').length;

    return res.json({
      ...stats,
      onlineUsers: onlineCount,
      offlineUsers: stats.users - onlineCount,
      admins: adminCount,
      members: stats.users - adminCount,
      activeSockets: activeUsers.size,
    });
  } catch (e) {
    console.error('[Admin] Stats error:', e);
    return res.status(500).json({ error: 'Admin stats failed' });
  }
});

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// ── Admin Health / Infrastructure Route ───────────────────────────────────────

app.get('/api/admin/health', async (req, res) => {
  const adminId = requireAdmin(req, res);
  if (!adminId) return;
  try {
    const uptimeSec = process.uptime();
    const mem = process.memoryUsage();
    const dbSize = await getDatabaseSize();
    const uploads = await getUploadsSize();

    return res.json({
      server: {
        uptime: Math.floor(uptimeSec),
        uptimePretty: formatUptime(uptimeSec),
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
      },
      memory: {
        rss: mem.rss,
        heapUsed: mem.heapUsed,
        heapTotal: mem.heapTotal,
        rssPretty: formatBytes(mem.rss),
        heapUsedPretty: formatBytes(mem.heapUsed),
      },
      database: {
        sizeBytes: dbSize.bytes,
        sizePretty: dbSize.pretty,
      },
      storage: {
        uploadsBytes: uploads.bytes,
        uploadsPretty: uploads.pretty,
        fileCount: uploads.fileCount,
      },
    });
  } catch (e) {
    console.error('[Admin] Health error:', e);
    return res.status(500).json({ error: 'Admin health failed' });
  }
});

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const parts: string[] = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(' ');
}

// ── Message History Routes ────────────────────────────────────────────────────

app.get('/api/messages/direct/:recipientId', async (req, res) => {
  const senderId = requireAuth(req, res);
  if (!senderId) return;
  try {
    const msgs = await getDirectMessages(senderId, req.params.recipientId);
    await markIncomingDelivered(senderId);
    return res.json({ messages: await enrichMessagesWithAttachments(msgs) });
  } catch (e) {
    console.error('[History] DM fetch error:', e);
    return res.status(500).json({ error: 'History fetch failed' });
  }
});

/**
 * Full chat history for the requesting user (DM threads + every channel).
 * Used on login / after server restart to instantly restore the conversation feed.
 */
app.get('/api/messages', async (req, res) => {
  const userId = requireAuth(req, res);
  if (!userId) return;
  try {
    const msgs = await getMessagesForUser(userId);
    await markIncomingDelivered(userId);
    return res.json({ messages: await enrichMessagesWithAttachments(msgs) });
  } catch (e) {
    console.error('[History] Global fetch error:', e);
    return res.status(500).json({ error: 'History fetch failed' });
  }
});

// ── Reactions Batch Endpoint ────────────────────────────────────────────────
app.post('/api/reactions/batch', async (req, res) => {
  const userId = requireAuth(req, res);
  if (!userId) return;
  const { messageIds } = req.body;
  if (!Array.isArray(messageIds) || messageIds.length === 0) {
    return res.status(400).json({ error: 'messageIds array required' });
  }
  try {
    const reactions = await getReactionsForMessages(messageIds);
    return res.json({ reactions });
  } catch (e) {
    console.error('[Reactions] Batch fetch error:', e);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ── Channel Keys Endpoints (Key Distribution) ─────────────────────────────────

app.post('/api/channels/:channelId/keys', async (req, res) => {
  const userId = requireAuth(req, res);
  if (!userId) return;
  const { channelId } = req.params;
  const { keys } = req.body; // Array of { userId, encryptedChannelKey, iv }

  if (!Array.isArray(keys)) {
    return res.status(400).json({ error: 'keys array required' });
  }
  try {
    const validKeys = keys
      .filter((item: any) => item.userId && item.encryptedChannelKey && item.iv)
      .map((item: any) => ({
        channelId,
        userId: item.userId,
        encryptedChannelKey: item.encryptedChannelKey,
        iv: item.iv,
      }));
    await upsertChannelKeys(channelId, validKeys);
    console.log(`[ChannelKeys] Stored ${validKeys.length} key envelope(s) for channel #${channelId}`);
    return res.json({ success: true, count: validKeys.length });
  } catch (e) {
    console.error('[ChannelKeys] Store error:', e);
    return res.status(500).json({ error: 'Failed to store channel keys' });
  }
});

app.get('/api/channels/:channelId/key', async (req, res) => {
  const userId = requireAuth(req, res);
  if (!userId) return;
  try {
    const keyEntry = await getChannelKey(req.params.channelId, userId);
    if (!keyEntry) {
      return res.status(404).json({ error: 'No channel key envelope found for user' });
    }
    return res.json({ key: keyEntry });
  } catch (e) {
    console.error('[ChannelKeys] Fetch error:', e);
    return res.status(500).json({ error: 'Channel key fetch failed' });
  }
});

// ── Channel Management (Admin/Manager) ─────────────────────────────────────────

app.patch('/api/channels/:channelId', async (req, res) => {
  const userId = requireAuth(req, res);
  if (!userId) return;
  try {
    const channel = await getChannelById(req.params.channelId);
    if (!channel) return res.status(404).json({ error: 'Channel not found' });
    
    // Check permissions: ADMIN can update any channel; SUPERVISOR/MEMBER can only update channels they created
    const user = await getUserById(userId);
    if (!user) return res.status(403).json({ error: 'User not found' });
    if (user.role !== 'ADMIN' && channel.createdBy !== userId) {
      return res.status(403).json({ error: 'Insufficient permissions to modify this channel' });
    }
    
    const { name, description, isAnnouncement, allowedRoles, memberIds } = req.body;
    await updateChannel(req.params.channelId, { name, description, isAnnouncement, allowedRoles, memberIds });
    
    const updated = await getChannelById(req.params.channelId);
    const allChannels = await getAllChannels();
    io.emit('channels:update', allChannels);
    
    // Emit member-specific events for real-time sidebar updates
    if (memberIds) {
      const channel = await getChannelById(req.params.channelId);
      const currentMembers = channel?.memberIds || [];
      const newMembers = memberIds.filter((id: string) => !currentMembers.includes(id));
      const removedMembers = currentMembers.filter((id: string) => !memberIds.includes(id));
      
      for (const memberId of newMembers) {
        io.emit('channel:member_added', { channelId: req.params.channelId, userId: memberId });
      }
      for (const memberId of removedMembers) {
        io.emit('channel:member_removed', { channelId: req.params.channelId, userId: memberId });
      }
    }
    
    return res.json({ channel: updated });
  } catch (e) {
    console.error('[Channel] Update error:', e);
    return res.status(500).json({ error: 'Failed to update channel' });
  }
});

app.delete('/api/channels/:channelId', async (req, res) => {
  const userId = requireAuth(req, res);
  if (!userId) return;
  try {
    const channel = await getChannelById(req.params.channelId);
    if (!channel) return res.status(404).json({ error: 'Channel not found' });
    
    // Check permissions: only ADMIN or channel creator can delete
    const user = await getUserById(userId);
    if (!user || (user.role !== 'ADMIN' && channel.createdBy !== userId)) {
      return res.status(403).json({ error: 'Insufficient permissions to delete this channel' });
    }
    
    await deleteChannel(req.params.channelId);
    io.emit('channels:update', await getAllChannels());
    return res.json({ success: true });
  } catch (e) {
    console.error('[Channel] Delete error:', e);
    return res.status(500).json({ error: 'Failed to delete channel' });
  }
});

// ── Attachment Endpoints (Zero-Knowledge) ─────────────────────────────────────

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_ATTACHMENT_BYTES },
});

/**
 * POST /api/attachments/upload — the server only ever sees the *encrypted*
 * binary payload + encrypted metadata blob. It stores the bytes to disk and a
 * row in `attachments`; it never possesses decryption keys or plaintext.
 */
app.post('/api/attachments/upload', upload.single('file'), async (req, res) => {
  const userId = requireAuth(req, res);
  if (!userId) return;
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const { encryptedMetadata, binaryIv, metadataIv } = req.body;
    if (!encryptedMetadata || !binaryIv) {
      return res.status(400).json({ error: 'Missing encrypted metadata or binary IV' });
    }
    const attachmentId = `att_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const diskName = `${attachmentId}.enc`;
    const absPath = path.join(getUploadsDir(), diskName);
    fs.writeFileSync(absPath, req.file.buffer);

    await insertAttachment({
      id: attachmentId,
      messageId: null,
      filePath: diskName,
      encryptedMetadata,
      iv: binaryIv,
      metadataIv: metadataIv || '',
      createdAt: Date.now(),
    });
    console.log(`[Attachment] Stored ${diskName} (${req.file.size} bytes) from ${userId}`);
    return res.json({ attachmentId });
  } catch (e) {
    console.error('[Attachment] Upload error:', e);
    return res.status(500).json({ error: 'Upload failed' });
  }
});

/**
 * GET /api/attachments/:id — streams the encrypted binary payload.
 * Client-side WebCrypto decrypts it locally; server never sees plaintext.
 */
app.get('/api/attachments/:id', async (req, res) => {
  const userId = requireAuth(req, res);
  if (!userId) return;
  try {
    const attachment = await getAttachmentById(req.params.id);
    if (!attachment) return res.status(404).json({ error: 'Attachment not found' });

    if (attachment.messageId) {
      const msg = await getMessageById(attachment.messageId);
      if (msg) {
        if (msg.channelId) {
          // Channel attachment: only members holding a channel key may download
          const envelope = await getChannelKey(msg.channelId, userId);
          if (!envelope) return res.status(403).json({ error: 'Not a channel member' });
        } else if (msg.senderId !== userId && msg.recipientId !== userId) {
          return res.status(403).json({ error: 'Not a participant of this message' });
        }
      }
    }

    const abs = path.join(getUploadsDir(), attachment.filePath);
    if (!fs.existsSync(abs)) return res.status(404).json({ error: 'File missing on disk' });
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', 'attachment');
    res.setHeader('Cache-Control', 'no-store');
    return res.sendFile(abs);
  } catch (e) {
    console.error('[Attachment] Download error:', e);
    return res.status(500).json({ error: 'Download failed' });
  }
});

// ── Health Route ──────────────────────────────────────────────────────────────

app.get('/health', async (_req, res) => {
  try {
    const stats = await getDatabaseStats();
    res.json({
      status: 'ok',
      database: 'postgres',
      users: stats.users,
      channels: stats.channels,
      messages: stats.messages,
      attachments: stats.attachments,
      activeUsers: activeUsers.size,
      timestamp: new Date().toISOString(),
    });
  } catch (e) {
    res.status(500).json({ status: 'error', error: (e as Error).message });
  }
});

// ── Error Handler (multer limits, etc.) ───────────────────────────────────────

app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err?.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'File exceeds 25 MB limit' });
  }
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: `Upload error: ${err.message}` });
  }
  console.error('[Express] Unhandled error:', err);
  return res.status(500).json({ error: 'Server error' });
});

// ── Socket Events ─────────────────────────────────────────────────────────────

// Socket.IO authentication middleware
io.use((socket, next) => {
  const token = socket.handshake.auth?.token || socket.handshake.query?.token;
  if (!token) {
    return next(new Error('Authentication required'));
  }
  const decoded = verifyJwt(token as string);
  if (!decoded?.userId) {
    return next(new Error('Invalid or expired token'));
  }
  // Attach authenticated userId to socket for downstream use
  (socket as any).authenticatedUserId = decoded.userId;
  next();
});

io.on('connection', (socket) => {
  console.log(`[Socket] Connected: ${socket.id}`);

  socket.on('user:join', async (data: { userId: string; username: string; fullName?: string; role?: UserRole; publicKey: string; signingPublicKey?: string }) => {
    // Verify the claimed userId matches the authenticated socket user
    const authenticatedUserId = (socket as any).authenticatedUserId;
    if (data.userId !== authenticatedUserId) {
      console.warn(`[Socket] userId mismatch: claimed ${data.userId}, authenticated ${authenticatedUserId}`);
      return;
    }
    // Always use DB-resolved role, never trust client-supplied role (H7)
    const regUser = await getUserById(data.userId).catch(() => undefined);
    const activeUser = userToActive(data, socket.id, regUser);

    activeUsers.set(data.userId, activeUser);
    socketToUser.set(socket.id, data.userId);
    userToSocket.set(data.userId, socket.id);
    console.log(`[Registry] Joined: ${activeUser.username} (${data.userId}) [${activeUser.role}]`);

    // Send full user directory (excluding self) to joining user
    const directory = await buildUserDirectory(data.userId).catch(() => []);
    socket.emit('users:directory', directory);

    // Broadcast the new user's full data to ALL other connected clients
    // so they have the public key for E2EE decryption
    const fullUser = {
      userId: activeUser.userId,
      username: activeUser.username,
      fullName: activeUser.fullName,
      email: activeUser.email,
      role: activeUser.role,
      avatarUrl: activeUser.avatarUrl,
      publicKey: activeUser.publicKey,
      isOnline: true,
    };
    socket.broadcast.emit('user:online', fullUser);

    // Broadcast updated presence list to everyone
    const presence = Array.from(activeUsers.values()).map(u => ({ userId: u.userId, isOnline: true }));
    io.emit('users:presence', presence);
    io.emit('user:status_change', { userId: data.userId, isOnline: true, at: Date.now() });

    // Send channel list (persisted in PostgreSQL)
    const channels = await getAllChannels().catch(() => []);
    socket.emit('channels:update', channels);
  });

  // Channel CRUD
  socket.on('channel:create', async (data: { name: string; description: string; type: 'official' | 'team' | 'public' | 'private'; createdBy: string; isAnnouncement?: boolean; allowedRoles?: string[] }) => {
    // Permission check: only ADMIN can create official/public/announcement channels
    const creator = activeUsers.get(data.createdBy);
    const creatorRole = creator?.role || 'MEMBER';
    if ((data.type === 'official' || data.type === 'public' || data.isAnnouncement) && creatorRole !== 'ADMIN') {
      console.log(`[Channel] Rejected: ${data.createdBy} tried to create ${data.type} channel (requires ADMIN)`);
      return;
    }
    
    const channelId = data.name.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    const channels = await getAllChannels().catch(() => []);
    if (channels.some(c => c.id === channelId)) return;
    const newChannel: DbChannel = {
      id: channelId,
      name: data.name.toLowerCase(),
      description: data.description,
      type: data.type,
      createdBy: data.createdBy,
      createdAt: Date.now(),
      isAnnouncement: data.isAnnouncement || false,
      allowedRoles: data.allowedRoles || ['ADMIN', 'SUPERVISOR', 'MEMBER'],
    };
    await insertChannel(newChannel).catch(e => console.error('[Channel] Persist error:', e));
    console.log(`[Channel] Created #${newChannel.name}`);
    const updated = await getAllChannels().catch(() => [newChannel]);
    io.emit('channels:update', updated);
  });

  socket.on('channels:get', async () => {
    const channels = await getAllChannels().catch(() => []);
    socket.emit('channels:update', channels);
  });

  // Direct Message Send — persisted to PostgreSQL
  socket.on('message:send', async (payload: StoredMessage) => {
    const { recipientId, senderId, ciphertext, tempId, id, attachment } = payload;
    const messageId = id || `srv_${Date.now()}`;
    console.log(`[DM] ${senderId} → ${recipientId} | ${ciphertext.length} chars`);

    try {
      await insertMessage(toDbMessage({ ...payload, id: messageId, status: 'sent', timestamp: payload.timestamp || Date.now() }));
      if (attachment?.attachmentId) await linkAttachmentToMessage(attachment.attachmentId, messageId);
    } catch (e) {
      console.error('[DM] Persist error:', e);
    }

    // ACK to sender
    socket.emit('message:ack', {
      tempId: tempId || messageId,
      serverId: messageId,
      timestamp: Date.now(),
      status: 'sent',
    });

    // Relay to recipient if online
    if (recipientId) {
      const recipient = activeUsers.get(recipientId);
      if (recipient) {
        io.to(recipient.socketId).emit('message:receive', { ...payload, id: messageId, timestamp: payload.timestamp || Date.now() });
        console.log(`[DM] Relayed to ${recipient.username} (${recipient.socketId})`);
      } else {
        console.log(`[DM] Recipient ${recipientId} offline — stored in PostgreSQL for later fetch`);
      }
    }
  });

  // Group Channel Message Send — persisted to PostgreSQL
  socket.on('channel:message:send', async (payload: StoredMessage) => {
    const { channelId, senderId, ciphertext, tempId, id, attachment } = payload;
    if (!channelId) return;
    const messageId = id || `srv_${Date.now()}`;
    console.log(`[Channel] ${senderId} → #${channelId} | ${ciphertext.length} chars`);

    // Permission check for announcement channels: only ADMIN and SUPERVISOR can post
    try {
      const channel = await getChannelById(channelId);
      if (channel && channel.isAnnouncement) {
        const sender = activeUsers.get(senderId);
        const senderRole = sender?.role || 'MEMBER';
        if (senderRole === 'MEMBER') {
          socket.emit('message:ack', {
            tempId: tempId || messageId,
            serverId: messageId,
            timestamp: Date.now(),
            status: 'failed',
            error: 'Only Admins and Supervisors can post in official announcement channels.'
          });
          return;
        }
      }
    } catch (e) {
      console.error('[Channel] Permission check error:', e);
    }

    // Check membership for private/team channels
    const channel = await getChannelById(channelId);
    const userChannels = await getChannelMembers(channelId);
    if (channel && (channel.type === 'private' || channel.type === 'team') && !userChannels.includes(senderId)) {
      socket.emit('message:ack', {
        tempId: tempId || messageId,
        serverId: messageId,
        timestamp: Date.now(),
        status: 'failed',
        error: 'You are not a member of this channel.'
      });
      return;
    }

    try {
      await insertMessage(toDbMessage({ ...payload, id: messageId, status: 'sent', timestamp: payload.timestamp || Date.now() }));
      if (attachment?.attachmentId) await linkAttachmentToMessage(attachment.attachmentId, messageId);
    } catch (e) {
      console.error('[Channel] Persist error:', e);
    }

    // ACK
    socket.emit('message:ack', {
      tempId: tempId || messageId,
      serverId: messageId,
      timestamp: Date.now(),
      status: 'sent',
    });

    // Broadcast to all other connected clients
    socket.broadcast.emit('channel:message:receive', { ...payload, id: messageId, timestamp: payload.timestamp || Date.now() });
  });

  // Delivery receipt: Recipient device saved message ➔ Notify sender of delivery
  socket.on('message:delivered', (data: { messageId: string; senderId: string }) => {
    const sender = activeUsers.get(data.senderId);
    if (sender) {
      io.to(sender.socketId).emit('message:delivered_ack', { id: data.messageId });
    }
  });

  // Read receipt: Recipient opened active conversation thread ➔ Notify sender of read status
  socket.on('message:read', (data: { conversationId: string; senderId: string; lastReadMessageId?: string }) => {
    const sender = activeUsers.get(data.senderId);
    if (sender) {
      io.to(sender.socketId).emit('message:read_ack', { conversationId: data.conversationId, lastReadMessageId: data.lastReadMessageId });
    }
  });

  // Message Edit — with authorization check (H3)
  socket.on('message:edit', async (data: { id: string; newCiphertext: string; newIv: string; recipientId?: string; channelId?: string }) => {
    const authenticatedUserId = (socket as any).authenticatedUserId;
    const originalMsg = await getMessageById(data.id).catch(() => undefined);
    if (!originalMsg || originalMsg.senderId !== authenticatedUserId) {
      socket.emit('message:edit:rejected', { id: data.id, error: 'Unauthorized: you can only edit your own messages' });
      return;
    }
    await updateMessageEdit(data.id, data.newCiphertext, data.newIv).catch(e => console.error('[Edit] Persist error:', e));
    // Restrict broadcast to relevant participants, not all clients (H5)
    if (data.recipientId) {
      const recipient = activeUsers.get(data.recipientId);
      if (recipient) io.to(recipient.socketId).emit('message:edited', { id: data.id, newCiphertext: data.newCiphertext, newIv: data.newIv, editedAt: Date.now() });
    } else if (data.channelId) {
      socket.broadcast.emit('message:edited', { id: data.id, newCiphertext: data.newCiphertext, newIv: data.newIv, editedAt: Date.now() });
    } else {
      socket.broadcast.emit('message:edited', { id: data.id, newCiphertext: data.newCiphertext, newIv: data.newIv, editedAt: Date.now() });
    }
  });

  // Message Delete — with authorization check (H3)
  socket.on('message:delete', async (data: { id: string; recipientId?: string; channelId?: string }) => {
    const authenticatedUserId = (socket as any).authenticatedUserId;
    const originalMsg = await getMessageById(data.id).catch(() => undefined);
    if (!originalMsg || originalMsg.senderId !== authenticatedUserId) {
      socket.emit('message:delete:rejected', { id: data.id, error: 'Unauthorized: you can only delete your own messages' });
      return;
    }
    await markMessageDeleted(data.id).catch(e => console.error('[Delete] Persist error:', e));
    // Restrict broadcast to relevant participants, not all clients (H5)
    if (data.recipientId) {
      const recipient = activeUsers.get(data.recipientId);
      if (recipient) io.to(recipient.socketId).emit('message:deleted', { id: data.id, deletedForEveryone: true });
    } else if (data.channelId) {
      socket.broadcast.emit('message:deleted', { id: data.id, deletedForEveryone: true });
    } else {
      socket.broadcast.emit('message:deleted', { id: data.id, deletedForEveryone: true });
    }
  });

  // Reactions
  socket.on('reaction:add', async (data: { messageId: string; emoji: string; userId: string }) => {
    await addReaction(data.messageId, data.userId, data.emoji).catch(e => console.error('[Reaction] Add error:', e));
    const reactions = await getReactionsForMessage(data.messageId).catch(() => []);
    io.emit('message:reactions', { messageId: data.messageId, reactions });
  });

  socket.on('reaction:remove', async (data: { messageId: string; emoji: string; userId: string }) => {
    await removeReaction(data.messageId, data.userId, data.emoji).catch(e => console.error('[Reaction] Remove error:', e));
    const reactions = await getReactionsForMessage(data.messageId).catch(() => []);
    io.emit('message:reactions', { messageId: data.messageId, reactions });
  });

  // Message Pinning
  socket.on('message:pin', async (data: { channelId: string; messageId: string; userId: string }) => {
    await pinMessage(data.channelId, data.messageId, data.userId).catch(e => console.error('[Pin] Error:', e));
    const pinned = await getPinnedMessages(data.channelId).catch(() => []);
    io.emit('channel:pinned', { channelId: data.channelId, pinned });
  });

  socket.on('message:unpin', async (data: { channelId: string; messageId: string }) => {
    await unpinMessage(data.channelId, data.messageId).catch(e => console.error('[Unpin] Error:', e));
    const pinned = await getPinnedMessages(data.channelId).catch(() => []);
    io.emit('channel:pinned', { channelId: data.channelId, pinned });
  });

  // Typing Indicators
  socket.on('user:typing', (data: { userId: string; username: string; channelId?: string; recipientId?: string }) => {
    if (data.channelId) {
      socket.to(`channel:${data.channelId}`).emit('user:typing', data);
    } else if (data.recipientId) {
      const recipientSocketId = userToSocket.get(data.recipientId);
      if (recipientSocketId) {
        io.to(recipientSocketId).emit('user:typing', data);
      }
    }
  });

  socket.on('user:stop_typing', (data: { userId: string; channelId?: string; recipientId?: string }) => {
    if (data.channelId) {
      socket.to(`channel:${data.channelId}`).emit('user:stop_typing', data);
    } else if (data.recipientId) {
      const recipientSocketId = userToSocket.get(data.recipientId);
      if (recipientSocketId) {
        io.to(recipientSocketId).emit('user:stop_typing', data);
      }
    }
  });

  socket.on('disconnect', () => {
    const userId = socketToUser.get(socket.id);
    if (userId) {
      const user = activeUsers.get(userId);
      console.log(`[Registry] Disconnected: ${user?.username} (${userId})`);
      activeUsers.delete(userId);
      socketToUser.delete(socket.id);
      userToSocket.delete(userId);
      // Broadcast updated presence
      const presence = Array.from(activeUsers.values()).map(u => ({ userId: u.userId, isOnline: true }));
      io.emit('users:presence', presence);
      io.emit('user:status_change', { userId, isOnline: false, at: Date.now() });
    }
  });
});

// ── Start ─────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3001;

async function boot() {
  try {
    await initDatabase();
  } catch (e) {
    console.error('[Boot] Failed to initialise PostgreSQL:', e);
    process.exit(1);
  }

  server.listen(PORT, () => {
    console.log(`\n================================================`);
    console.log(`  VaultChat Enterprise E2EE — Port ${PORT}`);
    console.log(`  Roles: ADMIN | MEMBER`);
    console.log(`  Database: PostgreSQL (persistent)`);
    console.log(`  APIs: /api/users  /api/messages  /api/messages/direct/:id`);
    console.log(`  Attachments: /api/attachments/upload | /api/attachments/:id`);
    console.log(`================================================\n`);
  });
}

async function gracefulShutdown() {
  console.log('\n[Shutdown] Stopping PostgreSQL & server…');
  await shutdownDatabase();
  process.exit(0);
}

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

boot();
