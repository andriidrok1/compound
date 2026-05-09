import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

/**
 * Log an MCP tool call. Called from the MCP route handler.
 */
export const logToolCall = mutation({
  args: {
    tool: v.string(),
    args: v.string(),
    result: v.optional(v.string()),
    durationMs: v.optional(v.number()),
    isError: v.optional(v.boolean()),
    source: v.string(),
  },
  handler: async (ctx, args) => {
    return ctx.db.insert("tool_calls", {
      ...args,
      ts: Date.now(),
    });
  },
});

/**
 * Log a vault addition.
 */
export const logVaultAddition = mutation({
  args: {
    topic: v.string(),
    title: v.string(),
    relativePath: v.string(),
    sourceUrl: v.optional(v.string()),
    trigger: v.union(
      v.literal("routine"),
      v.literal("convex"),
      v.literal("telegram"),
      v.literal("manual"),
    ),
    sizeBytes: v.number(),
  },
  handler: async (ctx, args) => {
    return ctx.db.insert("vault_additions", {
      ...args,
      addedAt: Date.now(),
    });
  },
});

/**
 * Upsert topic — used when listing topics seeds the registry.
 */
export const upsertTopic = mutation({
  args: {
    name: v.string(),
    folder: v.optional(v.string()),
  },
  handler: async (ctx, { name, folder }) => {
    const existing = await ctx.db
      .query("topics")
      .withIndex("by_name", (q) => q.eq("name", name))
      .first();
    if (existing) return existing._id;
    return ctx.db.insert("topics", {
      name,
      folder,
      paperCount: 0,
      lastResearched: undefined,
    });
  },
});

/**
 * Bump topic counters when a paper is researched.
 */
export const bumpTopic = mutation({
  args: {
    name: v.string(),
    addedPapers: v.number(),
  },
  handler: async (ctx, { name, addedPapers }) => {
    const t = await ctx.db
      .query("topics")
      .withIndex("by_name", (q) => q.eq("name", name))
      .first();
    if (!t) return null;
    await ctx.db.patch(t._id, {
      paperCount: t.paperCount + addedPapers,
      lastResearched: Date.now(),
    });
    return t._id;
  },
});

// --- queries for the UI ---

export const recentToolCalls = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    return ctx.db
      .query("tool_calls")
      .withIndex("by_ts")
      .order("desc")
      .take(limit ?? 50);
  },
});

export const recentVaultAdditions = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    return ctx.db
      .query("vault_additions")
      .withIndex("by_addedAt")
      .order("desc")
      .take(limit ?? 20);
  },
});

export const allTopics = query({
  args: {},
  handler: async (ctx) => {
    return ctx.db.query("topics").collect();
  },
});

// --- vault_metadata ---

export const upsertVaultMetadata = mutation({
  args: {
    totalNotes: v.number(),
    folders: v.array(v.string()),
    topLinks: v.array(v.object({ name: v.string(), count: v.number() })),
    recentNotes: v.array(
      v.object({ title: v.string(), folder: v.string(), modifiedAt: v.number() }),
    ),
    detectedTopics: v.array(
      v.object({ name: v.string(), evidence: v.string(), priority: v.number() }),
    ),
  },
  handler: async (ctx, args) => {
    // Singleton — keep only the latest snapshot.
    const existing = await ctx.db.query("vault_metadata").collect();
    for (const e of existing) await ctx.db.delete(e._id);
    return ctx.db.insert("vault_metadata", { ...args, syncedAt: Date.now() });
  },
});

export const latestVaultMetadata = query({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("vault_metadata").collect();
    return all[0] ?? null;
  },
});
