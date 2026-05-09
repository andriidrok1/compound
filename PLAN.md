# Compound — Hackathon Build Plan

**Status:** at hackathon, 11:00 AM, ~6h to submission (18:00).
**Track:** Always-On Agents (Nia + Tensorlake).

## Milestone schedule

### M0 — Setup credentials (11:00 → 11:30, 30 min)

All in parallel where possible:

- [ ] `npx convex dev` (browser auth) → `.env.local` gets `NEXT_PUBLIC_CONVEX_URL`
- [ ] Sign up at tensorlake.ai → API key → `TENSORLAKE_API_KEY`
- [ ] Sign up at trynia.ai → API key → `NIA_API_KEY`
- [ ] Telegram @BotFather → `/newbot` → token → `TELEGRAM_BOT_TOKEN`
- [ ] Verify `ANTHROPIC_API_KEY` works (test curl)
- [ ] Vercel: import `andriidrok1/compound` → deploy → live URL

**Cut-point:** if Tensorlake signup blocks > 15 min, ping someone in Discord #tensorlake.

---

### M1 — Tensorlake "hello world" (11:30 → 12:30, 1h) ⚡ CRITICAL

Goal: prove named sandbox + save/retrieve state works end-to-end.

- [ ] `npm install @tensorlake/sdk` (or python sdk if needed)
- [ ] Create one named sandbox: `compound:test`
- [ ] Write file to sandbox: `state.json` with `{ "researched": [] }`
- [ ] Retrieve next call: confirm state persists
- [ ] Test snapshot (optional bonus)

**Cut-point:** if Tensorlake API fights > 1h → fallback to Convex-only state (lose Statefulness 25% rubric edge but still functional). Don't burn 2h here.

**12:00 — Hyperspell talk.** Sit, listen, code in parallel.

---

### M2 — Vault reader + Nia (12:30 → 13:30, 1h)

Eat lunch while coding.

- [ ] `src/lib/vault.ts` — read `~/Documents/Obsidian Vault`, parse markdown, extract titles + wikilinks via regex
- [ ] `src/lib/nia.ts` — wrap Nia MCP calls (search papers by topic)
- [ ] Convex schema: `topics`, `vault_notes`, `additions`, `sandbox_state`
- [ ] Test: scan vault → list topics from active notes
- [ ] Test: query Nia for "context retrieval" → get 5 papers

**Demo subset:** start with **5 vault notes + 1 topic** for end-to-end test. Scale after loop works.

---

### M3 — Agent loop (13:30 → 15:00, 1.5h) ⚡ CORE

The actual product.

- [ ] `convex/agent.ts` — internal action that:
  1. Pick a topic
  2. Load sandbox state (already-researched paper IDs)
  3. Query Nia for new papers in topic
  4. Filter out already-researched
  5. For each new paper → Claude call: "is this relevant to vault notes [X, Y, Z]? if yes, draft markdown note with `[[wikilinks]]` to existing notes; if no, return reason"
  6. If add: write `.md` file to vault folder `Atlas additions/`
  7. Update sandbox state
- [ ] `convex/crons.ts` — schedule agent every 5 min (for demo)
- [ ] Test: run loop manually, see new note appear in vault

**Cut-point at 15:00:** if loop doesn't work → demo on pre-baked notes (manually drop 4 "previously added" notes). Loop becomes "live demo trigger only", not autonomous.

---

### 15:00 — HARD CHECKPOINT

Stop. Ask: "if demo were now, what would I show?"

- ✅ Loop works → continue to M4
- ⚠️ Loop half-works → cut to "trigger-only demo", skip Telegram
- ❌ Loop broken → use pre-baked fixtures, polish demo flow

---

### M4 — Telegram bot + Web UI (15:00 → 16:30, 1.5h)

#### Telegram (45 min)
- [ ] `convex/telegram.ts` — long-poll Telegram getUpdates
- [ ] On message: route to agent.query() with vault context
- [ ] Reply with 5-sec response

#### Web dashboard (45 min)
- [ ] `src/app/page.tsx` — show:
  - 3 topic sandboxes visualization (cards)
  - Recent additions timeline
  - Live agent activity log
  - Claude usage hook ("$14 wasted this week")
- [ ] Tailwind, no fancy components — just clean

**Cut-point at 16:00:** if Telegram bot fights → drop Telegram entirely, web chat UI as substitute.

---

### M5 — Demo prep + backup (16:30 → 17:30, 1h)

- [ ] Pre-bake 4 "Atlas-added" notes in vault (timestamps spread across day to fake 8h activity)
- [ ] Practice demo flow end-to-end with timer (target 90 sec)
- [ ] Record Loom backup video (90 sec)
- [ ] Take screenshots for submission

---

### M6 — Submit (17:30 → 18:00, 30 min)

- [ ] `git push` final
- [ ] Verify Vercel production URL works
- [ ] Submission form: https://forms.gle/fkoFXRo3L2MVkkz87
  - Demo URL: Vercel link
  - GitHub: https://github.com/andriidrok1/compound
  - Name + email
- [ ] **Submit by 17:55 sharp** (5 min buffer)

---

## Twitter posts (set phone alarms)

- **11:30** — post #2 lock-in: "locked in. building Compound — autonomous Obsidian research agent. Tensorlake + Nia stack. shipping live"
- **13:00** — post #3 mid-build: screenshot of terminal/code
- **15:00** — post #4 checkpoint: UI screenshot
- **17:55** — post #5 submission: "submitted. live: [URL]" + 30-sec video
- **20:00** — post #6 result (win or learn)

---

## Hard scope cuts (in priority order, if behind schedule)

1. **Tensorlake snapshots/clones** → just basic save/retrieve state
2. **Nia integration depth** → use 5 hardcoded paper fixtures
3. **Telegram bot** → web chat UI substitute
4. **Web dashboard fanciness** → minimum: list of additions + topic cards
5. **Live agent loop** → pre-baked demo data, manual trigger
6. **Multiple topics** → 1 topic only ("PineScript" or single area)

---

## Demo flow (90 sec, rehearse 5x at 16:45)

```
0:00 — "$20/mo Claude. Used 4% this week. $14 wasted. Meet Compound."
0:15 — [show real Obsidian vault, Atlas additions folder]
0:35 — [show 3 topic sandboxes from Tensorlake]
0:55 — [live: text Telegram bot question → agent responds with synthesis]
1:25 — close: "Tensorlake + Nia. Open source. Vault grows while you sleep."
```

---

## Submission package

- ✅ GitHub: https://github.com/andriidrok1/compound
- 🛠 Vercel demo URL: TBD after deploy
- 🛠 Loom backup video: record at 17:00
- ✅ Track: Always-On Agents
- 🛠 Submission form: 17:30–17:55

---

## Emergency contacts (Discord)

- #tensorlake — for sandbox API issues
- #nia — for indexing problems
- #help — general
