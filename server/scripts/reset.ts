console.log(`
============================================================
           VAULTCHAT SYSTEM RESET INSTRUCTIONS
============================================================

1. SERVER STATE:
   The VaultChat backend operates with in-memory persistence.
   Restarting the server process clears all active users,
   direct message histories, and dynamically created channels.

2. BROWSER INDEXEDDB & STORAGE:
   To completely clear all local E2EE keypairs and cached messages:
   - Open Developer Tools in your browser (F12)
   - Go to Application -> Storage / IndexedDB
   - Delete 'VaultChatDB'
   - Clear LocalStorage ('vaultchat_jwt')

3. SLATE IS FRESH!
   You can now test clean account registrations with ADMIN and
   MEMBER roles.
============================================================
`);
