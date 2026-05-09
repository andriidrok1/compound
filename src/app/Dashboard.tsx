"use client";

import { useQuery } from "convex/react";
import { useState } from "react";
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
        <div className="flex items-center gap-3 mb-3">
          <div className="h-9 w-9 rounded-md bg-gradient-to-br from-violet-500 via-fuchsia-500 to-emerald-400 shadow-lg shadow-violet-500/30" />
          <h1 className="text-3xl font-semibold tracking-tight">Compound</h1>
        </div>
        <p className="text-neutral-300 text-base leading-relaxed max-w-2xl">
          Your second brain on autopilot.{" "}
          <span className="text-neutral-500">
            Researches 3 of your active topics every night, adds findings to your Obsidian vault
            as wikilinked notes — using your unused Claude / ChatGPT routine capacity that would
            otherwise reset.
          </span>
        </p>
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          <Pill>3 topics nightly</Pill>
          <Pill>Tensorlake state per topic</Pill>
          <Pill>Convex real-time</Pill>
          <Pill>Open MCP server</Pill>
          <Pill subtle>+ Claude Routines / ChatGPT Tasks</Pill>
        </div>
      </header>

      <ConnectVault />

      {isFreshUser && (
        <div className="mb-12 rounded-lg border border-dashed border-neutral-800 p-6 text-sm text-neutral-500 text-center">
          Once you connect a vault, daily routine usage, detected topics, and overnight research
          additions will populate this dashboard live.
        </div>
      )}

      {/* Stats removed — user cares about what Compound DID and what it'll do NEXT, not pain-hook marketing. */}

      {!isFreshUser && (
      <section className="mb-12">
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-sm uppercase tracking-wider text-neutral-500">Upcoming research queue</h2>
          <span className="text-xs text-neutral-600">next overnight cycle: 03:00 SF</span>
        </div>
        {!vaultMeta?.detectedTopics?.length ? (
          <Empty hint="Connect your vault and Compound will queue research topics by activity priority." />
        ) : (
          <div className="grid md:grid-cols-3 gap-3">
            {(() => {
              // Filter to arxiv-friendly topics, sort by priority,
              // skip topics researched in last 24h (cooldown).
              const FRIENDLY = new Set([
                "pinescript",
                "trading-",
                "trading",
                "deep-research-real-trader-strategies",
                "rujira-audit",
                "rujira",
                "agents",
                "founder-strategy",
                "code",
                "research",
                "business",
                "products",
              ]);
              const recentlyResearched = new Set(
                (additions ?? [])
                  .filter((a) => a.addedAt >= now - 24 * 60 * 60 * 1000)
                  .map((a) => a.topic.toLowerCase())
              );
              const queue = (vaultMeta.detectedTopics ?? [])
                .filter((t: any) => FRIENDLY.has(t.name.toLowerCase()))
                .sort((a: any, b: any) => {
                  const aFresh = recentlyResearched.has(a.name.toLowerCase()) ? 1 : 0;
                  const bFresh = recentlyResearched.has(b.name.toLowerCase()) ? 1 : 0;
                  if (aFresh !== bFresh) return aFresh - bFresh;
                  return b.priority - a.priority;
                })
                .slice(0, 3);

              return queue.length === 0 ? (
                <Empty hint="No arxiv-friendly topics queued — all recently covered." />
              ) : (
                queue.map((t: any, i: number) => {
                  const cooldown = recentlyResearched.has(t.name.toLowerCase());
                  return (
                    <div
                      key={t.name}
                      className={`rounded-lg border p-4 ${
                        cooldown
                          ? "border-neutral-800 bg-neutral-900/30 opacity-60"
                          : "border-violet-700/40 bg-violet-950/20"
                      }`}
                    >
                      <div className="flex items-baseline justify-between mb-1">
                        <div className="text-sm font-medium">{t.name}</div>
                        <span className="text-[10px] uppercase text-neutral-500">
                          {cooldown ? "cooldown" : `next #${i + 1}`}
                        </span>
                      </div>
                      <div className="text-xs text-neutral-500">{t.evidence}</div>
                      <div className="text-[10px] text-violet-400 mt-2 font-mono">
                        priority {t.priority}
                      </div>
                    </div>
                  );
                })
              );
            })()}
          </div>
        )}
      </section>
      )}

      {!isFreshUser && (
      <section className="mb-12">
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-sm uppercase tracking-wider text-neutral-500">Recent vault additions</h2>
          <span className="text-xs text-neutral-600">{(additions ?? []).length} total</span>
        </div>
        {!additions ? (
          <Skeleton lines={3} />
        ) : additions.length === 0 ? (
          <Empty hint="When Compound writes a note, it shows up here in real time." />
        ) : (
          <ul className="space-y-2">
            {additions.map((a) => {
              const isUrl = a.sourceUrl && /^https?:\/\//.test(a.sourceUrl);
              return (
                <li key={a._id} className="flex items-baseline gap-3 text-sm border-b border-neutral-900 pb-2">
                  <span className="text-neutral-500 font-mono text-xs shrink-0 w-16">
                    {relativeTime(a.addedAt)}
                  </span>
                  {isUrl ? (
                    <a
                      href={a.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="font-medium truncate flex-1 hover:text-violet-300 transition-colors"
                      title={a.sourceUrl}
                    >
                      {a.title}
                    </a>
                  ) : (
                    <span className="font-medium truncate flex-1">{a.title}</span>
                  )}
                  <span className="text-xs text-neutral-500">{a.topic}</span>
                  <span className="text-xs px-1.5 py-0.5 rounded bg-violet-900/40 text-violet-300">
                    {a.trigger}
                  </span>
                </li>
              );
            })}
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
                <span className="text-neutral-500 w-20 shrink-0">{relativeTime(c.ts)}</span>
                <span className={c.isError ? "text-red-400 font-semibold w-44 shrink-0 truncate" : "text-emerald-400 font-semibold w-44 shrink-0 truncate"}>
                  {c.tool}
                </span>
                <span className="text-neutral-500 w-14 shrink-0">{c.durationMs ?? "—"}ms</span>
                <span className="text-neutral-600 truncate flex-1">{c.args}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      )}

      {/* Architecture / How it works */}
      <section className="rounded-lg border border-neutral-800 p-5 bg-neutral-900/30 mb-6">
        <h3 className="text-sm font-semibold mb-3">How Compound runs</h3>
        <div className="grid md:grid-cols-3 gap-3 text-xs">
          <ArchCard
            title="1. You connect a vault"
            body="Browser scans your Obsidian folder locally. Only metadata leaves your machine — folders, top wikilinks, recent edits."
            tag="File System Access API"
          />
          <ArchCard
            title="2. Compound detects topics"
            body="Heuristics from MOC backlinks, recent edits, and folder activity rank what you're actively working on."
            tag="vault_metadata"
          />
          <ArchCard
            title="3. Cron researches 3 topics nightly"
            body="03:00 SF cron loops through top 3 priority topics. For each: queries arxiv via MCP, dedupes via Tensorlake state, adds 1 paper to vault."
            tag="Convex cron + MCP"
          />
          <ArchCard
            title="4. Tensorlake holds memory"
            body="Per-topic named sandbox stores researched paper IDs. Survives across cron runs — no duplicates between sessions."
            tag="Tensorlake"
          />
          <ArchCard
            title="5. Convex logs everything"
            body="Tool calls, vault additions, vault metadata — all reactive. This dashboard updates real-time as cron runs."
            tag="Convex"
          />
          <ArchCard
            title="6. Telegram closes the loop"
            body="Evening check-in (22:00), morning recap (07:30) with overnight summary. You close the loop without opening anything."
            tag="@Hackathon_Compoundbot"
          />
        </div>
        <div className="mt-4 pt-3 border-t border-neutral-800 text-xs text-neutral-500">
          Multi-LLM compatible: same MCP server callable from Claude Routines (Team plan),
          ChatGPT Tasks (Plus/Pro), Cursor, Claude Code, or any HTTPS MCP client.
        </div>
      </section>

      <section className="rounded-lg border border-neutral-800 p-5 bg-neutral-900/30">
        <h3 className="text-sm font-semibold mb-2">Use Compound from any LLM</h3>
        <p className="text-xs text-neutral-400 mb-3">
          Add this MCP server to Claude.ai → Connectors, ChatGPT → Settings → Connectors, Cursor,
          or any MCP client. Then create a scheduled task / routine that uses Compound&apos;s tools.
        </p>
        <CopyableUrl url={mcpUrl} />
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

function CopyableUrl({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2 bg-black/50 border border-neutral-800 rounded p-3">
      <code className="text-xs text-emerald-300 font-mono flex-1 truncate select-all">{url}</code>
      <button
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(url);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          } catch {
            // ignore
          }
        }}
        className="text-xs px-2.5 py-1 rounded bg-neutral-800 hover:bg-neutral-700 transition-colors"
      >
        {copied ? "✓ Copied" : "Copy"}
      </button>
    </div>
  );
}

function Pill({ children, subtle = false }: { children: React.ReactNode; subtle?: boolean }) {
  return (
    <span
      className={
        "px-2 py-0.5 rounded-full border " +
        (subtle
          ? "border-neutral-800 text-neutral-500"
          : "border-violet-700/40 text-violet-300 bg-violet-950/30")
      }
    >
      {children}
    </span>
  );
}

function relativeTime(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 5) return "just now";
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function ArchCard({ title, body, tag }: { title: string; body: string; tag: string }) {
  return (
    <div className="rounded border border-neutral-800 p-3 bg-neutral-950/40">
      <div className="text-sm font-medium mb-1">{title}</div>
      <div className="text-xs text-neutral-400 leading-relaxed">{body}</div>
      <div className="mt-2 inline-block text-[10px] uppercase tracking-wider text-emerald-400 border border-emerald-700/40 px-1.5 py-0.5 rounded">
        {tag}
      </div>
    </div>
  );
}
