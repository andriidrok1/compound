/**
 * Server-side Convex client for the MCP route handler.
 * Used to log tool calls and vault additions for the real-time dashboard.
 *
 * Defensive init: only creates client if URL is a valid http(s) URL.
 * Some build environments leak the env var name as a string when unset;
 * we filter those out so the build doesn't crash.
 */
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";

function isValidUrl(s: string | undefined): s is string {
  return !!s && /^https?:\/\//.test(s);
}

const url = process.env.NEXT_PUBLIC_CONVEX_URL;
const client: ConvexHttpClient | null = isValidUrl(url) ? new ConvexHttpClient(url) : null;

export async function logToolCall(args: {
  tool: string;
  args: unknown;
  result?: unknown;
  durationMs?: number;
  isError?: boolean;
  source?: string;
}) {
  if (!client) return;
  try {
    await client.mutation(api.log.logToolCall, {
      tool: args.tool,
      args: JSON.stringify(args.args ?? {}).slice(0, 4000),
      result: args.result !== undefined ? JSON.stringify(args.result).slice(0, 4000) : undefined,
      durationMs: args.durationMs,
      isError: args.isError,
      source: args.source ?? "routine",
    });
  } catch {
    // best-effort — don't break MCP if Convex is down
  }
}

export async function logVaultAddition(args: {
  topic: string;
  title: string;
  relativePath: string;
  sourceUrl?: string;
  trigger?: "routine" | "convex" | "telegram" | "manual";
  sizeBytes: number;
}) {
  if (!client) return;
  try {
    await client.mutation(api.log.logVaultAddition, {
      topic: args.topic,
      title: args.title,
      relativePath: args.relativePath,
      sourceUrl: args.sourceUrl,
      trigger: args.trigger ?? "routine",
      sizeBytes: args.sizeBytes,
    });
  } catch {
    // best-effort
  }
}
