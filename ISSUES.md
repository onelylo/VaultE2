# VaultChat Issues Tracker

## FIXED

### C1. Hardcoded admin credentials
- Admin password now from `ADMIN_PASSWORD` env var
- Skips seed if not set

### C4. Test files with hardcoded credentials
- Deleted `cleanup.js`, `test-db.js`, `test-api.js`

### H3. Link preview broken (missing auth header)
- Now uses `API_BASE` and includes `Authorization: Bearer` header

### H4. No input validation on profile fields
- Added validation: fullName max 100 chars, email regex, phone max 20 chars, statusMessage max 200 chars, username 3-30 chars alphanumeric

### H5. Password change doesn't invalidate other sessions
- Server now emits `user:password_changed` to force disconnect all sessions
- Client handler forces logout and shows alert

### H6. Channel edit/delete broadcasts to ALL clients
- Changed from `socket.broadcast.emit` to `socket.to('channel:id').emit` for channel messages

### L5. Token expiry check multiplies by 1000 incorrectly
- Removed `* 1000` — exp is already in milliseconds

### M5. deleteUser hard-deletes messages
- Changed to soft-delete (`UPDATE messages SET is_deleted = TRUE`)

### M8. user:join allows username/publicKey spoofing
- `userToActive` now uses DB-resolved values instead of client-supplied

### M10. Redundant 1s polling for message updates
- Removed polling — `useLiveQuery` already handles reactive updates

### Admin seed account
- Uses same ID formula as login (`usr_onelylo` not `admin_random`)
- Password from env var, not hardcoded

### Unique username enforcement
- Registration validates username format (3-30 chars, alphanumeric + underscore)
- Checks for existing username before creating

## REMAINING

### M1. PBKDF2 100K iterations (OWASP recommends 600K)
- Status: KNOWN LIMITATION — requires migration for existing users

### M2. Token blocklist in-memory only
- Status: LOW PRIORITY — resets on server restart

### M3. SlowMode tracker in-memory only
- Status: LOW PRIORITY — resets on server restart

### M4. Rate limit maps grow unboundedly
- Status: LOW PRIORITY — needs periodic cleanup

### M6. Missing reply_to foreign key constraint
- Status: LOW PRIORITY — client handles orphaned replies

### M7. getAllUsers loads password_hash into memory
- Status: LOW PRIORITY — `publicUser()` correctly strips it before sending

### L1. Fingerprint only 8 hex chars
- Status: LOW PRIORITY — weak collision resistance

### L6. Multiple modals competing for z-index
- Status: LOW PRIORITY — fragile layering

### L8. Missing aria-label on icon-only buttons
- Status: LOW PRIORITY — accessibility

### L10. No explicit CSP header
- Status: LOW PRIORITY — helmet default may suffice

### L11. Avatar stored as base64 in DB
- Status: LOW PRIORITY — bloats responses
