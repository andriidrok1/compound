# Compound — System Architecture (post-OpenAI-pivot)

Snapshot as of 2026-05-09 ~15:30 PT.

## Bird's-eye view

```
┌──────────────────────────────────────────────────────────────────┐
│                      USER (browser + phone)                      │
└─────┬───────────────────────────────────┬───────────────────┬────┘
      │ folder picker (FSA API)           │ web dashboard     │ telegram chat
      │                                   │                   │
      ▼                                   ▼                   │
┌─────────────────────────┐     ┌──────────────────────┐      │
│ ConnectVault component  │     │ Real-time Dashboard  │      │
│ - in-browser scan       │     │ - useQuery hooks     │      │
│ - extract topics        │     │ - reactive updates   │      │
│ - upload metadata       │     │ - MCP setup snippet  │      │
└────────┬────────────────┘     └────────┬─────────────┘      │
         │                               │                    │
         ▼                               ▼                    │
┌─────────────────────────────────────────────────────────────┴────┐
│             VERCEL (Next.js — public, edge)                      │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │  /api/mcp  — JSON-RPC 2.0 MCP server                        │ │
│  │  Tools: list_topics, research_topic, add_note_to_vault,     │ │
│  │         cross_reference                                     │ │
│  │  Public, HTTPS, callable by ANY MCP client                  │ │
│  └─────────────────────────────────────────────────────────────┘ │
└─────┬────────────────────────────────────────────────────────┬───┘
      │                                                        │
      │  callMcpTool(...)                                      │  HTTPS
      │                                                        │
      ▼                                                        ▼
┌──────────────────────────────────┐         ┌────────────────────────────────┐
│     CONVEX (prod cloud, 24/7)    │         │   ANY MCP CLIENT               │
│                                  │         │  - Claude Code (CLI)           │
│  Tables:                         │         │  - Claude.ai Routines (Team)   │
│   - topics                       │         │  - ChatGPT Tasks (Plus/Pro)    │
│   - vault_additions              │         │  - Cursor                      │
│   - tool_calls                   │         │  - OpenAI Responses API        │
│   - telegram_messages            │         │                                │
│   - vault_metadata               │         └────────────────────────────────┘
│                                  │
│  Crons (daily, SF-local):        │
│   - 22:00 → eveningCheckIn       │
│   - 03:00 → openaiResearch       │
│   - 06:00 → openaiResearch       │
│   - 07:30 → morningRecap         │
│                                  │
│  Actions:                        │
│   - openaiResearch     [MAIN]    │
│   - overnightResearch  [fallback]│
│   - eveningCheckIn               │
│   - morningRecap                 │
│   - triggerResearch              │
│   - triggerOpenaiResearch        │
│   - clearAll                     │
└────────┬─────────────────────────┘
         │
         │ outbound HTTPS
         │
         ├──────────────────► OpenAI Responses API
         │                    (gpt-4o-mini orchestrates MCP tools)
         │
         ├──────────────────► Telegram Bot API
         │                    (sendMessage to user)
         │
         ├──────────────────► arxiv export API
         │                    (fallback paper source)
         │
         └──────────────────► Compound MCP (self-call)
                              for tool execution
```

## Component breakdown

### 1. Frontend (Next.js + Vercel)

- **`src/app/Dashboard.tsx`** — main reactive UI
- **`src/app/ConnectVault.tsx`** — browser-based vault upload
- **`src/lib/browser-vault-scan.ts`** — File System Access API scanner
- **`src/app/api/mcp/route.ts`** — JSON-RPC 2.0 MCP server endpoint

Public URL: `https://compound-ashen.vercel.app`
MCP endpoint: `https://compound-ashen.vercel.app/api/mcp`

### 2. Backend (Convex prod)

URL: `https://flexible-panther-60.convex.cloud`

**Schema** (`convex/schema.ts`):
- `topics` — historical topic registry (legacy)
- `vault_additions` — every note Compound writes
- `tool_calls` — every MCP tool invocation logged
- `telegram_messages` — conversation log
- `vault_metadata` — singleton: latest scan from Connect Vault

**Crons** (`convex/crons.ts`):
- 22:00 SF (UTC 05:00) — eveningCheckIn → Telegram
- 03:00 SF (UTC 10:00) — openaiResearch
- 06:00 SF (UTC 13:00) — openaiResearch
- 07:30 SF (UTC 14:30) — morningRecap → Telegram

**Actions** (`convex/agent.ts`):
- `openaiResearch` (MAIN) — uses OpenAI Responses API + GPT-4o-mini to orchestrate Compound's MCP tools autonomously
- `overnightResearch` (fallback) — direct arxiv API + MCP tool calls
- `eveningCheckIn` — picks hot topic + estimates quota + sends Telegram
- `morningRecap` — aggregates overnight additions → Telegram summary
- Public wrappers: `triggerResearch`, `triggerOpenaiResearch`, `triggerEveningCheckIn`, `triggerMorningRecap`

### 3. MCP Tools (server-side, Vercel)

`src/lib/compound-tools.ts`:
- `listTopics()` — folders + hot wikilinks; falls back to Convex topics if filesystem unavailable
- `researchTopic(topic, limit)` — Nia web search + Tensorlake state filter
- `addNoteToVault(filename, content, topic)` — writes .md + logs to Convex
- `crossReference(paper, topic)` — finds related notes

### 4. External services

| Service | Role | Key |
|---|---|---|
| **OpenAI Responses API** | Main orchestration brain (GPT-4o-mini) | `OPENAI_API_KEY` |
| **Tensorlake** | Per-topic durable sandbox state | `TENSORLAKE_API_KEY` |
| **Nia** | Vault indexing + semantic search | `NIA_API_KEY` |
| **arxiv export API** | Fallback paper source (no key) | — |
| **Telegram Bot API** | Conversational notifications | `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` |

### 5. User-facing CLI scripts

- `npm run init` — local vault scan + upload metadata to Convex
- `npm run sync` — pull `vault_additions` from Convex → write .md files locally

### 6. Three trigger paths (multi-source rubric)

1. **Autonomous (Convex cron)** — fires daily at scheduled SF times
2. **Manual web (UI button)** — user clicks "Run research now"
3. **External MCP client** — Claude Code, ChatGPT Tasks, Cursor, OpenAI API call our MCP

## Data flow: full overnight cycle

```
22:00 SF — eveningCheckIn cron
  ↓
  pickHotTopic → from vault_metadata.detectedTopics
  ↓
  estimateQuotaLeft → tool_calls today, count routine sessions
  ↓
  Telegram: "Saw you're into <topic>. <X>/28 routines left. Using tonight."

03:00 + 06:00 SF — openaiResearch cron
  ↓
  pickHotTopic
  ↓
  POST https://api.openai.com/v1/responses
    model: gpt-4o-mini
    tools: [{ type: "mcp", server_url: <our MCP>, allowed_tools: [...] }]
  ↓
  GPT-4o autonomously:
    1. calls list_topics (verify topic)
    2. calls research_topic (gets arxiv papers via our tools)
    3. for each new paper, calls add_note_to_vault with formatted markdown
  ↓
  Each tool call logged to tool_calls table
  Each note added → vault_additions table
  Dashboard updates real-time via useQuery

07:30 SF — morningRecap cron
  ↓
  query recentVaultAdditions → filter last 12h
  ↓
  Telegram: "Added <N> notes overnight: [titles]. Used <X>/28 routines."
```

## State persistence layers

1. **Tensorlake named sandbox per topic** — accumulates research history (paper IDs already seen, run count, last run timestamp). Survives across cron runs. Removing it = duplicates.

2. **Convex DB** — relational state for UI (topics, additions, tool calls, vault metadata, telegram history). Drives reactive dashboard.

3. **Filesystem markdown** — physical notes when user runs `npm run sync` locally. Connects to their Obsidian.

## Public surfaces

- **Web dashboard:** `https://compound-ashen.vercel.app`
- **MCP endpoint:** `https://compound-ashen.vercel.app/api/mcp`
- **GitHub repo:** `https://github.com/andriidrok1/compound`
- **Convex prod:** `https://flexible-panther-60.convex.cloud`
- **Telegram bot:** `@Hackathon_Compoundbot`

## Sponsors used (final stack)

| Sponsor | Use |
|---|---|
| **Nia** (host) | Vault indexing, web search for arxiv |
| **Tensorlake** | Named sandbox state per topic |
| **Convex** | Real-time DB, scheduled crons, mutations/queries |
| **Vercel** | Hosting Next.js + public MCP endpoint |
| **OpenAI** | Responses API as main orchestration brain (via service account key) |

## Security notes

- `.env.local` and Convex env contain API keys; rotate post-event
- MCP endpoint is **unauthenticated** for hackathon demo — production would add OAuth per Anthropic guidance
- Browser-based vault scan uses File System Access API — file content stays client-side, only aggregated metadata uploaded

## What's not built (honest)

- No real Obsidian plugin (sync requires manual `npm run sync`)
- Cross-reference tool exists but isn't run proactively after each addition
- No user auth (single-user demo)
- No subscription tier detection (assumes Claude Team for quota math)
- Daily brief synthesis is just a list, not "3 connections + 1 pattern + 1 question"

## Next iterations (if continuing post-hackathon)

1. Obsidian plugin to remove `npm run sync` step
2. Daily brief upgrade with synthesis prompt (cyrilXBT-style)
3. OAuth on MCP endpoint for production
4. Multi-user (per-user vault_metadata)
5. Subscription tier picker (Pro/Max/Team) for accurate quota math
6. Per-topic timeline visualization on dashboard
