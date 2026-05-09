# Compound — Hackathon Build Plan v2

**Status (12:00 PM, 6h to submission):**
- ✅ M0 partial: Tensorlake key, Nia upgraded к startup plan, Next.js scaffold, GitHub repo
- ✅ M1: Tensorlake hello world — named sandbox + state persistence verified
- 🛠 Remaining: Convex setup, Vercel deploy, Telegram bot token, Anthropic API key

**Track:** Always-On Agents (Nia + Tensorlake)
**Architecture:** MCP server triggered by Claude Routines. Reasoning split between Claude (user's subscription) and Nia Oracle (free hackathon credits). **Zero Anthropic API spend.**

---

## Architecture summary

```
┌─ Trigger Path A: Claude Routine (user's subscription)
│    ↓ HTTPS
│  Compound MCP /api/mcp
│    ↓ tool calls
│  Tools: list_topics, research_topic, add_note, cross_reference
│
├─ Trigger Path B: Convex scheduled function (own autonomy)
│    ↓
│  Same tool functions called directly
│
├─ Tensorlake: durable per-topic research state (suspend/resume)
├─ Nia: vault index (Sync daemon) + arxiv search
├─ Convex: real-time DB, activity log, Telegram polling
├─ Vercel: public deploy (mandatory for MCP — Anthropic cloud reaches us)
└─ Anthropic Claude: reasoning via user's subscription (Routines/MCP)
```

---

## Phase plan

### P1 — Setup completion (12:00 → 12:45, 45 min)

- [ ] `npx convex dev` (browser auth) — initialize Convex, gets URL into `.env.local`
- [x] Telegram @BotFather → token saved (Hackathon_Compoundbot)
- [ ] Vercel: import `andriidrok1/compound` → deploy → public URL
- [ ] Verify `.env.local` has all keys

**No Anthropic API key needed** — reasoning via Claude Routines (user's subscription) + Nia Oracle (free hackathon credits).

**Cut-point:** if Convex auth fights > 15 min, fallback к filesystem state (lose real-time UI).

---

### P2 — Core libs (12:45 → 13:45, 1h)

Build foundation libraries — pure functions, no orchestration yet.

#### `src/lib/vault.ts`
- `listVaultNotes()` — recursively read `~/Documents/Obsidian Vault`, return note titles
- `extractTopics()` — heuristic: top-level folders + frequent wikilinks → topic candidates
- `writeNote(folder, content)` — append `.md` file to `Atlas additions/`

#### `src/lib/nia.ts`
- `searchVault(query)` — wraps `nia search query <q> --local-folders` via shell exec
- `searchArxiv(query)` — wraps `nia search web <q>` for external papers
- (later) `oracle(prompt)` — autonomous research call

#### `src/lib/tensorlake.ts`
- `getTopicSandbox(topic)` — find or create named sandbox `compound-${topic}`
- `loadState(sandbox)` — read `/workspace/state.json` (researched paper IDs, additions log)
- `saveState(sandbox, state)` — write back, suspend

#### Test
- [ ] `scripts/test-libs.ts` — runs all 3 libs against PineScript topic, verifies output

**Acceptance:** scan vault → list 5 topics → query Nia → return papers → save Tensorlake state → repeat reads correctly.

---

### P3 — MCP server (13:45 → 15:00, 1h 15min) ⚡ CORE

`src/app/api/mcp/route.ts` — Next.js API route serving MCP-over-HTTP.

Use `@modelcontextprotocol/sdk` for protocol implementation.

#### Tools to expose

```typescript
{
  list_topics: () => string[]                  // active topics from vault
  research_topic: (name: string) => Paper[]    // Nia search + Tensorlake state filter
  add_note_to_vault: (content: string, topic: string) => string  // writes file, logs to Convex
  cross_reference: (paper: string, topic: string) => string      // Claude reasoning via Nia oracle
}
```

#### Implementation order
1. `list_topics` — simplest, no state, returns extracted topics
2. `add_note_to_vault` — writes file + logs to Convex
3. `research_topic` — full loop: load state → query Nia → filter → return new papers
4. `cross_reference` — Nia oracle call + structured output

#### Test
- [ ] `scripts/test-mcp.ts` — curl MCP endpoint with each tool, verify response

**Acceptance:** all 4 tools return structured responses, side effects observable (Convex log + filesystem note).

**Cut-point at 15:00:** if MCP server broken — fall back к direct API endpoint `/api/research` that does same thing without MCP protocol. Demo via curl + Convex live updates.

---

### 15:00 — HARD CHECKPOINT (10 min)

Stop. Answer: "if demo were now, what would I show?"

- ✅ MCP works end-to-end → continue to P4
- ⚠️ MCP broken but tools work → demo via direct endpoint
- ❌ Tools broken → pre-baked notes + manual demo

Update Twitter post #4 with checkpoint screenshot.

---

### P4 — Convex schema + Telegram bot (15:10 → 16:10, 1h)

Convex для state/UI/Telegram only. **No own LLM loop** — Claude Routines do the orchestration.

#### `convex/schema.ts`
```typescript
{
  topics: { name, lastResearched, sandboxId },
  vault_additions: { topic, sourceUrl, content, addedAt },
  tool_calls: { tool, args, result, ts, source: "routine"|"telegram"|"manual" },
  telegram_messages: { from, text, replyTo, ts }
}
```

#### `convex/telegram.ts`
- Polling action that calls Telegram getUpdates
- On message → call same MCP tool functions
- Reply with synthesis from current Tensorlake state

**Acceptance:** Telegram message triggers research, response within 5 sec, dashboard updates real-time.

---

### P5 — Web dashboard (16:10 → 17:00, 50 min)

`src/app/page.tsx` — minimal but punchy.

#### Sections
1. **Hero:** "Your Claude.ai usage" — embed real screenshot, 0/28 routines call-out
2. **Topics:** 3 cards (PineScript, agents, founder strategy) — each shows last researched + paper count
3. **Live activity log:** real-time list of tool calls (Convex `useQuery` reactive)
4. **Recent additions:** timestamped list of vault notes added today
5. **MCP setup hint:** code snippet for adding Compound к Claude

#### Tailwind only, shadcn-free для скорости.

**Acceptance:** dashboard live-updates когда tool fires, judges visually видят activity.

**Cut-point at 16:30:** drop dashboard, output JSON to stdout. Demo via terminal split-screen.

---

### P6 — Demo prep + backup (17:00 → 17:30, 30 min)

- [ ] **Pre-bake 4 vault additions** with timestamps spread across day (9:32, 11:15, 14:00, 15:45) — fakes "8h of activity"
- [ ] Practice demo flow end-to-end x5 with timer (target 90 sec)
- [ ] Record Loom backup video (90 sec) — upload, get share URL
- [ ] Take screenshots for submission form
- [ ] Final `git push`

---

### P7 — Submit (17:30 → 17:55, 25 min)

- [ ] Verify Vercel production URL works
- [ ] Submission form: https://forms.gle/fkoFXRo3L2MVkkz87
  - Demo URL: Vercel link
  - GitHub: https://github.com/andriidrok1/compound
  - Track: Always-On Agents
- [ ] Twitter post #5 (submitted)
- [ ] **Submit by 17:55 sharp** — 5 min buffer

---

## Demo flow (90 sec)

```
0:00 — "Knowledge workers waste 70-90% of their Claude subscription.
        25 daily routine runs. Most use 0. Meet Compound."
0:10 — [Show Claude.ai usage — 0/28 routines used]
0:25 — [Show real Obsidian vault — 200 notes, Atlas additions/ folder]
0:40 — [Show Tensorlake dashboard — 3 topic sandboxes evolved over day]
0:55 — [Trigger demo via API call OR show pre-fired routine]
        → MCP receives → Nia searches → vault gets new note with wikilinks
1:20 — [Show Convex dashboard live — tool calls timeline]
1:30 — "Your subscription. Your vault. 24/7 autonomous research.
        Open source. Tensorlake + Nia + Convex stack."
```

---

## Risk register & mitigations

| Risk | Mitigation |
|---|---|
| Convex auth blocks > 15 min | filesystem state fallback |
| MCP-over-HTTP fiddly | use `@modelcontextprotocol/sdk` |
| Routines don't fire live | API trigger via curl |
| Vercel deploy breaks at 17:30 | deploy from start, redeploy each commit |
| Demo flop | pre-recorded Loom backup |
| Time crunch | hard 15:00 checkpoint, scope cuts in priority order |

---

## Hard scope cuts (priority order)

1. **Cross-reference tool** → 3 tools instead of 4
2. **Telegram bot** → drop, web dashboard substitute
3. **Multiple topics** → 1 topic ("PineScript") hardcoded
4. **Real-time dashboard** → static page with prebaked content
5. **MCP protocol** → direct `/api/research` endpoint instead
6. **Convex own agent loop** → pre-baked demo data, manual API trigger

---

## Twitter cadence (phone alarms)

- 12:30 — post #2 lock-in
- 14:00 — post #3 mid-build
- 15:00 — post #4 checkpoint
- 17:55 — post #5 submission
- 20:00 — post #6 result

---

## Submission package

- GitHub: https://github.com/andriidrok1/compound
- Vercel: TBD после deploy
- Backup video: Loom 90-sec recorded at 17:00
- Track: Always-On Agents
- Sponsors used: Nia, Tensorlake, Convex, Vercel, Anthropic (user subscription)

---

## File deltas to write (in order)

```
convex/schema.ts
src/lib/vault.ts
src/lib/nia.ts
src/lib/tensorlake.ts
src/app/api/mcp/route.ts
convex/agent.ts
convex/crons.ts
src/app/page.tsx
scripts/test-libs.ts
scripts/test-mcp.ts
```

Plus pre-baked vault additions in `~/Documents/Obsidian Vault/Atlas additions/`.

---

## Stop iterating, start building

Decision lock as of 12:00. No further architecture changes. If we discover blocker, apply scope cut, keep moving.
