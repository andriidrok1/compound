/**
 * Tool implementations used by both the MCP server and the Telegram bot.
 * Pure functions over vault, Nia, and Tensorlake.
 */
import { extractTopics, findRelatedNotes, writeNote } from "./vault";
import { searchVault, searchWeb } from "./nia";
import { withTopicState, recordResearched } from "./tensorlake";

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
 */
export async function listTopics(): Promise<{
  folders: string[];
  hotLinks: { name: string; count: number }[];
}> {
  return extractTopics();
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
 */
export async function addNoteToVault(
  filename: string,
  content: string,
  topic: string,
): Promise<AddNoteResult> {
  const safe = filename.replace(/[^\w\-\. ]/g, "-");
  const fullPath = await writeNote(safe, content);
  return { path: fullPath, topic, size: content.length };
}

/**
 * cross_reference — surface vault notes that connect to a paper, plus synthesis.
 */
export async function crossReference(
  paperTitle: string,
  topic: string,
): Promise<CrossRefResult> {
  const related = await findRelatedNotes(topic);

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
    relatedNotes: related.slice(0, 6).map((n) => ({
      title: n.title,
      relativePath: n.relativePath,
    })),
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
