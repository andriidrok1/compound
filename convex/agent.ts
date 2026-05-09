"use node";

import { action, internalAction } from "./_generated/server";
import { internal, api } from "./_generated/api";

/**
 * Pick the top N topics the user is most interested in,
 * skipping ones already researched in the last 24h.
 */
async function pickInterestingTopics(ctx: any, count: number): Promise<string[]> {
  const meta = await ctx.runQuery(api.log.latestVaultMetadata, {});
  const candidates: { name: string; priority: number }[] = (meta?.detectedTopics ?? []).map(
    (t: any) => ({ name: t.name, priority: t.priority }),
  );

  if (candidates.length === 0) {
    return ["pinescript"]; // ultimate fallback
  }

  // 24h cooldown — don't re-research same topic too soon
  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const recent = await ctx.runQuery(api.log.recentVaultAdditions, { limit: 50 });
  const recentTopics = new Set(
    (recent ?? []).filter((a: any) => a.addedAt >= dayAgo).map((a: any) => a.topic.toLowerCase()),
  );

  // Sort: cooldown last, then priority desc
  candidates.sort((a, b) => {
    const aFresh = recentTopics.has(a.name.toLowerCase()) ? 1 : 0;
    const bFresh = recentTopics.has(b.name.toLowerCase()) ? 1 : 0;
    if (aFresh !== bFresh) return aFresh - bFresh;
    return b.priority - a.priority;
  });

  return candidates.slice(0, count).map((c) => c.name);
}

/** Single-topic picker (used by evening check-in for the headline topic). */
async function pickHotTopic(ctx: any): Promise<string> {
  const top = await pickInterestingTopics(ctx, 1);
  return top[0] ?? "pinescript";
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
 * Built from Andrii's actual MOC names + detected topics.
 */
function topicToArxivQuery(topic: string): string {
  const t = topic.toLowerCase().trim();
  const map: Record<string, string> = {
    pinescript: "algorithmic trading signal detection",
    "trading-": "algorithmic trading market microstructure",
    trading: "algorithmic trading market microstructure",
    "deep-research-real-trader-strategies": "quantitative trading strategy backtesting",
    "rujira-audit": "smart contract audit security",
    rujira: "smart contract audit security",
    agents: "autonomous LLM agents",
    "founder-strategy": "startup growth product market fit",
    products: "product analytics user retention SaaS",
    research: "research methodology literature synthesis",
  };
  return map[t] ?? topic;
}

/**
 * Topics that have meaningful arxiv presence.
 * Generic words ("work", "profile") return useless results — skip them.
 */
const ARXIV_FRIENDLY_TOPICS = new Set([
  "pinescript",
  "trading-",
  "trading",
  "deep-research-real-trader-strategies",
  "rujira-audit",
  "rujira",
  "agents",
  "founder-strategy",
]);

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
    const topics = await pickInterestingTopics(ctx, 3);
    const quota = await estimateQuotaLeft(ctx);

    const topicLines = topics.map((t, i) => `  ${i + 1}. *${t}*`).join("\n");

    const text = [
      `🌙 *Compound here.*`,
      ``,
      `Tonight I'll research your top 3 topics:`,
      topicLines,
      ``,
      `You have *${quota.total - quota.used}/${quota.total}* routine runs left before tomorrow's reset.`,
      `Using them tonight so they don't burn unused.`,
      ``,
      `Sleep well. Recap at 7:30 ☕`,
    ].join("\n");

    await ctx.runAction(internal.telegram_send.send, { text });
    return { topics, quota };
  },
});

/**
 * Overnight — picks the topic, calls research_topic, then add_note_to_vault
 * for each new paper found. Triggers Convex to log everything → dashboard
 * updates while user sleeps.
 */
/**
 * Overnight research — researches the user's top 3 interesting topics in one cycle.
 * Each topic gets one paper added to the vault.
 *
 * Triggered by Convex cron (03:00 SF) or manual `Run research now` button.
 *
 * Architecture is subscription-friendly:
 *   - This action calls our public MCP server (https://compound-ashen.vercel.app/api/mcp)
 *   - The same MCP server is what Claude Routines / ChatGPT Tasks call autonomously when
 *     a user adds it as a connector + creates a routine.
 *   - End user pays $0 marginal — they're using subscription quota that would otherwise reset.
 */
export const overnightResearch = internalAction({
  args: {},
  handler: async (ctx): Promise<{
    topicsResearched: string[];
    papersAdded: number;
    perTopic: Record<string, number>;
  }> => {
    const topics = await pickInterestingTopics(ctx, 3);
    const date = new Date().toISOString().slice(0, 10);
    const perTopic: Record<string, number> = {};
    let total = 0;

    for (const topic of topics) {
      // 1. Ask MCP for new papers (filtered against Tensorlake state)
      const research = await callMcpTool("research_topic", { topic, limit: 2 });
      const text = research?.content?.[0]?.text ?? "{}";
      let papers: any[] = [];
      try {
        const parsed = JSON.parse(text);
        papers = parsed.newPapers ?? [];
      } catch {
        // ignore
      }

      // 2. Fallback: arxiv direct API
      if (papers.length === 0) {
        papers = await arxivSearch(topic, 1);
      }

      // 3. Add 1 best paper per topic
      const best = papers[0];
      if (best) {
        const cleanTitle = (best.title ?? "Untitled paper")
          .replace(/[\\/:*?"<>|]/g, "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 80);
        const filename = `${date} — ${cleanTitle}.md`;
        const content = renderNote(best, topic);
        await callMcpTool("add_note_to_vault", { filename, content, topic });
        perTopic[topic] = 1;
        total += 1;
      } else {
        perTopic[topic] = 0;
      }
    }

    return { topicsResearched: topics, papersAdded: total, perTopic };
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

/**
 * Public action: triggered by the web UI ("Run research now" button) and
 * by Connect Vault auto-trigger after metadata upload.
 */
export const triggerResearch = action({
  args: {},
  handler: async (ctx): Promise<any> => {
    return await ctx.runAction(internal.agent.overnightResearch, {});
  },
});

export const triggerEveningCheckIn = action({
  args: {},
  handler: async (ctx): Promise<any> => {
    return await ctx.runAction(internal.agent.eveningCheckIn, {});
  },
});

export const triggerMorningRecap = action({
  args: {},
  handler: async (ctx): Promise<any> => {
    return await ctx.runAction(internal.agent.morningRecap, {});
  },
});

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
