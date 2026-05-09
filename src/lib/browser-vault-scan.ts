"use client";

/**
 * Client-side vault scanner using the File System Access API.
 * Reads markdown files in-browser, extracts metadata, returns it for upload.
 *
 * Privacy: file contents never leave the browser — only aggregated metadata.
 */

export interface VaultScanResult {
  totalNotes: number;
  folders: string[];
  topLinks: { name: string; count: number }[];
  recentNotes: { title: string; folder: string; modifiedAt: number }[];
  detectedTopics: { name: string; evidence: string; priority: number }[];
}

interface NoteInfo {
  title: string;
  folder: string;
  wikilinks: string[];
  modifiedAt: number;
}

const SKIP = new Set(["99-Archive", "_templates", "test", "Atlas additions", ".obsidian", ".trash"]);
const RECENT_MS = 30 * 24 * 60 * 60 * 1000;

export async function pickAndScanVault(): Promise<VaultScanResult> {
  // @ts-ignore — File System Access API
  const dirHandle: FileSystemDirectoryHandle = await window.showDirectoryPicker({
    id: "obsidian-vault",
    mode: "read",
  });

  const notes: NoteInfo[] = [];
  await walk(dirHandle, "", notes);

  return computeMetadata(notes);
}

async function walk(
  dir: FileSystemDirectoryHandle,
  parentRel: string,
  notes: NoteInfo[],
): Promise<void> {
  // @ts-ignore
  for await (const entry of dir.values()) {
    if (entry.name.startsWith(".") || SKIP.has(entry.name)) continue;
    const rel = parentRel ? `${parentRel}/${entry.name}` : entry.name;
    if (entry.kind === "directory") {
      await walk(entry, rel, notes);
    } else if (entry.kind === "file" && entry.name.endsWith(".md")) {
      try {
        // @ts-ignore
        const file: File = await entry.getFile();
        const text = await file.text();
        const folder = rel.split("/")[0] ?? "";
        notes.push({
          title: entry.name.replace(/\.md$/, ""),
          folder,
          wikilinks: extractWikilinks(text),
          modifiedAt: file.lastModified,
        });
      } catch {
        // skip unreadable
      }
    }
  }
}

function extractWikilinks(md: string): string[] {
  const re = /\[\[([^\]|]+)(\|[^\]]+)?\]\]/g;
  const out = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(md))) out.add(m[1].trim());
  return [...out];
}

function computeMetadata(notes: NoteInfo[]): VaultScanResult {
  const folderSet = new Set<string>();
  const linkCount = new Map<string, number>();
  const folderActivity = new Map<string, number>();
  const since = Date.now() - RECENT_MS;
  const recent: NoteInfo[] = [];

  for (const n of notes) {
    if (n.folder) folderSet.add(n.folder);
    for (const l of n.wikilinks) linkCount.set(l, (linkCount.get(l) ?? 0) + 1);
    if (n.modifiedAt >= since) {
      recent.push(n);
      folderActivity.set(n.folder, (folderActivity.get(n.folder) ?? 0) + 1);
    }
  }

  const folders = [...folderSet].sort();
  const topLinks = [...linkCount.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 30);

  recent.sort((a, b) => b.modifiedAt - a.modifiedAt);
  const recentNotes = recent.slice(0, 50).map((n) => ({
    title: n.title,
    folder: n.folder,
    modifiedAt: n.modifiedAt,
  }));

  // Topic detection
  const topics: { name: string; evidence: string; priority: number }[] = [];

  for (const [folder, count] of folderActivity) {
    if (count >= 3) {
      topics.push({
        name: cleanName(folder),
        evidence: `${count} notes edited recently in ${folder}`,
        priority: Math.min(100, 50 + count * 3),
      });
    }
  }

  for (const link of topLinks.slice(0, 10)) {
    if (looksLikeMoc(link.name)) {
      topics.push({
        name: cleanName(link.name.replace(/MOC/i, "").trim()),
        evidence: `you maintain a MOC for this (${link.count} backlinks)`,
        priority: Math.min(100, 60 + link.count),
      });
    } else if (link.count >= 10) {
      topics.push({
        name: cleanName(link.name),
        evidence: `referenced ${link.count}× across the vault`,
        priority: Math.min(100, 30 + link.count),
      });
    }
  }

  // De-dupe by name
  const byName = new Map<string, { name: string; evidence: string; priority: number }>();
  for (const t of topics) {
    const k = t.name.toLowerCase();
    if (!byName.has(k) || byName.get(k)!.priority < t.priority) byName.set(k, t);
  }
  const detectedTopics = [...byName.values()]
    .sort((a, b) => b.priority - a.priority)
    .slice(0, 8);

  return {
    totalNotes: notes.length,
    folders,
    topLinks,
    recentNotes,
    detectedTopics,
  };
}

function looksLikeMoc(s: string): boolean {
  return /\bMOC\b|moc$/i.test(s);
}

function cleanName(s: string): string {
  return s
    .replace(/^\d+-/, "")
    .replace(/MOC$/i, "")
    .replace(/[#].*/, "")
    .trim()
    .toLowerCase();
}

export function isFileSystemAccessSupported(): boolean {
  return typeof window !== "undefined" && "showDirectoryPicker" in window;
}
