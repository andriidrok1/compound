"use client";

import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";

export default function Dashboard() {
  const toolCalls = useQuery(api.log.recentToolCalls, { limit: 30 });
  const additions = useQuery(api.log.recentVaultAdditions, { limit: 20 });
  const topics = useQuery(api.log.allTopics, {});

  const mcpUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/api/mcp`
      : "/api/mcp";

  return (
    <div className="min-h-screen px-6 py-10 max-w-6xl mx-auto">
      {/* Hero */}
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

      {/* Pain hook */}
      <section className="mb-12 grid md:grid-cols-3 gap-4">
        <Stat label="Daily routine runs" value="0 / 28" hint="of your Claude Team subscription" />
        <Stat label="Weekly capacity used" value="~5%" hint="$14 / $25 wasted" />
        <Stat label="Vault notes today" value={`${additions?.length ?? "·"}`} hint="added autonomously" />
      </section>

      {/* Topics */}
      <section className="mb-12">
        <h2 className="text-sm uppercase tracking-wider text-neutral-500 mb-3">Active topics</h2>
        {!topics ? (
          <Skeleton lines={2} />
        ) : topics.length === 0 ? (
          <Empty hint="Topics get registered as Compound observes your vault." />
        ) : (
          <div className="grid md:grid-cols-3 gap-3">
            {topics.map((t) => (
              <div
                key={t._id}
                className="rounded-lg border border-neutral-800 p-4 bg-neutral-900/50"
              >
                <div className="text-sm font-medium">{t.name}</div>
                <div className="text-xs text-neutral-500 mt-1">
                  {t.paperCount} papers researched
                  {t.lastResearched
                    ? ` · ${new Date(t.lastResearched).toLocaleTimeString()}`
                    : ""}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Vault additions */}
      <section className="mb-12">
        <h2 className="text-sm uppercase tracking-wider text-neutral-500 mb-3">Recent vault additions</h2>
        {!additions ? (
          <Skeleton lines={3} />
        ) : additions.length === 0 ? (
          <Empty hint="When Compound writes a note, it shows up here in real time." />
        ) : (
          <ul className="space-y-2">
            {additions.map((a) => (
              <li
                key={a._id}
                className="flex items-baseline gap-3 text-sm border-b border-neutral-900 pb-2"
              >
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

      {/* Live activity */}
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
                <span className="text-neutral-500 w-16">
                  {new Date(c.ts).toLocaleTimeString()}
                </span>
                <span
                  className={
                    c.isError
                      ? "text-red-400 font-semibold w-44 truncate"
                      : "text-emerald-400 font-semibold w-44 truncate"
                  }
                >
                  {c.tool}
                </span>
                <span className="text-neutral-500 w-12">{c.durationMs ?? "—"}ms</span>
                <span className="text-neutral-600 truncate flex-1">{c.args}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* MCP setup hint */}
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
