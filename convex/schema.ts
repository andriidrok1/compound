import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // Active topics tracked by Compound (extracted from vault).
  topics: defineTable({
    name: v.string(),
    folder: v.optional(v.string()),
    sandboxId: v.optional(v.string()),
    lastResearched: v.optional(v.number()),
    paperCount: v.number(),
  }).index("by_name", ["name"]),

  // Notes added to the vault by Compound.
  vault_additions: defineTable({
    topic: v.string(),
    title: v.string(),
    relativePath: v.string(),
    sourceUrl: v.optional(v.string()),
    addedAt: v.number(),
    trigger: v.union(v.literal("routine"), v.literal("convex"), v.literal("telegram"), v.literal("manual")),
    sizeBytes: v.number(),
  }).index("by_topic", ["topic"]).index("by_addedAt", ["addedAt"]),

  // Every MCP tool call (drives the live activity feed in the dashboard).
  tool_calls: defineTable({
    tool: v.string(),
    args: v.string(), // JSON string for flexibility
    result: v.optional(v.string()),
    durationMs: v.optional(v.number()),
    isError: v.optional(v.boolean()),
    source: v.string(), // routine | telegram | manual | self
    ts: v.number(),
  }).index("by_ts", ["ts"]),

  // Telegram chat (optional — for the bot interface).
  telegram_messages: defineTable({
    chatId: v.number(),
    fromUser: v.optional(v.string()),
    text: v.string(),
    direction: v.union(v.literal("in"), v.literal("out")),
    ts: v.number(),
  }).index("by_chatId_ts", ["chatId", "ts"]),

  // Snapshot of the user's vault structure — uploaded by `npm run init`.
  // Drives intelligent topic picking and arxiv query construction.
  vault_metadata: defineTable({
    syncedAt: v.number(),
    totalNotes: v.number(),
    folders: v.array(v.string()),
    // Top wikilinks: ordered by reference count
    topLinks: v.array(v.object({ name: v.string(), count: v.number() })),
    // Recently-edited notes (last 30 days) — signals what the user is actively working on
    recentNotes: v.array(
      v.object({ title: v.string(), folder: v.string(), modifiedAt: v.number() }),
    ),
    // Detected research topics (smart heuristics)
    detectedTopics: v.array(
      v.object({
        name: v.string(),
        evidence: v.string(), // why this is a topic
        priority: v.number(), // 0..100
      }),
    ),
  }),
});
