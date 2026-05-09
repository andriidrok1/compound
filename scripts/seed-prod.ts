/**
 * Seed Convex production with realistic historical data for the demo.
 * Run with: npx tsx --env-file=.env.local scripts/seed-prod.ts
 *
 * IMPORTANT: this targets the prod URL. Set CONVEX_URL_OVERRIDE to override if needed.
 */
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";

const PROD_URL = process.env.CONVEX_URL_OVERRIDE || "https://flexible-panther-60.convex.cloud";

const client = new ConvexHttpClient(PROD_URL);

const HOURS_AGO = (h: number) => Date.now() - h * 60 * 60 * 1000;
const MINS_AGO = (m: number) => Date.now() - m * 60 * 1000;

const TOPICS = ["pinescript", "agents", "founder-strategy"];

const HISTORICAL_TOOL_CALLS = [
  // 9:30 routine wakeup
  { tool: "list_topics", args: "{}", durationMs: 412, source: "routine", ts: HOURS_AGO(2.5) },
  { tool: "research_topic", args: '{"topic":"pinescript","limit":5}', durationMs: 3204, source: "routine", ts: HOURS_AGO(2.45) },
  { tool: "cross_reference", args: '{"topic":"pinescript","paperTitle":"SMC liquidity sweep detection"}', durationMs: 4812, source: "routine", ts: HOURS_AGO(2.4) },
  { tool: "add_note_to_vault", args: '{"topic":"pinescript","filename":"2026-05-09-smc-liquidity-sweep-validation.md"}', durationMs: 89, source: "routine", ts: HOURS_AGO(2.38) },
  // 11:15 second wakeup
  { tool: "research_topic", args: '{"topic":"pinescript","limit":5}', durationMs: 2890, source: "routine", ts: HOURS_AGO(0.95) },
  { tool: "cross_reference", args: '{"topic":"pinescript","paperTitle":"HTF context streaming"}', durationMs: 5103, source: "routine", ts: HOURS_AGO(0.92) },
  { tool: "add_note_to_vault", args: '{"topic":"pinescript","filename":"2026-05-09-htf-context-streaming.md"}', durationMs: 76, source: "routine", ts: HOURS_AGO(0.91) },
  // 13:47 third wakeup
  { tool: "research_topic", args: '{"topic":"pinescript","limit":5}', durationMs: 3411, source: "routine", ts: MINS_AGO(35) },
  { tool: "cross_reference", args: '{"topic":"pinescript","paperTitle":"Bayesian confluence scoring"}', durationMs: 6201, source: "routine", ts: MINS_AGO(33) },
  { tool: "add_note_to_vault", args: '{"topic":"pinescript","filename":"2026-05-09-confluence-scoring-bayesian.md"}', durationMs: 92, source: "routine", ts: MINS_AGO(32) },
  // 15:20 most recent
  { tool: "research_topic", args: '{"topic":"pinescript","limit":5}', durationMs: 2756, source: "routine", ts: MINS_AGO(8) },
  { tool: "add_note_to_vault", args: '{"topic":"pinescript","filename":"2026-05-09-barstate-optimization-flux.md"}', durationMs: 81, source: "routine", ts: MINS_AGO(6) },
];

const HISTORICAL_ADDITIONS = [
  {
    topic: "pinescript",
    title: "2026-05-09-smc-liquidity-sweep-validation",
    relativePath: "Atlas additions/2026-05-09-smc-liquidity-sweep-validation.md",
    sourceUrl: "https://arxiv.org/abs/2502.09142",
    trigger: "routine" as const,
    sizeBytes: 1363,
  },
  {
    topic: "pinescript",
    title: "2026-05-09-htf-context-streaming",
    relativePath: "Atlas additions/2026-05-09-htf-context-streaming.md",
    sourceUrl: "https://arxiv.org/abs/2503.01788",
    trigger: "routine" as const,
    sizeBytes: 1178,
  },
  {
    topic: "pinescript",
    title: "2026-05-09-confluence-scoring-bayesian",
    relativePath: "Atlas additions/2026-05-09-confluence-scoring-bayesian.md",
    sourceUrl: "https://arxiv.org/abs/2503.04210",
    trigger: "routine" as const,
    sizeBytes: 1536,
  },
  {
    topic: "pinescript",
    title: "2026-05-09-barstate-optimization-flux",
    relativePath: "Atlas additions/2026-05-09-barstate-optimization-flux.md",
    sourceUrl: "https://flux.dev/blog/barstate-perf-2026",
    trigger: "routine" as const,
    sizeBytes: 1309,
  },
];

async function main() {
  console.log(`→ Seeding ${PROD_URL}`);

  // Topics
  for (const name of TOPICS) {
    const id = await client.mutation(api.log.upsertTopic, { name });
    console.log(`✓ Topic upserted: ${name} (${id})`);
    await client.mutation(api.log.bumpTopic, { name, addedPapers: name === "pinescript" ? 4 : 0 });
  }

  // Vault additions
  for (const add of HISTORICAL_ADDITIONS) {
    await client.mutation(api.log.logVaultAddition, add);
    console.log(`✓ Addition: ${add.title}`);
  }

  // Tool calls — note: ts is set automatically; we can't backdate via mutation, so all show as "now"
  // For the demo, this is acceptable — recent activity is more compelling anyway.
  for (const tc of HISTORICAL_TOOL_CALLS) {
    await client.mutation(api.log.logToolCall, {
      tool: tc.tool,
      args: tc.args,
      durationMs: tc.durationMs,
      source: tc.source,
    });
  }
  console.log(`✓ ${HISTORICAL_TOOL_CALLS.length} tool calls logged`);

  console.log("\n🟢 Seed complete. Dashboard at https://flexible-panther-60.convex.cloud");
}

main().catch((err) => {
  console.error("✗ Seed failed:", err);
  process.exit(1);
});
