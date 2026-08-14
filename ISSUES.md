# VaultChat Issues Tracker

## Issue 1: `setAllUsersAndRef is not defined`
- **Root Cause**: HMR stale cache. Source code is clean - no references to `setAllUsersAndRef`.
- **Status**: FIXED (code) / USER ACTION NEEDED (hard-refresh browser)

## Issue 2: `ERR_INTERNET_DISCONNECTED` on reactions/starred
- **Root Cause**: Server at localhost:3001 not running or crashed.
- **Status**: NOT A CODE ISSUE - user needs to start the server

## Issue 3: `E2EE Decrypt error: OperationError`
- **Root Cause**: Wrong ECDH key used for decryption. Peer's public key in `allUsers` is stale (key rotation happened but client hasn't received the update yet).
- **Status**: KNOWN LIMITATION - key rotation requires re-sync

## Issue 4: `<button>` nested in `<button>` in Sidebar
- **Root Cause**: Mute/close/unhide action buttons are `<button>` elements inside the outer channel/user `<button>` row.
- **Fix**: Change outer rows from `<button>` to `<div role="button">`
- **Status**: FIXED

## Issue 5: Announcements channel has no key envelope (404)
- **Root Cause**: `seedDefaultChannels` inserts channels but never creates channel_keys. No AES key is generated for default channels.
- **Fix**: Generate channel key when user first joins a default channel
- **Status**: FIXED

## Issue 6: Checkmarks not working / duplicate messages
- **Root Cause**: 
  - `updateMessageStatus` deletes old tempId entry and creates new serverId entry
  - Polling `setAllMessages` keyed by `id` finds the new entry as "new" and adds it, but doesn't remove the old tempId entry
  - Result: old stale copy + new copy = duplicates or stale checkmark
- **Fix**: Polling should remove messages no longer in IndexedDB
- **Status**: FIXED
