import { promises as fs } from "fs";
import path from "path";

const VAULT_PATH = process.env.OBSIDIAN_VAULT_PATH ?? "/home/andrii/Documents/Obsidian Vault";
const ATLAS_FOLDER = "Atlas additions";

export interface VaultNote {
  path: string;       // absolute
  relativePath: string;
  title: string;      // filename without .md
  folder: string;     // top-level folder
  wikilinks: string[];
  preview: string;    // first 200 chars
}

/**
 * Recursively walks vault, returns all .md notes (excluding hidden dirs and node_modules).
 */
export async function listVaultNotes(rootPath = VAULT_PATH): Promise<VaultNote[]> {
  const notes: VaultNote[] = [];

  async function walk(dir: string) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        try {
          const content = await fs.readFile(full, "utf-8");
          const relativePath = path.relative(rootPath, full);
          const folder = relativePath.split(path.sep)[0] ?? "";
          notes.push({
            path: full,
            relativePath,
            title: entry.name.replace(/\.md$/, ""),
            folder,
            wikilinks: extractWikilinks(content),
            preview: content.slice(0, 200).replace(/\n/g, " "),
          });
        } catch {
          // skip unreadable
        }
      }
    }
  }

  await walk(rootPath);
  return notes;
}

/**
 * Extract `[[wikilinks]]` from markdown.
 */
export function extractWikilinks(md: string): string[] {
  const re = /\[\[([^\]|]+)(\|[^\]]+)?\]\]/g;
  const out = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(md))) {
    out.add(m[1].trim());
  }
  return [...out];
}

/**
 * Heuristic topic extraction:
 *  - top-level folders (excluding archive/templates)
 *  - most-frequent wikilinks across vault (top 10)
 */
export async function extractTopics(rootPath = VAULT_PATH): Promise<{
  folders: string[];
  hotLinks: { name: string; count: number }[];
}> {
  const notes = await listVaultNotes(rootPath);

  const folderSet = new Set<string>();
  const linkCount = new Map<string, number>();

  for (const note of notes) {
    if (note.folder && !["99-Archive", "_templates", "test", ATLAS_FOLDER].includes(note.folder)) {
      folderSet.add(note.folder);
    }
    for (const link of note.wikilinks) {
      linkCount.set(link, (linkCount.get(link) ?? 0) + 1);
    }
  }

  const hotLinks = [...linkCount.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  return { folders: [...folderSet].sort(), hotLinks };
}

/**
 * Append a Compound-generated note to the Atlas additions folder.
 */
export async function writeNote(filename: string, content: string, rootPath = VAULT_PATH): Promise<string> {
  const dir = path.join(rootPath, ATLAS_FOLDER);
  await fs.mkdir(dir, { recursive: true });
  const safe = filename.replace(/[\/\\:]/g, "-");
  const target = path.join(dir, safe.endsWith(".md") ? safe : `${safe}.md`);
  await fs.writeFile(target, content, "utf-8");
  return target;
}

/**
 * Find vault notes whose title or wikilink mentions the topic (case-insensitive).
 */
export async function findRelatedNotes(topic: string, rootPath = VAULT_PATH): Promise<VaultNote[]> {
  const notes = await listVaultNotes(rootPath);
  const t = topic.toLowerCase();
  return notes.filter(
    (n) =>
      n.title.toLowerCase().includes(t) ||
      n.wikilinks.some((l) => l.toLowerCase().includes(t)) ||
      n.relativePath.toLowerCase().includes(t),
  );
}
