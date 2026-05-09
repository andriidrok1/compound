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
 * research_topic — find new papers for a topic, filtering against Tensorlake state.
 */
export async function researchTopic(topic: string, limit = 5): Promise<ResearchResult> {
  return withTopicState(topic, async (state) => {
    // Try Nia web search for fresh external content
    let candidates: Paper[] = [];
    try {
      const webResp = await searchWeb(`${topic} arxiv 2026`);
      if (webResp.results) {
        candidates = webResp.results.slice(0, limit * 2).map((r, i) => ({
          id: hashId(r.content),
          title: deriveTitle(r.content),
          source: r.source ?? "nia-web",
          snippet: (r.content ?? "").slice(0, 240),
        }));
      } else if (webResp.answer) {
        candidates = [
          {
            id: hashId(webResp.answer),
            title: `Web answer: ${topic}`,
            source: "nia-web",
            snippet: webResp.answer.slice(0, 240),
          },
        ];
      }
    } catch (err: any) {
      // continue with empty candidates if web search fails
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
