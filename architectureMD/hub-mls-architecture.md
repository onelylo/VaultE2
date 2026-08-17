# Vault2E — Hub End-to-End Encryption via MLS

**Author:** Senior Cryptographic Systems Engineer
**Date:** 2026-08-17
**Status:** Design Document (Production-Grade)
**Supersedes:** Current AES key distribution via ECDH envelopes

---

## 1. MLS Architecture Decision — Why MLS for Hubs?

### 1.1 Problem with Current Channel Key Distribution

The current system uses a single AES-256-GCM symmetric key per channel, distributed via per-member ECDH envelopes. This has fundamental scaling and security problems:

| Issue | Current Approach | Impact |
|-------|-----------------|--------|
| O(m) key distribution | Creator encrypts key for each of m members | Channel with 1000 members = 1000 encryptions per rotation |
| Best-effort rotation | Creator must be online to rotate on member removal | Removed member retains access during rotation window |
| No partial access control | Single key = full channel access | Cannot revoke access for one member without re-keying all |
| Creator bottleneck | Creator distributes keys to all members | Creator offline = new members can't join securely |
| Forward secrecy | None — same key until manual rotation | Compromised key exposes all channel history |

### 1.2 Why MLS Specifically

MLS (Messaging Layer Security, RFC 9420) is the IETF standard for group E2EE. It solves every problem above:

```
┌──────────────────────────────────────────────────────────────┐
│                    MLS vs CURRENT APPROACH                     │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  Current: O(m) distribution                                  │
│  ┌────┐    ┌──────────────────────────────┐                 │
│  │Admin│───→│ Encrypt key for member 1     │                 │
│  │    │───→│ Encrypt key for member 2     │                 │
│  │    │───→│ ...                           │                 │
│  │    │───→│ Encrypt key for member m     │                 │
│  └────┘    └──────────────────────────────┘                 │
│  Cost: O(m) encryptions, O(m) network round trips            │
│                                                              │
│  MLS: O(log m) tree operations                               │
│  ┌────┐    ┌──────────────────────────────┐                 │
│  │Commit│──→│ Update ratchet tree leaf     │                 │
│  │     │   │ Broadcast commit + Welcome   │                 │
│  └────┘   └──────────────────────────────┘                 │
│  Cost: O(log m) tree updates, O(1) commit message            │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

**MLS Properties:**

| Property | Description |
|----------|-------------|
| Forward Secrecy | Epoch-based key derivation; compromising one epoch doesn't expose others |
| Post-Compromise Security | Key updates heal the session after compromise |
| Asynchronous Delivery | Welcome messages allow offline members to join |
| Scalable Membership | Tree-based key distribution scales logarithmically |
| Out-of-Order Tolerance | Epoch-based; messages tagged with epoch, not sequential |
| Server Canonicalization | Server orders commits to prevent split-brain |

---

## 2. Group Model — Per-Channel MLS Groups

### 2.1 Mapping Vault2E Entities to MLS

```
┌──────────────────────────────────────────────────────────────┐
│              VAULT2E → MLS MAPPING                            │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  Vault2E Hub          →  MLS Group (supergroup)             │
│  Vault2E Channel      →  MLS Group (per-channel)            │
│  Vault2E User         →  MLS Member                         │
│  Vault2E Device       →  MLS Leaf Node                      │
│  Vault2E Role         →  MLS Extensions (permissions)       │
│                                                              │
│  Design Decision: Per-Channel MLS Groups                     │
│  ─────────────────────────────────────────                    │
│  Each channel is an independent MLS group.                   │
│  Rationale:                                                  │
│  - Channels have different membership                        │
│  - Channel deletion = group deletion                         │
│  - Permission model maps cleanly to group operations         │
│  - Channel encryption is independent of other channels       │
│                                                              │
│  NOT per-hub groups because:                                 │
│  - Hub members may not all be in all channels                │
│  - Channel-level access control is a core feature            │
│  - Group size varies wildly (2 members to 1000+)             │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### 2.2 Group Size Considerations

| Channel Type | Expected Members | MLS Suitability |
|-------------|-----------------|-----------------|
| DM (2 people) | 2 | Overkill; use X3DH + Double Ratchet instead |
| Small team channel | 3-20 | Ideal MLS use case |
| Department channel | 20-100 | Good MLS use case |
| Announcement channel | 100-1000 | MLS scales well (tree depth ≤ 10) |
| Hub-wide | All hub members | MLS with compression; tree depth ≤ 15 |

---

## 3. MLS Group Lifecycle

### 3.1 State Machine — Full Lifecycle

```
┌──────────────────────────────────────────────────────────────┐
│                    MLS GROUP LIFECYCLE                         │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────┐                                                │
│  │  CREATE   │ ← Channel created                            │
│  └────┬─────┘                                                │
│       │                                                      │
│       ▼                                                      │
│  ┌──────────┐    add_member()    ┌──────────┐               │
│  │  EPOCH 0  │ ───────────────→ │  EPOCH 1  │               │
│  │ (initial) │                   │ (2 members)│              │
│  └──────────┘                   └────┬─────┘               │
│                                       │                      │
│                               ┌───────┴───────┐             │
│                               │               │             │
│                         add_member()    remove_member()     │
│                               │               │             │
│                               ▼               ▼             │
│                        ┌──────────┐    ┌──────────┐        │
│                        │  EPOCH 2  │    │  EPOCH 3  │        │
│                        │ (3 members)│   │ (2 members)│       │
│                        └────┬─────┘    └────┬─────┘        │
│                             │               │               │
│                     update_keys()    update_keys()          │
│                             │               │               │
│                             ▼               ▼               │
│                        ┌──────────┐    ┌──────────┐        │
│                        │  EPOCH 4  │    │  EPOCH 5  │        │
│                        │ (healed) │    │ (healed)  │        │
│                        └────┬─────┘    └────┬─────┘        │
│                             │               │               │
│                             └───────┬───────┘               │
│                                     │                       │
│                               delete_channel()              │
│                                     │                       │
│                                     ▼                       │
│                              ┌──────────┐                   │
│                              │  DELETED  │                   │
│                              │ (wiped)   │                   │
│                              └──────────┘                   │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### 3.2 Commit Protocol

Every state change (add, remove, update) produces a **commit** — a signed, ordered group operation.

```
┌──────────────────────────────────────────────────────────────┐
│                    COMMIT STRUCTURE                            │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  Commit = {                                                 │
│    group_id:     channel_id,                                │
│    epoch:        incrementing counter,                       │
│    sender:       { user_id, device_id },                    │
│    proposals:    [Add | Remove | Update | PSK],             │
│    path:         { node: enc_node, signature },             │
│    confirmation: MAC(epoch_secret, commit_content),          │
│    signature:    Ed25519(IK_priv, commit_content)           │
│  }                                                           │
│                                                              │
│  Commit Content (AAD for all encryption):                    │
│  = group_id ‖ epoch ‖ sender ‖ proposals ‖ path.node       │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### 3.3 Epoch Key Derivation

```
┌──────────────────────────────────────────────────────────────┐
│              MLS KEY SCHEDULE (per epoch)                      │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  Tree Secret (from ratchet tree)                             │
│       │                                                      │
│       ▼                                                      │
│  HKDF-Expand-Label(                                          │
│    Secret = TreeSecret,                                      │
│    Label  = "epoch",                                         │
│    Context = group_id ‖ epoch,                               │
│    Length = 32                                                │
│  )                                                           │
│       │                                                      │
│       ▼                                                      │
│  Epoch Secret (ES)                                           │
│       │                                                      │
│       ├──→ HKDF-Expand-Label(ES, "app", ...) → AppSecret    │
│       │         │                                            │
│       │         ▼                                            │
│       │    Derive-Secret(AppSecret, "enc", ...) → EncKey    │
│       │    Derify-Secret(AppSecret, "mic", ...) → MICKey    │
│       │    Derive-Secret(AppSecret, "iv",  ...) → IV        │
│       │                                                      │
│       ├──→ HKDF-Expand-Label(ES, "cons", ...) → ConfirmKey  │
│       │                                                      │
│       └──→ HKDF-Expand-Label(ES, "AppDerive", ...) →        │
│            Derive-Secret(EpochSecret, "msg", ...) →          │
│            Message encryption key                            │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

---

## 4. Key Packages — Device Identity in MLS

### 4.1 Key Package Structure

Each device publishes a Key Package to the server. The Key Package contains everything needed to add that device to a group.

```
┌──────────────────────────────────────────────────────────────┐
│                    KEY PACKAGE (per device)                    │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  KeyPackage = {                                             │
│    // Identity                                               │
│    ik:           Ed25519 public key,                        │
│    device_id:    string,                                    │
│    user_id:      string,                                    │
│                                                              │
│    // Signed prekey (X25519)                                │
│    spk:          X25519 public key,                         │
│    spk_sig:      Ed25519(IK_priv, serialize(spk)),         │
│                                                              │
│    // Capabilities                                            │
│    capabilities: ["Vault2E_v2", "MLS_1.0"],                │
│                                                              │
│    // Lifetime                                                │
│    not_before:   timestamp,                                 │
│    not_after:    timestamp,                                 │
│                                                              │
│    // Signature                                               │
│    signature:    Ed25519(IK_priv,                          │
│                    serialize(ik, spk, capabilities, ...))   │
│  }                                                           │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### 4.2 Key Package Storage & Lifecycle

```
  Device A                    Server                         Device B
  ─────────                   ──────                         ─────────
  Generate IK, SPK           Store KeyPackage               Fetch KeyPackage
  Sign SPK with IK           Associate with user_id         Verify signature
  Create KeyPackage          Return on request               Use for Add proposal
  Upload: POST /key-packages

  Pool management:
  - Upload batch of 100 KeyPackages
  - Server marks consumed ones as used
  - When pool < 20, upload new batch
  - Expired KeyPackages purged after not_after
```

### 4.3 Welcome Messages

When a member is added to a group, they receive a **Welcome** message containing the current group state encrypted to their Key Package.

```
┌──────────────────────────────────────────────────────────────┐
│                    WELCOME MESSAGE                             │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  Welcome = {                                                │
│    group_id:    channel_id,                                 │
│    epoch:       current epoch,                              │
│    ratchet_tree: [                                          │
│      { node_type: "leaf", ik: "...", spk: "..." },         │
│      { node_type: "node", public: "..." },                  │
│      { node_type: "leaf", ik: "...", spk: "..." },         │
│      ...                                                     │
│    ],                                                        │
│    encrypted_group_info: AES-GCM(                           │
│      key = DeriveSecret(                                  │
│              PSK_from團tree, "welcome"),                    │
│      plaintext = { epoch_secret, group_context },            │
│    ),                                                        │
│    secrets: [                                                │
│      {                                                      │
│        node: leaf_index_of_new_member,                      │
│        encrypted_secret: HPKE(                             │
│          pkR = leaf.spk,                                   │
│          skM = intermediate_node_key,                       │
│          info = serialize(group_context),                   │
│          psk = random                                       │
│        )                                                    │
│      }                                                      │
│    ]                                                        │
│  }                                                           │
│                                                              │
│  Recipient decrypts:                                         │
│  1. Find their leaf index in the tree                       │
│  2. Decrypt their path secret via HPKE                      │
│  3. Reconstruct tree secrets up to root                     │
│  4. Derive epoch secret                                     │
│  5. Derive group keys                                        │
│  6. Join the group                                           │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

---

## 5. Ratchet Tree — Structure & Operations

### 5.1 Binary Tree Structure

MLS uses a left-balanced binary tree where leaf nodes hold device key packages and interior nodes hold encrypted intermediate secrets.

```
                        ┌─────────────┐
                        │ Root Secret  │
                        └──────┬──────┘
                               │
                   ┌───────────┴───────────┐
                   │                       │
            ┌──────┴──────┐          ┌─────┴──────┐
            │ Node Secret │          │ Node Secret │
            │ (encrypted) │          │ (encrypted) │
            └──────┬──────┘          └──────┬──────┘
                   │                        │
           ┌───────┴───────┐         ┌──────┴──────┐
           │               │         │             │
     ┌─────┴─────┐   ┌────┴────┐  ┌┴───────┐ ┌───┴─────┐
     │  Leaf 0   │   │  Leaf 1 │  │ Leaf 2 │ │  Leaf 3 │
     │  (Alice)  │   │  (Bob)  │  │(Carol) │ │  (Dan)  │
     │  IK, SPK  │   │  IK,SPK │  │ IK,SPK│ │  IK,SPK│
     └───────────┘   └─────────┘  └────────┘ └─────────┘
```

### 5.2 Leaf Node Structure

```typescript
interface LeafNode {
  // Identity
  ik: Ed25519PublicKey;          // Identity key
  device_id: string;             // Device identifier
  user_id: string;               // User identifier

  // Key package
  spk: X25519PublicKey;          // Signed prekey

  // Capabilities
  capabilities: string[];        // Protocol versions

  // Signature
  signature: Ed25519Signature;   // Signs (ik, spk, capabilities)
}
```

### 5.3 Tree Operations

```
┌──────────────────────────────────────────────────────────────┐
│                    TREE OPERATIONS                             │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  ADD (member joins channel):                                │
│  1. Sender creates Proposal{Add: new_leaf}                  │
│  2. Add next available leaf slot                             │
│  3. Generate new path secret for the leaf                   │
│  4. Encrypt path secret up the tree (right-to-left)        │
│  5. Commit includes the new path                            │
│  6. New member receives Welcome message                      │
│                                                              │
│  REMOVE (member leaves/is removed):                         │
│  1. Sender creates Proposal{Remove: leaf_index}             │
│  2. Blank the leaf (set to "empty")                         │
│  3. Generate new path secret for sender's leaf              │
│  4. Encrypt path secret up the tree                         │
│  5. Commit includes the removal                             │
│  6. Removed member can no longer decrypt                    │
│                                                              │
│  UPDATE (member refreshes their keys):                      │
│  1. Member generates new SPK                                │
│  2. Creates Proposal{Update: new_leaf_node}                 │
│  3. Encrypts new path secret up the tree                    │
│  4. Commit includes the update                              │
│  5. All other members re-derive tree secrets                │
│                                                              │
│  COMMIT (apply pending proposals):                          │
│  1. Collect all pending proposals                           │
│  2. Apply in order (Add, Remove, Update)                    │
│  3. Compute new tree root                                   │
│  4. Derive new epoch secret from root                       │
│  5. Sign and broadcast commit                               │
│  6. All members advance to new epoch                        │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### 5.4 Tree Derivation

```
Leaf Secret → Node Secrets → Root Secret → Epoch Secret → Group Keys

Each interior node secret:
  parent_secret = HKDF-Expand-Label(
    secret = left_child_secret || right_child_secret,
    label = "tree",
    context = serialize(parent_node),
    length = 32
  )

Root secret:
  group_epoch_secret = Derive-Secret(
    root_secret,
    label = "epoch",
    context = group_context
  )
```

---

## 6. Membership Changes — Channel Permissions ↔ MLS

### 6.1 Permission Model

Vault2E channel roles map to MLS group operations:

```
┌──────────────────────────────────────────────────────────────┐
│              ROLE → MLS OPERATION MAPPING                      │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  Channel Owner (admin):                                     │
│    ✓ Add members (Proposal + Commit)                        │
│    ✓ Remove members (Proposal + Commit)                     │
│    ✓ Update own keys                                        │
│    ✓ Delete channel (wipe group state)                      │
│    ✓ Transfer ownership                                     │
│                                                              │
│  Channel Admin:                                             │
│    ✓ Add members (Proposal + Commit)                        │
│    ✓ Remove members below their level                       │
│    ✓ Update own keys                                        │
│                                                              │
│  Channel Member:                                            │
│    ✓ Update own keys                                        │
│    ✗ Cannot add/remove others                               │
│                                                              │
│  Channel Viewer (announcement channels):                    │
│    ✗ Cannot update keys (read-only)                         │
│    ✗ Cannot propose operations                              │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### 6.2 Permission Enforcement

```
// Server-side permission check before committing
function canPerformOperation(
  sender_role: ChannelRole,
  operation: MLSOperation
): boolean {
  const permissions: Record<ChannelRole, MLSOperation[]> = {
    owner:   ['add', 'remove', 'update', 'delete', 'transfer'],
    admin:   ['add', 'remove', 'update'],
    member:  ['update'],
    viewer:  [],
  };
  return permissions[sender_role]?.includes(operation) ?? false;
}

// MLS commit validation
function validateCommit(commit: MLSCommit, sender: User): boolean {
  // 1. Verify signature with sender's IK
  // 2. Check all proposals match sender's permissions
  // 3. Server canonicalizes order (prevents split-brain)
  // 4. Apply to group state
  // 5. Broadcast to all group members
}
```

### 6.3 Member Removal Protocol

```
┌──────────────────────────────────────────────────────────────┐
│              MEMBER REMOVAL PROTOCOL                          │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  1. Admin proposes Remove{leaf_index_of_target}             │
│                                                              │
│  2. Server validates:                                        │
│     - Admin has remove permission                           │
│     - Target is not owner                                   │
│                                                              │
│  3. Server creates Commit:                                   │
│     - Applies Remove proposal                               │
│     - Sender generates new path secret                      │
│     - Tree root updated                                     │
│     - New epoch secret derived                              │
│     - Commit signed by admin's IK                           │
│                                                              │
│  4. Server broadcasts Commit to all remaining members       │
│                                                              │
│  5. Each member:                                             │
│     - Verifies admin signature                              │
│     - Applies Commit to local tree                          │
│     - Derives new epoch secret                              │
│     - Derives new group encryption keys                     │
│                                                              │
│  6. Removed member:                                          │
│     - Cannot decrypt Commit (new keys)                      │
│     - Cannot decrypt future messages                        │
│     - Can still decrypt messages from previous epochs       │
│     - Their KeyPackage is marked as consumed                │
│                                                              │
│  7. Server deletes removed member's KeyPackage              │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

---

## 7. Device Model — First-Class Device Identity

### 7.1 Device as MLS Leaf

Every device is a first-class leaf in the MLS ratchet tree. This is the core of per-device isolation.

```
┌──────────────────────────────────────────────────────────────┐
│              DEVICE → MLS MAPPING                              │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  Vault2E Device                                              │
│  ├── device_id: "dev_a1b2c3d4"                             │
│  ├── user_id: "usr_alice"                                  │
│  ├── IK: Ed25519 keypair (identity)                         │
│  ├── SPK: X25519 keypair (signed prekey)                   │
│  └── MLS Leaf Node:                                         │
│       ├── leaf_index: 0 (assigned by tree position)         │
│       ├── ik: IK public                                    │
│       ├── spk: SPK public                                  │
│       └── signature: Ed25519(IK_priv, leaf_content)        │
│                                                              │
│  Benefits:                                                   │
│  - Compromising one device doesn't affect others            │
│  - Device can be removed without affecting user's other     │
│    devices                                                   │
│  - Each device has its own ratchet chain in the tree        │
│  - Revocation is per-device, not per-user                   │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### 7.2 Multi-Device User

A single user with 3 devices in a 10-member channel:

```
Channel (10 members, 15 devices total):

  Leaf 0: Alice-device_a   (user: alice)
  Leaf 1: Alice-device_b   (user: alice)
  Leaf 2: Alice-device_c   (user: alice)
  Leaf 3: Bob-device_a     (user: bob)
  Leaf 4: Bob-device_b     (user: bob)
  Leaf 5: Carol-device_a   (user: carol)
  Leaf 6: Dan-device_a     (user: dan)
  Leaf 7: Eve-device_a     (user: eve)
  Leaf 8: Frank-device_a   (user: frank)
  Leaf 9: Grace-device_a   (user: grace)

  Alice's devices are independent leaves.
  Removing Alice-device_a doesn't affect Alice-device_b or Alice-device_c.
  Alice must be removed from ALL devices to be fully removed from channel.
```

### 7.3 Device Removal vs User Removal

```
┌──────────────────────────────────────────────────────────────┐
│         DEVICE REMOVAL vs USER REMOVAL                        │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  Device Removal (single device compromised):                │
│  1. User or admin proposes Remove{leaf_index}               │
│  2. Only that device's leaf is blanked                      │
│  3. User's other devices remain in group                    │
│  4. Compromised device loses access immediately             │
│                                                              │
│  User Removal (leaving org/channel):                        │
│  1. Admin proposes Remove{leaf_index} for ALL user's       │
│     devices                                                  │
│  2. Each device leaf is blanked                             │
│  3. User completely removed from channel                    │
│  4. All user's devices lose access                          │
│                                                              │
│  Implementation:                                             │
│  - Server knows device→user mapping                        │
│  - Remove{leaf} targets a specific leaf                    │
│  - User removal = batch Remove for all user's leaves        │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

---

## 8. Forward Secrecy — Epoch-Based Key Derivation

### 8.1 Epoch Key Hierarchy

```
┌──────────────────────────────────────────────────────────────┐
│              EPOCH KEY HIERARCHY                               │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  Tree Root Secret (from ratchet tree)                       │
│       │                                                      │
│       ▼                                                      │
│  HKDF-Expand-Label(TreeRoot, "epoch", group_id‖epoch)       │
│       │                                                      │
│       ▼                                                      │
│  Epoch Secret (ES)                                           │
│       │                                                      │
│       ├─→ Derive-Secret(ES, "enc", ...) → EncKey            │
│       │    (AES-256-GCM key for message encryption)          │
│       │                                                      │
│       ├─→ Derive-Secret(ES, "mic", ...) → MICKey            │
│       │    (Message authentication key)                      │
│       │                                                      │
│       ├─→ Derive-Secret(ES, "iv", ...) → IVBase             │
│       │    (IV derivation base)                              │
│       │                                                      │
│       └─→ Derive-Secret(ES, "cons", ...) → ConfirmKey       │
│            (Commit confirmation MAC key)                     │
│                                                              │
│  Forward Secrecy Property:                                   │
│  Compromising Epoch N does NOT expose Epoch N-1 keys        │
│  because epoch secrets are derived from tree secrets,        │
│  not from previous epoch secrets.                            │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### 8.2 Message Encryption Per Epoch

```
// Encryption
EncKey = DeriveSecret(EpochSecret, "enc", ...)
IV = DeriveSecret(EpochSecret, "iv", ...) || message_counter

ciphertext = AES-256-GCM(
  key = EncKey,
  iv = IV,
  plaintext = message,
  aad = group_id ‖ epoch ‖ sender_leaf_index ‖ message_counter
)

// Decryption
Verify:
  1. epoch in message matches current group epoch
  2. message_counter not in seen_messages set
  3. AES-GCM tag verification (tamper detection)
  4. AAD binding (sender, epoch, counter)
```

---

## 9. Post-Compromise Security — Key Updates

### 9.1 Key Update as Self-Healing

After a device compromise, the compromised device (or any admin) triggers a key update that heals the session.

```
┌──────────────────────────────────────────────────────────────┐
│              POST-COMPROMISE KEY UPDATE                        │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  Scenario: Alice-device_a is compromised                    │
│                                                              │
│  1. Alice detects compromise (or is notified)               │
│                                                              │
│  2. Alice triggers key update on device_b:                  │
│     - Generate new SPK for device_b                         │
│     - Create Update proposal                                │
│     - Generate new path secret for device_b's leaf          │
│     - Encrypt path secret up the tree                       │
│                                                              │
│  3. Server processes Commit:                                │
│     - Applies Update to device_b's leaf                    │
│     - New tree root                                         │
│     - New epoch secret                                      │
│     - All group keys rotated                                │
│                                                              │
│  4. Compromised device_a:                                   │
│     - Still has old epoch secret                            │
│     - Can decrypt messages from old epoch                   │
│     - CANNOT decrypt messages from new epoch                │
│     - Session has "healed"                                  │
│                                                              │
│  5. If device_a is also compromised at the key level:       │
│     - Alice removes device_a via Remove proposal           │
│     - Server deletes device_a's leaf                       │
│     - New epoch, new keys                                   │
│     - device_a is fully locked out                          │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### 9.2 Key Update Timing

| Trigger | Action | Result |
|---------|--------|--------|
| Compromise detected | Immediate Update | Heal session |
| Periodic maintenance | Every 24 hours | Proactive forward secrecy |
| Member added | Add commits new epoch | New epoch for all |
| Member removed | Remove commits new epoch | New epoch, removed member loses access |
| Device rekey | Update proposal | New leaf, new epoch |

---

## 10. Offline Members

### 10.1 Offline Message Reception

MLS handles offline members through epoch-based keying. Messages are encrypted with the current epoch key. Offline members who haven't received the latest epoch cannot decrypt messages until they sync.

```
┌──────────────────────────────────────────────────────────────┐
│              OFFLINE MEMBER HANDLING                           │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  Timeline:                                                   │
│  ─────────                                                   │
│  t0: Alice online, epoch 5, can decrypt                    │
│  t1: Alice goes offline                                     │
│  t2: Bob adds Carol → epoch 6 (new keys)                   │
│  t3: Bob sends message (encrypted with epoch 6 key)        │
│  t4: Alice comes back online                                │
│                                                              │
│  Alice's recovery:                                           │
│  1. Alice reconnects                                        │
│  2. Server sends pending Commits since Alice's last epoch   │
│  3. Alice processes Commit (add Carol)                     │
│  4. Alice derives epoch 6 secret                           │
│  5. Alice can now decrypt messages from epoch 6            │
│                                                              │
│  If Alice missed multiple epochs:                           │
│  1. Server sends all pending Commits in order              │
│  2. Alice processes each Commit sequentially               │
│  3. Each Commit advances Alice's epoch                     │
│  4. Alice derives current epoch secret                     │
│  5. Alice can decrypt current and future messages          │
│                                                              │
│  Messages encrypted with intermediate epochs:               │
│  - Alice stores encrypted messages locally                 │
│  - When Alice processes the Commit that created that epoch │
│  - She derives the epoch key and decrypts stored messages  │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### 10.2 Store-and-Forward for Offline Members

```
  Online Member A         Server               Offline Member B
  ────────────────        ──────               ────────────────
  Send message(epoch 5)  Store ciphertext     (offline)
                          │
  Commit: Add Carol      Store commit         (offline)
  (epoch 6)              │
                          │
  Send message(epoch 6)  Store ciphertext     (offline)
                          │
                          │         ─────────── B comes online
                          │         Fetch pending commits
                          │         ←──────────
                          │         Process commits (epoch 5→6)
                          │         Derive epoch 6 key
                          │         Fetch pending messages
                          │         ←──────────
                          │         Decrypt messages ✓
```

---

## 11. Server Role — What It Knows / Can't See

### 11.1 Server Responsibilities

```
┌──────────────────────────────────────────────────────────────┐
│                    MLS SERVER ROLE                             │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  ✓ RESPONSIBILITIES:                                         │
│  ──────────────────                                          │
│  1. Store KeyPackages (per device)                          │
│  2. Store group state (ratchet tree, epoch)                 │
│  3. Store pending Commits for offline members               │
│  4. Store encrypted messages per epoch                      │
│  5. Order commits (prevent split-brain)                     │
│  6. Validate commit signatures                              │
│  7. Enforce permission checks before commits               │
│  8. Deliver Welcome messages to new members                 │
│  9. Manage epoch transitions                                │
│                                                              │
│  ✗ CANNOT:                                                   │
│  ─────────                                                   │
│  1. Read message plaintext                                  │
│  2. Derive epoch secrets (no tree secret access)            │
│  3. Decrypt messages                                        │
│  4. Forge commits (no signing keys)                         │
│  5. Add members without a valid proposal                    │
│  6. Read KeyPackage contents (only stores opaque blobs)     │
│                                                              │
│  ⚠ KNOWS (metadata):                                        │
│  ─────────────────                                           │
│  1. Which users are in which channels                       │
│  2. When commits occur (timestamps)                         │
│  3. Message sizes (ciphertext length)                       │
│  4. Online/offline status                                   │
│  5. Device count per user                                   │
│  6. Epoch progression rate                                  │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### 11.2 Server-Side Storage

```
┌──────────────────────────────────────────────────────────────┐
│              MLS SERVER STORAGE                                │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  Table: mls_groups                                           │
│  ┌──────────────────────────────────────────┐               │
│  │ group_id        : TEXT (PK, = channel_id)│               │
│  │ epoch           : BIGINT                  │               │
│  │ ratchet_tree    : BYTEA (serialized)     │               │
│  │ group_context   : BYTEA (serialized)     │               │
│  │ tree_hash       : BYTEA                  │               │
│  │ confirmed_transcript_hash : BYTEA        │               │
│  └──────────────────────────────────────────┘               │
│                                                              │
│  Table: mls_key_packages                                     │
│  ┌──────────────────────────────────────────┐               │
│  │ device_id       : TEXT (PK)              │               │
│  │ user_id         : TEXT                    │               │
│  │ key_package     : BYTEA (serialized)     │               │
│  │ is_consumed     : BOOLEAN DEFAULT FALSE  │               │
│  │ created_at      : BIGINT                 │               │
│  │ expires_at      : BIGINT                 │               │
│  └──────────────────────────────────────────┘               │
│                                                              │
│  Table: mls_commits                                          │
│  ┌──────────────────────────────────────────┐               │
│  │ group_id        : TEXT                   │               │
│  │ epoch           : BIGINT                 │               │
│  │ commit          : BYTEA (serialized)     │               │
│  │ sender_device   : TEXT                   │               │
│  │ created_at      : BIGINT                 │               │
│  │ PRIMARY KEY (group_id, epoch)            │               │
│  └──────────────────────────────────────────┘               │
│                                                              │
│  Table: mls_welcome_messages                                 │
│  ┌──────────────────────────────────────────┐               │
│  │ welcome_id      : TEXT (PK)              │               │
│  │ group_id        : TEXT                   │               │
│  │ epoch           : BIGINT                 │               │
│  │ welcome         : BYTEA (serialized)     │               │
│  │ target_device   : TEXT                   │               │
│  │ is_delivered    : BOOLEAN DEFAULT FALSE  │               │
│  └──────────────────────────────────────────┘               │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

---

## 12. State Persistence & Crash Recovery

### 12.1 Client-Side State

```
┌──────────────────────────────────────────────────────────────┐
│              CLIENT MLS STATE (Dexie IndexedDB)                │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  Table: mlsGroups                                            │
│  ┌──────────────────────────────────────────┐               │
│  │ group_id        : string (PK)            │               │
│  │ epoch           : number                  │               │
│  │ group_context   : string (serialized)    │               │
│  │ tree_secret     : string (Base64)        │               │
│  │ epoch_secret    : string (Base64)        │               │
│  │ enc_key         : string (Base64)        │               │
│  │ mic_key         : string (Base64)        │               │
│  │ my_leaf_index   : number                  │               │
│  │ my_path_secret  : string (Base64)        │               │
│  │ tree_hash       : string (Base64)        │               │
│  │ confirmed_hash  : string (Base64)        │               │
│  └──────────────────────────────────────────┘               │
│                                                              │
│  Table: mlsPendingCommits                                    │
│  ┌──────────────────────────────────────────┐               │
│  │ group_id        : string (PK)            │               │
│  │ epoch           : number (PK)            │               │
│  │ commit          : string (serialized)    │               │
│  │ applied         : boolean                 │               │
│  └──────────────────────────────────────────┘               │
│                                                              │
│  Table: mlsSkippedKeys                                       │
│  ┌──────────────────────────────────────────┐               │
│  │ group_id        : string (PK)            │               │
│  │ sender_index    : number (PK)            │               │
│  │ message_number  : number (PK)            │               │
│  │ message_key     : string (Base64)        │               │
│  │ created_at      : number                  │               │
│  └──────────────────────────────────────────┘               │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### 12.2 Crash Recovery State Machine

```
┌──────────────────────────────────────────────────────────────┐
│              CRASH RECOVERY STATES                             │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────┐                                                │
│  │  START    │                                               │
│  └────┬─────┘                                                │
│       │                                                      │
│       ▼                                                      │
│  ┌──────────────────┐                                        │
│  │ LOAD_FROM_DEXIE   │ ← Read persisted group state          │
│  └────────┬─────────┘                                        │
│           │                                                  │
│           ▼                                                  │
│  ┌──────────────────┐                                        │
│  │ VALIDATE_STATE    │ ← Verify tree_hash, epoch consistency │
│  └────────┬─────────┘                                        │
│           │                                                  │
│     ┌─────┴─────┐                                           │
│     │           │                                            │
│  [valid]    [invalid]                                        │
│     │           │                                            │
│     │           ▼                                            │
│     │  ┌──────────────────┐                                  │
│     │  │ REQUEST_FULL_SYNC │ ← Fetch latest group state      │
│     │  └────────┬─────────┘   from server                    │
│     │           │                                            │
│     │           ▼                                            │
│     │  ┌──────────────────┐                                  │
│     │  │ PROCESS_PENDING   │ ← Apply any missed commits      │
│     │  │ COMMITS           │                                  │
│     │  └────────┬─────────┘                                  │
│     │           │                                            │
│     └─────┬─────┘                                           │
│           │                                                  │
│           ▼                                                  │
│  ┌──────────────────┐                                        │
│  │ READY             │ ← Session active, can send/receive    │
│  └──────────────────┘                                        │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### 12.3 Atomic Commit Application

```typescript
async function applyCommitAtomic(
  groupId: string,
  commit: MLSCommit,
  newGroupState: MLSGroupState
): Promise<void> {
  // Single Dexie transaction ensures atomicity
  await db.transaction(
    'rw',
    db.mlsGroups,
    db.mlsPendingCommits,
    db.mlsSkippedKeys,
    async () => {
      // 1. Update group state (epoch, keys, tree)
      await db.mlsGroups.put({
        group_id: groupId,
        ...newGroupState
      });

      // 2. Mark commit as applied
      await db.mlsPendingCommits.update(
        [groupId, commit.epoch],
        { applied: true }
      );

      // 3. Clear old skipped keys (optional, based on policy)
      // ...
    }
  );
  // If any step fails, entire transaction rolls back
  // Client can retry from LOAD_FROM_DEXIE state
}
```

---

## 13. Migration — Current AES Distribution to MLS

### 13.1 Migration Strategy

```
┌──────────────────────────────────────────────────────────────┐
│                    MLS MIGRATION PHASES                        │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  Phase 0: Preparation (current)                             │
│  ──────────────────────────────                              │
│  - AES key per channel, ECDH envelope distribution          │
│  - Creator-managed key lifecycle                            │
│                                                              │
│  Phase 1: Parallel Operation                                │
│  ────────────────────────────                                │
│  - Add MLS endpoints alongside existing endpoints           │
│  - New channels use MLS by default                          │
│  - Existing channels can opt-in via migration button        │
│  - Server stores both AES keys and MLS group state          │
│  - Clients check channel.crypto_version to decide           │
│                                                              │
│  Phase 2: Automatic Migration                               │
│  ─────────────────────────────                               │
│  - On channel open, if channel is old format:               │
│    1. Create MLS group from current members                 │
│    2. Distribute Welcome to all online members              │
│    3. For offline members, queue Welcome messages           │
│  - Old AES keys are deleted after all members migrate      │
│                                                              │
│  Phase 3: Deprecation                                       │
│  ────────────────────                                        │
│  - Remove AES key distribution code                         │
│  - Remove channel_keys table                                │
│  - All channels use MLS                                     │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### 13.2 Channel Migration Protocol

```
┌──────────────────────────────────────────────────────────────┐
│              CHANNEL MIGRATION PROTOCOL                        │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  1. Admin clicks "Migrate to MLS" in channel settings       │
│                                                              │
│  2. Server creates MLS group:                               │
│     - group_id = channel_id (same identifier)               │
│     - Add all current members as initial leaves             │
│     - Compute initial ratchet tree                          │
│     - Derive epoch 0 secret                                 │
│                                                              │
│  3. Server broadcasts channel:migrate event                 │
│                                                              │
│  4. Online clients:                                         │
│     - Receive Welcome message                               │
│     - Import MLS group state                                │
│     - Start using MLS for encryption                        │
│                                                              │
│  5. Offline clients:                                        │
│     - On reconnect, receive pending Welcome                 │
│     - Import MLS group state                                │
│     - Decrypt old messages with AES key (if still needed)  │
│     - Decrypt new messages with MLS epoch key               │
│                                                              │
│  6. After all members migrated:                             │
│     - Server deletes channel_keys entries                   │
│     - channel.crypto_version set to "mls_v1"               │
│     - Old AES key material purged                           │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### 13.3 Backward Compatibility During Migration

```
┌──────────────────────────────────────────────────────────────┐
│              DURING MIGRATION                                 │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  New client → New channel: MLS (default)                    │
│  New client → Old channel: Try MLS, fall back to AES        │
│  Old client → Any channel: AES only (can't use MLS)        │
│                                                              │
│  Server-side routing:                                        │
│  if (channel.crypto_version === "mls_v1") {                │
│    encrypt_with_mls(channel_id, plaintext)                  │
│  } else {                                                   │
│    encrypt_with_aes(channel_id, plaintext)                  │
│  }                                                           │
│                                                              │
│  During transition, server stores both:                      │
│  - channel_keys table (old AES envelopes)                   │
│  - mls_groups table (new MLS group state)                   │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

---

## 14. Security Properties Summary

| Property | Current (AES ECDH) | After (MLS) |
|----------|--------------------| ------------|
| Forward Secrecy | None (same key until rotation) | Epoch-based, per-epoch keys |
| Post-Compromise Security | Manual rotation | Key updates heal session |
| Membership Scalability | O(m) per rotation | O(log m) tree operations |
| Asynchronous Join | No (creator must be online) | Yes (Welcome messages) |
| Partial Revocation | No (single key = full access) | Yes (per-leaf removal) |
| Server Trust | Server distributes keys | Server orders commits only |
| Split-Brain Prevention | None | Server canonicalizes commits |
| Offline Message Delivery | Not supported | Epoch key stored, synced on reconnect |
| Per-Device Isolation | No | Yes (each device = leaf) |

---

## 15. Library Dependencies

| Purpose | Library | Notes |
|---------|---------|-------|
| MLS Core | `openmls` (Rust) or `mls-rs` | IETF reference implementation |
| MLS JS Bindings | `@aspect-build/mls-wasm` or custom WASM | Browser-compatible |
| Ed25519 | `@noble/ed25519` | Identity key signing |
| X25519 | `@noble/curve25519` | Key agreement in tree |
| HKDF | `@noble/hashes` | Key derivation |
| HPKE | Custom on top of X25519 | For Welcome message encryption |
| AES-GCM | WebCrypto API | Message encryption |

**Alternative:** If `openmls` WASM is too heavy (~500KB), implement a minimal MLS subset:
- Ratchet tree operations
- Key schedule
- Commit validation
- Skip group operations (PSK, ExternalJoin) for v1
