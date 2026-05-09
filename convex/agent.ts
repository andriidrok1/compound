"use node";

import { internalAction } from "./_generated/server";
import { internal, api } from "./_generated/api";

/**
 * Pick the topic the user has been most active in over the last 7 days.
 * Heuristic: most recent vault_additions, or fall back to topics table.
 */
async function pickHotTopic(ctx: any): Promise<string> {
  const recent = await ctx.runQuery(api.log.recentVaultAdditions, { limit: 50 });
  if (recent && recent.length > 0) {
    const counts: Record<string, number> = {};
    for (const r of recent) counts[r.topic] = (counts[r.topic] ?? 0) + 1;
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    if (sorted[0]) return sorted[0][0];
  }
  const topics = await ctx.runQuery(api.log.allTopics, {});
  return topics?.[0]?.name ?? "pinescript";
}

/**
 * Estimate Claude routine quota remaining.
 * Claude.ai usage is private — we approximate from current local time +
 * any tool calls we logged today as "routine" source.
 */
async function estimateQuotaLeft(ctx: any): Promise<{ used: number; total: number; pct: number }> {
  const now = Date.now();
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const calls = await ctx.runQuery(api.log.recentToolCalls, { limit: 100 });
  const todayRoutineCalls = (calls ?? []).filter(
    (c: any) => c.source === "routine" && c.ts >= dayStart.getTime(),
  ).length;
  // Approximate: each "research session" = ~3 tool calls (list, research, add)
  const sessionsUsed = Math.ceil(todayRoutineCalls / 3);
  const total = 28;
  const used = Math.min(sessionsUsed, total);
  const left = total - used;
  return { used, total, pct: Math.round((left / total) * 100) };
}

/**
 * Call our deployed MCP endpoint. This is how Convex (autonomous trigger)
 * invokes the same tools that Claude routines would.
 */
async function callMcpTool(name: string, args: Record<string, unknown>) {
  const url = process.env.MCP_URL ?? "https://compound-ashen.vercel.app/api/mcp";
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: Math.floor(Math.random() * 100000),
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });
  const json: any = await resp.json().catch(() => ({}));
  return json?.result;
}

/**
 * Map vault topic names to arxiv-friendly academic queries.
 * arxiv has no papers about "pinescript" but plenty about
 * "algorithmic trading", "market microstructure", etc.
 */
function topicToArxivQuery(topic: string): string {
  const map: Record<string, string> = {
    pinescript: "algorithmic trading signal detection",
    agents: "autonomous LLM agents",
    "founder-strategy": "startup growth product market fit",
  };
  return map[topic.toLowerCase()] ?? topic;
}

/**
 * Search arxiv directly via their public API (no auth, no CLI binary).
 * Used when Vercel MCP can't reach Nia CLI.
 */
async function arxivSearch(topic: string, limit = 3): Promise<{ id: string; title: string; source: string; snippet: string }[]> {
  const query = topicToArxivQuery(topic);
  const q = encodeURIComponent(`all:${query}`);
  const url = `https://export.arxiv.org/api/query?search_query=${q}&start=0&max_results=${limit}&sortBy=submittedDate&sortOrder=descending`;
  try {
    const resp = await fetch(url);
    const xml = await resp.text();
    const entries: { id: string; title: string; source: string; snippet: string }[] = [];
    const entryBlocks = xml.split("<entry>").slice(1);
    for (const block of entryBlocks.slice(0, limit)) {
      const title = (block.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? "").replace(/\s+/g, " ").trim();
      const summary = (block.match(/<summary>([\s\S]*?)<\/summary>/)?.[1] ?? "").replace(/\s+/g, " ").trim();
      const link = block.match(/<id>([\s\S]*?)<\/id>/)?.[1]?.trim() ?? "";
      if (title) {
        entries.push({
          id: link || title,
          title: title.slice(0, 160),
          source: link,
          snippet: summary.slice(0, 320),
        });
      }
    }
    return entries;
  } catch {
    return [];
  }
}

/**
 * 22:00 — pre-sleep check-in.
 * Picks the hottest topic + estimates remaining quota +
 * sends a friendly message announcing tonight's research plan.
 */
export const eveningCheckIn = internalAction({
  args: {},
  handler: async (ctx) => {
    const topic = await pickHotTopic(ctx);
    const quota = await estimateQuotaLeft(ctx);

    const text = [
      `🌙 *Compound here.*`,
      ``,
      `Saw you've been deep in *${topic}* lately.`,
      `You have *${quota.total - quota.used}/${quota.total}* routine runs left before tomorrow's reset (${quota.pct}% capacity).`,
      ``,
      `I'll use it tonight to research ${topic} while you sleep — don't want it to burn unused.`,
      ``,
      `Sleep well. Recap at 7:30 ☕`,
    ].join("\n");

    await ctx.runAction(internal.telegram_send.send, { text });
    return { topic, quota };
  },
});

/**
 * Overnight — picks the topic, calls research_topic, then add_note_to_vault
 * for each new paper found. Triggers Convex to log everything → dashboard
 * updates while user sleeps.
 */
export const overnightResearch = internalAction({
  args: {},
  handler: async (ctx): Promise<{ topic: string; addedCount: number; papersConsidered: number; source: string }> => {
    const topic = await pickHotTopic(ctx);

    // Try MCP path first (Claude-routine-equivalent path)
    let papers: any[] = [];
    let source = "mcp";
    const research = await callMcpTool("research_topic", { topic, limit: 3 });
    const text = research?.content?.[0]?.text ?? "{}";
    try {
      const parsed = JSON.parse(text);
      papers = parsed.newPapers ?? [];
    } catch {
      // ignore
    }

    // Fallback: hit arxiv API directly from Convex (no Nia CLI dependency)
    if (papers.length === 0) {
      papers = await arxivSearch(topic, 3);
      source = "arxiv-direct";
    }

    let addedCount = 0;
    for (const p of papers.slice(0, 3)) {
      const filename = `compound-${Date.now()}-${slug(p.title ?? "paper")}.md`;
      const content = renderNote(p, topic);
      await callMcpTool("add_note_to_vault", { filename, content, topic });
      addedCount += 1;
    }

    return { topic, addedCount, papersConsidered: papers.length, source };
  },
});

/**
 * 07:30 — morning recap. Summarise overnight additions and DM the user.
 */
export const morningRecap = internalAction({
  args: {},
  handler: async (ctx): Promise<{ count: number }> => {
    const additions: any[] = await ctx.runQuery(api.log.recentVaultAdditions, { limit: 50 });
    const last12h = Date.now() - 12 * 60 * 60 * 1000;
    const overnight: any[] = (additions ?? []).filter((a: any) => a.addedAt >= last12h);

    if (overnight.length === 0) {
      await ctx.runAction(internal.telegram_send.send, {
        text: `☀️ Morning. No new findings worth surfacing overnight — quota saved for today.`,
      });
      return { count: 0 };
    }

    const lines: string[] = overnight.slice(0, 5).map((a: any) => `• [[${a.title}]] — ${a.topic}`);
    const text = [
      `☀️ *Good morning.*`,
      ``,
      `Added ${overnight.length} note${overnight.length === 1 ? "" : "s"} to your vault overnight:`,
      "",
      ...lines,
      "",
      `Used ~${overnight.length}/28 routines. Dashboard: compound-ashen.vercel.app`,
    ].join("\n");

    await ctx.runAction(internal.telegram_send.send, { text });
    return { count: overnight.length };
  },
});

// --- helpers ---

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
}

function renderNote(paper: any, topic: string): string {
  const title = paper.title ?? "Untitled";
  const source = paper.source ?? "n/a";
  const snippet = paper.snippet ?? "";
  return [
    "---",
    `source: ${source}`,
    `added_by: Compound (overnight)`,
    `added_at: ${new Date().toISOString()}`,
    `topic: ${topic}`,
    `trigger: convex-cron`,
    "---",
    "",
    `# ${title}`,
    "",
    "## Snippet",
    "",
    snippet,
    "",
    "## Why surfaced",
    "",
    `Picked by Compound based on recent activity in *${topic}*. Cross-reference your existing notes and decide whether to integrate.`,
    "",
    `*Auto-generated by Compound overnight cron.*`,
  ].join("\n");
}
