/**
 * Tool implementations used by both the MCP server and the Telegram bot.
 * Pure functions over vault, Nia, and Tensorlake.
 *
 * Tools degrade gracefully when filesystem is unavailable (e.g. Vercel cloud):
 * they fall back to Convex-backed state so the public MCP endpoint still works.
 */
import { extractTopics, findRelatedNotes, writeNote } from "./vault";
import { searchVault, searchWeb } from "./nia";
import { withTopicState, recordResearched } from "./tensorlake";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL;
const convexClient =
  CONVEX_URL && /^https?:\/\//.test(CONVEX_URL)
    ? new ConvexHttpClient(CONVEX_URL)
    : null;

async function topicsFromConvex(): Promise<{
  folders: string[];
  hotLinks: { name: string; count: number }[];
} | null> {
  if (!convexClient) return null;
  try {
    // Primary source: vault_metadata uploaded via Connect Vault
    const meta = await convexClient.query(api.log.latestVaultMetadata, {});
    if (meta) {
      return {
        folders: meta.folders ?? [],
        hotLinks: meta.topLinks ?? [],
      };
    }
    // Legacy fallback: manually-tracked topics table
    const all = await convexClient.query(api.log.allTopics, {});
    if (!all || all.length === 0) return null;
    return {
      folders: all.map((t) => t.name),
      hotLinks: all.map((t) => ({ name: t.name, count: t.paperCount })),
    };
  } catch {
    return null;
  }
}

export interface Paper {
  id: string;
  title: string;
  source: string;
  snippet: string;
}

export interface ResearchResult {
  topic: string;
  newPapers: Paper[];
  alreadyResearched: number;
  state: { runCount: number; total: number };
}

export interface AddNoteResult {
  path: string;
  topic: string;
  size: number;
}

export interface CrossRefResult {
  topic: string;
  paper: string;
  relatedNotes: { title: string; relativePath: string }[];
  synthesis: string;
}

/**
 * list_topics — return active topic candidates from vault.
 * Falls back to Convex-stored topics if filesystem is unavailable.
 */
export async function listTopics(): Promise<{
  folders: string[];
  hotLinks: { name: string; count: number }[];
}> {
  try {
    return await extractTopics();
  } catch {
    const fromConvex = await topicsFromConvex();
    if (fromConvex) return fromConvex;
    return { folders: [], hotLinks: [] };
  }
}

/**
 * Search OpenAlex — free public API, no auth, generous rate limits.
 * Returns recent papers matching the topic.
 */
async function openAlexSearch(topic: string, limit: number): Promise<Paper[]> {
  try {
    const url = `https://api.openalex.org/works?search=${encodeURIComponent(
      topic,
    )}&per_page=${limit * 2}&sort=publication_date:desc`;
    const resp = await fetch(url, {
      headers: { "User-Agent": "Compound/0.1 (mailto:hi@compound.dev)" },
    });
    if (!resp.ok) return [];
    const data: any = await resp.json();
    const papers: Paper[] = (data.results ?? []).slice(0, limit * 2).map((p: any) => ({
      id: hashId(p.id ?? p.title ?? ""),
      title: (p.title ?? "Untitled").slice(0, 200),
      source: p.doi ?? p.id ?? "openalex",
      snippet: (p.abstract_inverted_index ? reconstructAbstract(p.abstract_inverted_index) : "")
        .slice(0, 320),
    }));
    return papers;
  } catch {
    return [];
  }
}

/**
 * OpenAlex stores abstracts as an inverted index — reconstruct to plain text.
 */
function reconstructAbstract(inverted: Record<string, number[]>): string {
  const positions: { word: string; pos: number }[] = [];
  for (const [word, posList] of Object.entries(inverted)) {
    for (const pos of posList) positions.push({ word, pos });
  }
  positions.sort((a, b) => a.pos - b.pos);
  return positions.map((p) => p.word).join(" ");
}

/**
 * research_topic — find new papers for a topic, filtering against Tensorlake state.
 * Multi-source: Semantic Scholar (primary) + Nia web (secondary) + raw answer parsing.
 */
export async function researchTopic(topic: string, limit = 5): Promise<ResearchResult> {
  return withTopicState(topic, async (state) => {
    let candidates: Paper[] = [];

    // Primary: OpenAlex — free, no auth, no rate limit, works on Vercel
    candidates = await openAlexSearch(topic, limit);

    // Fallback: Nia web search (CLI-based, works locally)
    if (candidates.length === 0) {
      try {
        const q = `${topic} arxiv 2025 paper site:arxiv.org`;
        const webResp = await searchWeb(q);
        if (webResp.results && webResp.results.length > 0) {
          candidates = webResp.results.slice(0, limit * 2).map((r) => ({
            id: hashId(r.content ?? r.source ?? ""),
            title: deriveTitle(r.content ?? ""),
            source: r.source ?? "nia-web",
            snippet: (r.content ?? "").slice(0, 280),
          }));
        } else if (webResp.answer && webResp.answer.length > 50) {
          candidates = extractPapersFromAnswer(webResp.answer, limit * 2);
        }
      } catch {
        // continue with empty
      }
    }

    const seen = new Set(state.researched.map((r) => r.paperId));
    const newPapers = candidates.filter((p) => !seen.has(p.id)).slice(0, limit);
    const alreadyResearched = candidates.length - newPapers.length;

    for (const p of newPapers) {
      recordResearched(state, p.id, p.title);
    }

    return {
      topic,
      newPapers,
      alreadyResearched,
      state: { runCount: state.runCount, total: state.researched.length },
    };
  });
}

/**
 * Extract pseudo-papers from a free-text Nia answer.
 * Looks for blocks containing arxiv URLs or numbered items.
 */
function extractPapersFromAnswer(text: string, max: number): Paper[] {
  const blocks = text
    .split(/\n\n+|\n(?=\d+[\.)]\s|\*\s|\-\s)/)
    .map((b) => b.trim())
    .filter((b) => b.length > 30 && /https?:\/\//.test(b));

  return blocks.slice(0, max).map((block) => {
    const cleaned = block.replace(/^[\d\.\)\-\*\s]+/, "").trim();
    const urlMatch = cleaned.match(/https?:\/\/[^\s)]+/);
    const title = (cleaned.split("\n")[0] ?? cleaned).slice(0, 160).trim();
    return {
      id: hashId(title + (urlMatch?.[0] ?? "")),
      title,
      source: urlMatch?.[0] ?? "nia-web",
      snippet: cleaned.slice(0, 280),
    };
  });
}

/**
 * add_note_to_vault — write a markdown note in the Atlas additions folder.
 * On Vercel filesystem is read-only/unavailable: log the would-be write to Convex
 * so the dashboard still reflects the activity (demo mode).
 */
export async function addNoteToVault(
  filename: string,
  content: string,
  topic: string,
): Promise<AddNoteResult> {
  const safe = filename.replace(/[^\w\-\. ]/g, "-");
  try {
    const fullPath = await writeNote(safe, content);
    return { path: fullPath, topic, size: content.length };
  } catch {
    // filesystem unavailable — record the intent to Convex so UI updates anyway
    const virtualPath = `Atlas additions/${safe.endsWith(".md") ? safe : safe + ".md"}`;
    if (convexClient) {
      try {
        await convexClient.mutation(api.log.logVaultAddition, {
          topic,
          title: safe.replace(/\.md$/, ""),
          relativePath: virtualPath,
          trigger: "routine",
          sizeBytes: content.length,
        });
      } catch {
        // ignore
      }
    }
    return { path: virtualPath, topic, size: content.length };
  }
}

/**
 * cross_reference — surface vault notes that connect to a paper, plus synthesis.
 * Filesystem-free fallback: read recent vault additions from Convex.
 */
export async function crossReference(
  paperTitle: string,
  topic: string,
): Promise<CrossRefResult> {
  let related: { title: string; relativePath: string }[] = [];
  try {
    const found = await findRelatedNotes(topic);
    related = found.slice(0, 6).map((n) => ({
      title: n.title,
      relativePath: n.relativePath,
    }));
  } catch {
    // filesystem unavailable — fall back to recent Convex additions for this topic
    if (convexClient) {
      try {
        const recent = await convexClient.query(api.log.recentVaultAdditions, { limit: 6 });
        related = recent
          .filter((r) => r.topic === topic)
          .slice(0, 6)
          .map((r) => ({ title: r.title, relativePath: r.relativePath }));
      } catch {
        related = [];
      }
    }
  }

  let synthesis = "";
  try {
    const resp = await searchVault(
      `Synthesize how "${paperTitle}" connects to my notes about "${topic}". Cite specific notes if relevant.`,
    );
    synthesis = resp.answer ?? (resp.results?.[0]?.content ?? "");
  } catch {
    synthesis = "";
  }

  return {
    topic,
    paper: paperTitle,
    relatedNotes: related,
    synthesis: synthesis.slice(0, 1200),
  };
}

// --- helpers ---

function hashId(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h) ^ s.charCodeAt(i);
  }
  return `n${(h >>> 0).toString(36)}`;
}

function deriveTitle(content: string): string {
  const first = content.split("\n").find((l) => l.trim().length > 0) ?? "";
  return first.replace(/^#+\s*/, "").slice(0, 120) || "untitled";
}
