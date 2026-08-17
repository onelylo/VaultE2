# Persistent Issues — Known Bugs to Fix Later

## Blocking Doesn't Update After Unblock (Needs Refresh)

**Issue**: When a user blocks another user, then unblocks them, the blocked state doesn't update in the UI until a page refresh.

**Root Cause**: The `isBlockedDM` check in `ChatArea.tsx` uses `useLiveQuery(() => db.blockedUsers.toArray())` which should be reactive. However, the `unblockUser` function in `db.ts` deletes from Dexie, but the `useLiveQuery` might not be triggering a re-render properly.

**Attempted Fixes**:
1. Removed stale `blockedByThem` check ✅
2. Used `useLiveQuery` for reactive blocked users ✅
3. Called server API on unblock ✅

**Suspected Issue**: The `useLiveQuery` dependency might not be updating correctly, or there's a race condition between the Dexie delete and the React re-render.

**Next Steps to Try**:
1. Add explicit `key` prop to force re-render on unblock
2. Use `useEffect` to watch `blockedUsersData` and force state update
3. Check if Dexie's `liveQuery` is properly detecting the delete operation
4. Try using `db.blockedUsers.delete(userId).then(() => forceUpdate())` in the unblock handler

---

## DM List Resets on Refresh

**Issue**: The recent DMs list resets to default order on page refresh, despite localStorage persistence.

**Root Cause**: The `getActiveDMPartners()` function returns partners from Dexie, which might not match the localStorage order. The sort logic uses `Map.get()` with `??` operator, but the partners might be getting overwritten by the fresh Dexie data.

**Attempted Fixes**:
1. Added localStorage save/load ✅
2. Fixed sort with `Map.get()` + `??` operator ✅
3. Added debug logging ✅

**Suspected Issue**: The `getActiveDMPartners()` function might be returning all partners, not just the ones in localStorage. Or the `setRecentDMs` is being called after the initial load, overwriting the sorted list.

**Next Steps to Try**:
1. Log the `savedOrder` and `partnerUsers` to see if they match
2. Check if `getActiveDMPartners()` returns the same partners as localStorage
3. Use `useEffect` to merge localStorage order with fresh data
4. Consider persisting the entire `recentDMs` array to localStorage instead of just IDs

---

*Documented on: 2026-08-17*
*Status: Known issues, deferred for future fix*

---

## DM List Position Resets on Refresh (Partially Fixed)

**Issue**: The DM list order should persist across sessions. Currently it works via localStorage but has edge cases.

**Current Implementation**: 
- `vaultchat_recentDMs` localStorage key stores ordered user IDs
- On login, DM partners are sorted using saved order
- `upsertDMConversation` moves peer to front on new message

**Edge Cases to Fix**:
1. Hidden conversations lose position when unhidden
2. Muted conversations may not maintain order across sessions
3. If localStorage is cleared, order resets to Dexie default

**Next Steps to Try**:
1. Include hidden conversation IDs in localStorage order
2. Verify muted conversation persistence
3. Consider migrating DM order to Dexie for more reliable persistence

---

*Documented on: 2026-08-17*
*Status: Known issues, deferred for future fix*
