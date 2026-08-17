-- VaultChat Enterprise E2EE — PostgreSQL Schema
-- All application state persists here so the server can restart without data loss.

CREATE TABLE IF NOT EXISTS users (
  id                     TEXT PRIMARY KEY,
  username               TEXT NOT NULL UNIQUE,
  display_name           TEXT,
  email                  TEXT,
  role                   TEXT NOT NULL DEFAULT 'MEMBER',
  password_hash          TEXT NOT NULL DEFAULT '',
  public_key             TEXT NOT NULL,
  encrypted_private_key  TEXT,
  key_salt               TEXT,
  key_version            INTEGER NOT NULL DEFAULT 1,
  key_rotation_signature TEXT,
  old_public_key         TEXT,
  signing_public_key     TEXT,
  old_signing_public_key TEXT,
  deleted_at             TIMESTAMPTZ,
  created_at             BIGINT NOT NULL
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS key_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN IF NOT EXISTS key_rotation_signature TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS old_public_key TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS signing_public_key TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS old_signing_public_key TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE users ADD COLUMN IF NOT EXISTS status_message TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT;

CREATE TABLE IF NOT EXISTS channels (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  type        TEXT NOT NULL DEFAULT 'official',
  created_by  TEXT,
  created_at  BIGINT NOT NULL,
  is_announcement BOOLEAN DEFAULT FALSE,
  allowed_roles TEXT[] DEFAULT ARRAY['ADMIN', 'SUPERVISOR', 'MEMBER']
);

CREATE TABLE IF NOT EXISTS channel_keys (
  id                    SERIAL PRIMARY KEY,
  channel_id            TEXT NOT NULL,
  user_id               TEXT NOT NULL,
  encrypted_channel_key TEXT NOT NULL,
  iv                    TEXT NOT NULL DEFAULT '',
  UNIQUE (channel_id, user_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id           TEXT PRIMARY KEY,
  temp_id      TEXT,
  sender_id    TEXT NOT NULL,
  recipient_id TEXT,
  channel_id   TEXT,
  ciphertext   TEXT NOT NULL DEFAULT '',
  iv           TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL DEFAULT 'sent',
  is_edited    BOOLEAN NOT NULL DEFAULT FALSE,
  is_deleted   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   BIGINT NOT NULL
);

-- Migrations for existing databases
ALTER TABLE messages ADD COLUMN IF NOT EXISTS reply_to TEXT;

CREATE INDEX IF NOT EXISTS idx_messages_dm      ON messages (sender_id, recipient_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages (channel_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_inbox   ON messages (recipient_id, status);

CREATE TABLE IF NOT EXISTS attachments (
  id                  TEXT PRIMARY KEY,
  message_id          TEXT,
  file_path           TEXT NOT NULL,
  encrypted_metadata  TEXT NOT NULL,
  iv                  TEXT NOT NULL DEFAULT '',
  metadata_iv         TEXT NOT NULL DEFAULT '',
  created_at          BIGINT NOT NULL
);

ALTER TABLE attachments ADD COLUMN IF NOT EXISTS metadata_iv TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_attachments_message ON attachments (message_id);

ALTER TABLE channels ADD COLUMN IF NOT EXISTS is_announcement BOOLEAN DEFAULT FALSE;
ALTER TABLE channels ADD COLUMN IF NOT EXISTS allowed_roles TEXT[] DEFAULT ARRAY['ADMIN', 'SUPERVISOR', 'MEMBER'];
ALTER TABLE channels ADD COLUMN IF NOT EXISTS slow_mode_seconds INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS channel_members (
  channel_id  TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  assigned_by TEXT,
  created_at  BIGINT NOT NULL,
  PRIMARY KEY (channel_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_channel_members_user ON channel_members (user_id);

CREATE TABLE IF NOT EXISTS message_reactions (
  message_id  TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  emoji       TEXT NOT NULL,
  created_at  BIGINT NOT NULL,
  PRIMARY KEY (message_id, user_id, emoji)
);

CREATE INDEX IF NOT EXISTS idx_reactions_message ON message_reactions (message_id);

CREATE TABLE IF NOT EXISTS pinned_messages (
  channel_id  TEXT NOT NULL,
  message_id  TEXT NOT NULL,
  pinned_by   TEXT NOT NULL,
  pinned_at   BIGINT NOT NULL,
  PRIMARY KEY (channel_id, message_id)
);

CREATE INDEX IF NOT EXISTS idx_pinned_channel ON pinned_messages (channel_id);

CREATE TABLE IF NOT EXISTS starred_messages (
  user_id     TEXT NOT NULL,
  message_id  TEXT NOT NULL,
  starred_at  BIGINT NOT NULL,
  PRIMARY KEY (user_id, message_id)
);

CREATE INDEX IF NOT EXISTS idx_starred_user ON starred_messages (user_id);

CREATE TABLE IF NOT EXISTS blocked_users (
  blocker_id  TEXT NOT NULL,
  blocked_id  TEXT NOT NULL,
  created_at  BIGINT NOT NULL,
  PRIMARY KEY (blocker_id, blocked_id)
);

CREATE INDEX IF NOT EXISTS idx_blocked_blocker ON blocked_users (blocker_id);
CREATE INDEX IF NOT EXISTS idx_blocked_blocked ON blocked_users (blocked_id);

CREATE TABLE IF NOT EXISTS audit_log (
  id          SERIAL PRIMARY KEY,
  actor_id    TEXT NOT NULL,
  action      TEXT NOT NULL,
  target_type TEXT,
  target_id   TEXT,
  details     TEXT,
  created_at  BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_log (actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log (action);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log (created_at);

CREATE TABLE IF NOT EXISTS token_blocklist (
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  expires_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_token_blocklist_user ON token_blocklist (user_id);
CREATE INDEX IF NOT EXISTS idx_token_blocklist_expires ON token_blocklist (expires_at);

-- Friends system
CREATE TABLE IF NOT EXISTS friends (
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  friend_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status      TEXT NOT NULL DEFAULT 'pending', -- pending, accepted, blocked
  created_at  BIGINT NOT NULL,
  PRIMARY KEY (user_id, friend_id)
);

CREATE INDEX IF NOT EXISTS idx_friends_user ON friends (user_id);
CREATE INDEX IF NOT EXISTS idx_friends_friend ON friends (friend_id);
CREATE INDEX IF NOT EXISTS idx_friends_status ON friends (status);

-- Hubs (servers/guilds)
CREATE TABLE IF NOT EXISTS hubs (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT DEFAULT '',
  icon_url    TEXT,
  banner_url  TEXT,
  created_by  TEXT REFERENCES users(id),
  created_at  BIGINT NOT NULL
);

-- Hub members
CREATE TABLE IF NOT EXISTS hub_members (
  hub_id    TEXT NOT NULL REFERENCES hubs(id) ON DELETE CASCADE,
  user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role      TEXT NOT NULL DEFAULT 'member', -- owner, admin, member
  joined_at BIGINT NOT NULL,
  PRIMARY KEY (hub_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_hub_members_user ON hub_members (user_id);

-- Groups within hubs (categories/channels)
CREATE TABLE IF NOT EXISTS groups (
  id          TEXT PRIMARY KEY,
  hub_id      TEXT NOT NULL REFERENCES hubs(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT DEFAULT '',
  type        TEXT NOT NULL DEFAULT 'text', -- text, voice, announcement
  position    INTEGER NOT NULL DEFAULT 0,
  created_at  BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_groups_hub ON groups (hub_id);

-- Group visibility (which members can see/access)
CREATE TABLE IF NOT EXISTS group_visibility (
  group_id  TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (group_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_group_visibility_user ON group_visibility (user_id);

-- User profile extensions (display_name already exists from initial schema)
ALTER TABLE users ADD COLUMN IF NOT EXISTS banner_url TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS bio TEXT;

-- Remove company roles: set all users to MEMBER (admin dashboard still uses role field)
UPDATE users SET role = 'MEMBER' WHERE role IS NULL OR role = '';
