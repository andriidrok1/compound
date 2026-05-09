"use node";

import { action, internalAction } from "./_generated/server";
import { internal, api } from "./_generated/api";

/**
 * Pick the topic the user has been most active in.
 * Priority order:
 *   1. detected topics from latest vault_metadata snapshot (priority field)
 *   2. recent vault_additions cluster
 *   3. hardcoded fallback
 */
async function pickHotTopic(ctx: any): Promise<string> {
  // 1. From init-vault snapshot — best signal
  const meta = await ctx.runQuery(api.log.latestVaultMetadata, {});
  if (meta?.detectedTopics?.length > 0) {
    // Filter to topics arxiv can actually answer
    const arxivFriendly = meta.detectedTopics.filter((t: any) =>
      ARXIV_FRIENDLY_TOPICS.has(t.name.toLowerCase()),
    );
    const candidates = arxivFriendly.length > 0 ? arxivFriendly : meta.detectedTopics;

    // Pick highest-priority topic that hasn't been researched recently
    const recent = await ctx.runQuery(api.log.recentVaultAdditions, { limit: 20 });
    const recentTopics = new Set((recent ?? []).slice(0, 5).map((r: any) => r.topic.toLowerCase()));
    for (const t of candidates) {
      if (!recentTopics.has(t.name.toLowerCase())) return t.name;
    }
    return candidates[0].name;
  }

  // 2. Activity-based fallback
  const recent = await ctx.runQuery(api.log.recentVaultAdditions, { limit: 50 });
  if (recent && recent.length > 0) {
    const counts: Record<string, number> = {};
    for (const r of recent) counts[r.topic] = (counts[r.topic] ?? 0) + 1;
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    if (sorted[0]) return sorted[0][0];
  }

  // 3. Final fallback
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
    const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    for (const p of papers.slice(0, 3)) {
      const cleanTitle = (p.title ?? "Untitled paper")
        .replace(/[\\/:*?"<>|]/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 80);
      const filename = `${date} — ${cleanTitle}.md`;
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

/**
 * Multi-LLM autonomous research via OpenAI Responses API.
 *
 * Lets GPT-4o autonomously orchestrate Compound's MCP tools — same outcome
 * as Claude routines, different brain. Demonstrates that Compound is
 * LLM-agnostic infrastructure, not Anthropic-specific.
 */
export const openaiResearch = internalAction({
  args: {},
  handler: async (ctx): Promise<any> => {
    const topic = await pickHotTopic(ctx);
    const apiKey = process.env.OPENAI_API_KEY;
    const mcpUrl = process.env.MCP_URL ?? "https://compound-ashen.vercel.app/api/mcp";

    if (!apiKey) {
      return { error: "OPENAI_API_KEY not set", topic };
    }

    const prompt = [
      `You are Compound's overnight research agent. Your task:`,
      `1. Call list_topics to see available topics.`,
      `2. Call research_topic with topic="${topic}" to get new arxiv papers.`,
      `3. For each new paper, call add_note_to_vault with:`,
      `   - filename: "YYYY-MM-DD — <clean paper title>.md"`,
      `   - topic: "${topic}"`,
      `   - content: well-formed markdown with frontmatter, paper summary, and [[wikilinks]] to existing related notes`,
      `4. Be efficient — minimize tool calls. Stop after adding up to 2 notes.`,
    ].join("\n");

    const resp = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        input: prompt,
        tools: [
          {
            type: "mcp",
            server_url: mcpUrl,
            server_label: "compound",
            require_approval: "never",
            allowed_tools: ["list_topics", "research_topic", "add_note_to_vault"],
          },
        ],
        max_output_tokens: 4000,
      }),
    });

    const data: any = await resp.json().catch(() => ({}));
    return {
      topic,
      ok: resp.ok,
      status: resp.status,
      output_summary: data?.output?.[0]?.content?.[0]?.text?.slice(0, 300) ?? null,
      tool_calls_made: (data?.output ?? []).filter((o: any) => o.type === "mcp_call").length,
      raw_error: data?.error ?? null,
    };
  },
});

/**
 * Public actions — callable from the web UI ("Run research now" button)
 * + from Connect Vault auto-trigger.
 */
export const triggerResearch = action({
  args: {},
  handler: async (ctx): Promise<any> => {
    return await ctx.runAction(internal.agent.overnightResearch, {});
  },
});

/**
 * Public action: trigger OpenAI-driven research path.
 * Used to demonstrate multi-LLM compatibility on the live demo.
 */
export const triggerOpenaiResearch = action({
  args: {},
  handler: async (ctx): Promise<any> => {
    return await ctx.runAction(internal.agent.openaiResearch, {});
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
