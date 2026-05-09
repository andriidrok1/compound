/**
 * Pull all Compound-generated vault_additions from Convex prod
 * and write them as real .md files to the local Obsidian vault.
 *
 * This is the missing piece for cloud → local sync.
 * Run periodically (e.g. on `git pull` style trigger), or on-demand.
 *
 * Usage: npx tsx --env-file=.env.local scripts/sync-from-convex.ts
 */
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import { promises as fs } from "fs";
import path from "path";

const PROD_URL = process.env.CONVEX_URL_OVERRIDE || "https://flexible-panther-60.convex.cloud";
const VAULT = process.env.OBSIDIAN_VAULT_PATH || "/home/andrii/Documents/Obsidian Vault";
const ATLAS_DIR = path.join(VAULT, "Atlas additions");

async function main() {
  console.log(`→ Pulling vault_additions from ${PROD_URL}`);
  await fs.mkdir(ATLAS_DIR, { recursive: true });

  const client = new ConvexHttpClient(PROD_URL);
  const additions: any[] = await client.query(api.log.recentVaultAdditions, { limit: 50 });

  let written = 0;
  let skipped = 0;

  for (const a of additions) {
    const filename = a.title.endsWith(".md") ? a.title : `${a.title}.md`;
    const target = path.join(ATLAS_DIR, filename);

    try {
      await fs.access(target);
      skipped += 1;
      continue; // already exists
    } catch {
      // doesn't exist, create
    }

    const content = renderNote(a);
    await fs.writeFile(target, content, "utf-8");
    written += 1;
    console.log(`  ✓ wrote ${filename}`);
  }

  console.log(`\n🟢 Sync done — ${written} new, ${skipped} already existed.`);
  console.log(`Open vault: ${ATLAS_DIR}`);
}

function renderNote(a: any): string {
  return [
    "---",
    `title: ${a.title}`,
    `topic: ${a.topic}`,
    `source: ${a.sourceUrl ?? "n/a"}`,
    `added_by: Compound`,
    `added_at: ${new Date(a.addedAt).toISOString()}`,
    `trigger: ${a.trigger}`,
    "---",
    "",
    `# ${a.title}`,
    "",
    `**Topic:** [[${a.topic}]]`,
    "",
    `**Trigger:** ${a.trigger}`,
    "",
    a.sourceUrl ? `**Source:** ${a.sourceUrl}` : "",
    "",
    `*Synced from Compound cloud (Convex) at ${new Date().toISOString()}.*`,
    "",
    `Open dashboard for full activity context: https://compound-ashen.vercel.app`,
  ]
    .filter(Boolean)
    .join("\n");
}

main().catch((err) => {
  console.error("✗ Sync failed:", err);
  process.exit(1);
});
