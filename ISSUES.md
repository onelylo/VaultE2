# VaultChat Issues Tracker

## Issue 1: `setAllUsersAndRef is not defined`
- **Root Cause**: HMR stale cache. Source code is clean - no references to `setAllUsersAndRef`.
- **Status**: FIXED (code) / USER ACTION NEEDED (restart Vite dev server)

## Issue 2: `ERR_INTERNET_DISCONNECTED` on reactions/starred
- **Root Cause**: Server at localhost:3001 not running or crashed.
- **Status**: NOT A CODE ISSUE - user needs to start the server

## Issue 3: `E2EE Decrypt error: OperationError`
- **Root Cause**: Wrong ECDH key used for decryption. Peer's public key in `allUsers` is stale (key rotation happened but client hasn't received the update yet).
- **Status**: KNOWN LIMITATION - key rotation requires re-sync

## Issue 4: `<button>` nested in `<button>` in Sidebar
- **Root Cause**: Mute/close/unhide action buttons are `<button>` elements inside the outer channel/user `<button>` row.
- **Fix**: Changed outer rows from `<button>` to `<div role="button" tabIndex={0}>`
- **Status**: FIXED

## Issue 5: Announcements channel has no key envelope (404)
- **Root Cause**: `seedDefaultChannels` inserts channels but never creates channel_keys. No AES key is generated for default channels.
- **Fix**: `getOrGenerateChannelKey` now generates and distributes a new key when server returns 404.
- **Status**: FIXED

## Issue 6: Checkmarks not working / duplicate messages
- **Root Cause**: `updateMessageStatus` changes message ID (tempId → serverId). Polling doesn't remove old tempId entries.
- **Fix**: Polling now removes stale entries from allMessages that no longer exist in IndexedDB.
- **Status**: FIXED

## Issue 7: Reactions fail with "WIN1252 encoding" error
- **Root Cause**: Embedded PostgreSQL initialized with default WIN1252 encoding. Emoji characters (👍) require UTF-8.
- **Fix**: Added `initdbFlags: ['--encoding=UTF8', '--locale=en_US.UTF-8']` to EmbeddedPostgres config. Existing database must be deleted and re-initialized.
- **Status**: FIXED (requires database re-init: delete `.pgdata` folder)
