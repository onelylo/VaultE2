# Vault2E Phase N — [Phase Name]

## Subagent Routing
| Task | Subagent |
|---|---|
| [task description] | [crypto\|api\|ui\|socket\|build] |
| ... | ... |

**Subagent Keywords:**
- `crypto` → security-reviewer (mimo-v2.5-pro) — keys, rotation, ECDH, TOFU, MITM, encrypt, decrypt, sign
- `api` → code-reviewer (mimo-v2.5-pro) — REST, socket handlers, Dexie, IndexedDB, admin
- `ui` → general (nemotron-3.5-lightning) — React, hooks, components, Sidebar, ChatArea, state
- `socket` → general (nemotron-3.5-lightning) — channel, presence, join, key_request, typing
- `build` → build-error-resolver (mimo-v2.5-free) — typecheck, lint, TS errors

---

## Target: N tasks | Parallelization: [High/Medium/Low]

---

### Task 1: [Name]
- **Files**: 
- **Action**: 
- **Verify**: 

### Task 2: [Name]
- **Files**: 
- **Action**: 
- **Verify**: 

...

---

## Parallelization Guide
[Group tasks by dependency]

---

## Verification Gates
```bash
npm run typecheck
npm run lint
npm test
```

**Manual smoke test:**
- [ ] ...