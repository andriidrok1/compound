import { execFile } from "child_process";
import { promisify } from "util";

const exec = promisify(execFile);

const NIA_BIN = "nia";

interface NiaSearchResult {
  content: string;
  source?: string;
  score?: number;
}

interface NiaResponse {
  results?: NiaSearchResult[];
  answer?: string;
  citations?: string[];
}

/**
 * Run a Nia CLI command, return stdout JSON or text.
 */
async function runNia(args: string[], timeoutMs = 60_000): Promise<string> {
  const { stdout } = await exec(NIA_BIN, args, {
    timeout: timeoutMs,
    maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, NO_COLOR: "1" },
  });
  return stdout;
}

/**
 * Search indexed local folders (Obsidian vault).
 */
export async function searchVault(query: string): Promise<NiaResponse> {
  const out = await runNia([
    "search",
    "query",
    query,
    "--search-mode",
    "sources",
    "--no-color",
  ]);
  return parseNiaOutput(out);
}

/**
 * Web search for arxiv papers / blogs.
 */
export async function searchWeb(query: string): Promise<NiaResponse> {
  const out = await runNia(["search", "web", query, "--no-color"]);
  return parseNiaOutput(out);
}

/**
 * Run Nia Oracle for autonomous multi-source research.
 * Heavy operation — uses oracle credit.
 */
export async function oracle(prompt: string): Promise<NiaResponse> {
  const out = await runNia(["oracle", prompt, "--no-color"], 300_000);
  return parseNiaOutput(out);
}

/**
 * Deep research — multi-step.
 */
export async function deepResearch(prompt: string): Promise<NiaResponse> {
  const out = await runNia(["search", "deep", prompt, "--no-color"], 300_000);
  return parseNiaOutput(out);
}

/**
 * List indexed sources.
 */
export async function listSources(): Promise<string> {
  return runNia(["local", "status", "--no-color"]);
}

/**
 * Best-effort parse: if output looks like YAML/structured, normalize.
 * Otherwise return raw answer.
 */
function parseNiaOutput(raw: string): NiaResponse {
  const trimmed = raw.trim();
  if (!trimmed) return { answer: "" };

  // Try JSON
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return JSON.parse(trimmed);
    } catch {
      // fall through
    }
  }

  // Heuristic: look for "results:" YAML-ish
  if (trimmed.startsWith("results:")) {
    // Convert simple "[N] content: ..." blocks
    const blocks = trimmed.split(/\n\s*\[\d+\]\s*\n/).slice(1);
    const results = blocks.map((b) => {
      const contentMatch = b.match(/content:\s*([\s\S]*?)(?=\n\s*\w+:|\n\s*\[\d+\]|$)/);
      return { content: (contentMatch?.[1] ?? b).trim() };
    });
    return { results };
  }

  return { answer: trimmed };
}
