"use client";

import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import ConnectVault from "./ConnectVault";

const DAILY_ROUTINE_QUOTA = 28; // Claude Team plan
const MONTHLY_PRICE_USD = 25;

export default function Dashboard() {
  const toolCalls = useQuery(api.log.recentToolCalls, { limit: 200 });
  const additions = useQuery(api.log.recentVaultAdditions, { limit: 20 });
  const topics = useQuery(api.log.allTopics, {});
  const vaultMeta = useQuery(api.log.latestVaultMetadata, {});

  // Compute live stats from actual data
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  // A "routine session" ≈ a research_topic tool call (each cron run does one)
  const routineRunsToday = (toolCalls ?? []).filter(
    (c) => c.tool === "research_topic" && c.ts >= startOfDay.getTime(),
  ).length;

  const routinesLeft = Math.max(0, DAILY_ROUTINE_QUOTA - routineRunsToday);

  // Wasted dollars approximation:
  //   $25/mo subscription × (28 routine runs/day allowance) → ~$0.0298/routine
  //   Wasted today = unused routines × per-routine value
  const perRoutineValue = MONTHLY_PRICE_USD / 30 / DAILY_ROUTINE_QUOTA; // ~$0.0298
  const wastedTodayUsd = (routinesLeft * perRoutineValue).toFixed(2);

  // Notes added today
  const notesToday = (additions ?? []).filter((a) => a.addedAt >= startOfDay.getTime()).length;
  const notesThisWeek = (additions ?? []).filter((a) => a.addedAt >= now - 7 * dayMs).length;

  const mcpUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/api/mcp`
      : "/api/mcp";

  // Detect "fresh user" state: vault not connected AND no activity yet
  const isFreshUser =
    vaultMeta !== undefined &&
    !vaultMeta &&
    topics !== undefined &&
    additions !== undefined &&
    toolCalls !== undefined &&
    topics.length === 0 &&
    additions.length === 0 &&
    toolCalls.length === 0;

  // Effective active topics list: prefer detected topics from vault_metadata,
  // fall back to manually-tracked `topics` table.
  type DisplayTopic = { _id: string; name: string; subtitle: string };
  const effectiveTopics: DisplayTopic[] = vaultMeta?.detectedTopics?.length
    ? vaultMeta.detectedTopics.map((t, i) => ({
        _id: `meta-${i}`,
        name: t.name,
        subtitle: t.evidence,
      }))
    : (topics ?? []).map((t) => ({
        _id: String(t._id),
        name: t.name,
        subtitle: `${t.paperCount} papers researched${
          t.lastResearched ? ` · ${new Date(t.lastResearched).toLocaleTimeString()}` : ""
        }`,
      }));

  return (
    <div className="min-h-screen px-6 py-10 max-w-6xl mx-auto">
      <header className="mb-12">
        <div className="flex items-center gap-3 mb-2">
          <div className="h-8 w-8 rounded bg-gradient-to-br from-violet-500 to-fuchsia-500" />
          <h1 className="text-2xl font-semibold tracking-tight">Compound</h1>
        </div>
        <p className="text-neutral-400 text-sm max-w-xl">
          Autonomous research agent for your Obsidian vault. Reads arxiv while you sleep,
          adds findings as wikilinked notes — using your unused Claude routine capacity.
        </p>
      </header>

      <ConnectVault />

      {isFreshUser && (
        <div className="mb-12 rounded-lg border border-dashed border-neutral-800 p-6 text-sm text-neutral-500 text-center">
          Once you connect a vault, daily routine usage, detected topics, and overnight research
          additions will populate this dashboard live.
        </div>
      )}

      {!isFreshUser && (
      <section className="mb-12 grid md:grid-cols-3 gap-4">
        <Stat
          label="Routines used today"
          value={`${routineRunsToday} / ${DAILY_ROUTINE_QUOTA}`}
          hint={`${routinesLeft} unused — burn before 6am reset`}
        />
        <Stat
          label="Wasted today if unused"
          value={`$${wastedTodayUsd}`}
          hint={`from your $${MONTHLY_PRICE_USD}/mo Claude Team subscription`}
        />
        <Stat
          label="Vault notes added"
          value={`${notesToday}`}
          hint={`${notesThisWeek} this week, autonomously`}
        />
      </section>
      )}

      {!isFreshUser && (
      <section className="mb-12">
        <h2 className="text-sm uppercase tracking-wider text-neutral-500 mb-3">Active topics</h2>
        {effectiveTopics.length === 0 ? (
          <Empty hint="Topics get registered as Compound observes your vault." />
        ) : (
          <div className="grid md:grid-cols-3 gap-3">
            {effectiveTopics.slice(0, 6).map((t) => (
              <div key={t._id} className="rounded-lg border border-neutral-800 p-4 bg-neutral-900/50">
                <div className="text-sm font-medium">{t.name}</div>
                <div className="text-xs text-neutral-500 mt-1">{t.subtitle}</div>
              </div>
            ))}
          </div>
        )}
      </section>
      )}

      {!isFreshUser && (
      <section className="mb-12">
        <h2 className="text-sm uppercase tracking-wider text-neutral-500 mb-3">Recent vault additions</h2>
        {!additions ? (
          <Skeleton lines={3} />
        ) : additions.length === 0 ? (
          <Empty hint="When Compound writes a note, it shows up here in real time." />
        ) : (
          <ul className="space-y-2">
            {additions.map((a) => (
              <li key={a._id} className="flex items-baseline gap-3 text-sm border-b border-neutral-900 pb-2">
                <span className="text-neutral-500 font-mono text-xs shrink-0 w-16">
                  {new Date(a.addedAt).toLocaleTimeString().slice(0, 5)}
                </span>
                <span className="font-medium truncate flex-1">{a.title}</span>
                <span className="text-xs text-neutral-500">{a.topic}</span>
                <span className="text-xs px-1.5 py-0.5 rounded bg-violet-900/40 text-violet-300">
                  {a.trigger}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      )}

      {!isFreshUser && (
      <section className="mb-12">
        <h2 className="text-sm uppercase tracking-wider text-neutral-500 mb-3">Live activity</h2>
        {!toolCalls ? (
          <Skeleton lines={4} />
        ) : toolCalls.length === 0 ? (
          <Empty hint="Tool calls from Claude Routines or Telegram appear here in real time." />
        ) : (
          <ul className="space-y-1 font-mono text-xs">
            {toolCalls.map((c) => (
              <li key={c._id} className="flex gap-3 text-neutral-300 border-b border-neutral-900 py-1.5">
                <span className="text-neutral-500 w-16">{new Date(c.ts).toLocaleTimeString()}</span>
                <span className={c.isError ? "text-red-400 font-semibold w-44 truncate" : "text-emerald-400 font-semibold w-44 truncate"}>
                  {c.tool}
                </span>
                <span className="text-neutral-500 w-12">{c.durationMs ?? "—"}ms</span>
                <span className="text-neutral-600 truncate flex-1">{c.args}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      )}

      <section className="rounded-lg border border-neutral-800 p-5 bg-neutral-900/30">
        <h3 className="text-sm font-semibold mb-2">Connect to your Claude</h3>
        <p className="text-xs text-neutral-400 mb-3">
          Add this MCP server to your Claude.ai org → Connectors, then create a routine that uses
          its tools. Compound picks up the trigger and grows your vault.
        </p>
        <pre className="text-xs bg-black/40 border border-neutral-800 rounded p-3 overflow-auto">
{`{
  "compound": {
    "url": "${mcpUrl}",
    "tools": ["list_topics", "research_topic", "add_note_to_vault", "cross_reference"]
  }
}`}
        </pre>
      </section>

      <footer className="mt-12 text-xs text-neutral-600 text-center">
        Built at Nozomio Hackathon · powered by Tensorlake + Nia + Convex · open source
      </footer>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string | number; hint: string }) {
  return (
    <div className="rounded-lg border border-neutral-800 p-4 bg-neutral-900/50">
      <div className="text-xs uppercase tracking-wider text-neutral-500">{label}</div>
      <div className="text-2xl font-semibold mt-1">{value}</div>
      <div className="text-xs text-neutral-500 mt-1">{hint}</div>
    </div>
  );
}

function Skeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="h-4 rounded bg-neutral-900 animate-pulse" />
      ))}
    </div>
  );
}

function Empty({ hint }: { hint: string }) {
  return (
    <div className="rounded-lg border border-dashed border-neutral-800 p-6 text-sm text-neutral-500 text-center">
      {hint}
    </div>
  );
}
