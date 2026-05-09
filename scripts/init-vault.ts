/**
 * Sync the user's local Obsidian vault to Compound.
 *
 *  1. Walks the vault.
 *  2. Computes folder hierarchy, top wikilinks, recently-edited notes.
 *  3. Heuristically detects research topics (clusters of recent activity).
 *  4. Uploads the snapshot to Convex prod.
 *
 * Run: npm run init
 *
 * After this, Compound's overnight cron picks topics based on what you
 * are actually working on — not generic guesses.
 */
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import { listVaultNotes, extractWikilinks } from "../src/lib/vault";
import { promises as fs } from "fs";

// Always sync to production Convex — that's where the overnight cron lives.
const PROD_URL = process.env.CONVEX_PROD_URL || "https://flexible-panther-60.convex.cloud";
const RECENT_DAYS = 30;

interface RecentNote {
  title: string;
  folder: string;
  modifiedAt: number;
}

interface DetectedTopic {
  name: string;
  evidence: string;
  priority: number;
}

async function main() {
  console.log(`→ Scanning vault…`);
  const notes = await listVaultNotes();
  console.log(`✓ ${notes.length} markdown notes found`);

  // Folder hierarchy (excluding archive/templates/atlas)
  const SKIP_FOLDERS = new Set(["99-Archive", "_templates", "test", "Atlas additions"]);
  const folderSet = new Set<string>();
  for (const n of notes) {
    if (n.folder && !SKIP_FOLDERS.has(n.folder)) folderSet.add(n.folder);
  }
  const folders = [...folderSet].sort();

  // Wikilink frequencies
  const linkCount = new Map<string, number>();
  for (const n of notes) {
    for (const link of n.wikilinks) linkCount.set(link, (linkCount.get(link) ?? 0) + 1);
  }
  const topLinks = [...linkCount.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 30);

  // Recent notes — last 30 days, max 50 entries
  const since = Date.now() - RECENT_DAYS * 24 * 60 * 60 * 1000;
  const recent: RecentNote[] = [];
  for (const n of notes) {
    if (SKIP_FOLDERS.has(n.folder)) continue;
    try {
      const stat = await fs.stat(n.path);
      if (stat.mtimeMs >= since) {
        recent.push({
          title: n.title,
          folder: n.folder,
          modifiedAt: stat.mtimeMs,
        });
      }
    } catch {
      // skip
    }
  }
  recent.sort((a, b) => b.modifiedAt - a.modifiedAt);
  const recentTrimmed = recent.slice(0, 50);
  console.log(`✓ ${recentTrimmed.length} notes edited in last ${RECENT_DAYS} days`);

  // Detect topics
  const detectedTopics = detectTopics(folders, topLinks, recentTrimmed);
  console.log(`✓ ${detectedTopics.length} topics detected:`);
  for (const t of detectedTopics) {
    console.log(`   • ${t.name} (priority ${t.priority}) — ${t.evidence}`);
  }

  // Upload
  console.log(`\n→ Uploading to ${PROD_URL}`);
  const client = new ConvexHttpClient(PROD_URL);
  await client.mutation(api.log.upsertVaultMetadata, {
    totalNotes: notes.length,
    folders,
    topLinks,
    recentNotes: recentTrimmed,
    detectedTopics,
  });
  console.log(`🟢 Synced. Compound now knows your vault structure.`);
  console.log(`   Open dashboard: https://compound-ashen.vercel.app`);
}

/**
 * Detect topics from vault structure.
 * Heuristics:
 *  - Folder with 3+ recently-edited notes → topic with priority based on activity
 *  - Top wikilink referenced 10+ times → topic
 *  - MOC files (Map Of Content) → first-class topic
 */
function detectTopics(
  folders: string[],
  topLinks: { name: string; count: number }[],
  recent: RecentNote[],
): DetectedTopic[] {
  const topics: DetectedTopic[] = [];

  // 1. Folders with active editing
  const folderActivity = new Map<string, number>();
  for (const r of recent) folderActivity.set(r.folder, (folderActivity.get(r.folder) ?? 0) + 1);
  for (const [folder, count] of folderActivity) {
    if (count >= 3) {
      topics.push({
        name: cleanTopicName(folder),
        evidence: `${count} notes edited recently in ${folder}`,
        priority: Math.min(100, 50 + count * 3),
      });
    }
  }

  // 2. Hot wikilinks (concept-level topics)
  for (const link of topLinks.slice(0, 10)) {
    if (link.count >= 10 && !looksLikeMoc(link.name)) {
      topics.push({
        name: cleanTopicName(link.name),
        evidence: `referenced ${link.count}× across the vault`,
        priority: Math.min(100, 30 + link.count),
      });
    }
  }

  // 3. MOC files = explicit user topics
  for (const link of topLinks.slice(0, 20)) {
    if (looksLikeMoc(link.name)) {
      topics.push({
        name: cleanTopicName(link.name.replace(/MOC/i, "").trim()),
        evidence: `you maintain a MOC for this (${link.count} backlinks)`,
        priority: Math.min(100, 60 + link.count),
      });
    }
  }

  // De-duplicate by name (keep highest priority)
  const byName = new Map<string, DetectedTopic>();
  for (const t of topics) {
    const key = t.name.toLowerCase();
    if (!byName.has(key) || (byName.get(key)!.priority < t.priority)) {
      byName.set(key, t);
    }
  }
  return [...byName.values()].sort((a, b) => b.priority - a.priority).slice(0, 8);
}

function looksLikeMoc(name: string): boolean {
  return /\bMOC\b|moc$/i.test(name);
}

function cleanTopicName(s: string): string {
  return s
    .replace(/^\d+-/, "") // strip "50-Code" → "Code"
    .replace(/MOC$/i, "")
    .replace(/[#].*/, "")
    .trim()
    .toLowerCase();
}

main().catch((err) => {
  console.error("✗ Init failed:", err);
  process.exit(1);
});
