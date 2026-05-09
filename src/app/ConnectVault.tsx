"use client";

import { useState } from "react";
import { useMutation, useAction } from "convex/react";
import { api } from "../../convex/_generated/api";
import {
  pickAndScanVault,
  isFileSystemAccessSupported,
  type VaultScanResult,
} from "@/lib/browser-vault-scan";

export default function ConnectVault() {
  const upload = useMutation(api.log.upsertVaultMetadata);
  const triggerResearch = useAction(api.agent.triggerResearch);
  const [status, setStatus] = useState<
    "idle" | "scanning" | "uploading" | "researching" | "done" | "error"
  >("idle");
  const [result, setResult] = useState<VaultScanResult | null>(null);
  const [error, setError] = useState<string>("");
  const [researchResult, setResearchResult] = useState<any>(null);
  const [running, setRunning] = useState(false);

  const supported = isFileSystemAccessSupported();

  const handleConnect = async () => {
    try {
      setError("");
      setStatus("scanning");
      const meta = await pickAndScanVault();
      setResult(meta);
      setStatus("uploading");
      await upload({
        totalNotes: meta.totalNotes,
        folders: meta.folders,
        topLinks: meta.topLinks,
        recentNotes: meta.recentNotes,
        detectedTopics: meta.detectedTopics,
      });
      // Auto-trigger first research so user sees Compound work immediately
      setStatus("researching");
      const r = await triggerResearch({});
      setResearchResult(r);
      setStatus("done");
    } catch (err: any) {
      if (err?.name === "AbortError") {
        setStatus("idle");
        return;
      }
      setError(err?.message ?? String(err));
      setStatus("error");
    }
  };

  const handleRunNow = async () => {
    setRunning(true);
    try {
      const r = await triggerResearch({});
      setResearchResult(r);
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setRunning(false);
    }
  };


  return (
    <section className="rounded-lg border border-violet-700/40 p-6 bg-violet-950/20 mb-8">
      <h2 className="text-lg font-semibold mb-1">Connect your Obsidian vault</h2>
      <p className="text-xs text-neutral-400 mb-4">
        Pick the folder where your `.md` notes live. Compound scans it locally in your browser
        (file contents never leave your machine — only structure metadata) and detects research
        topics from your activity.
      </p>

      {!supported && (
        <div className="text-sm text-amber-400 mb-3">
          Your browser doesn&apos;t support folder picking. Use Chrome, Edge, or Brave.
          Alternative: clone the repo and run <code className="text-xs bg-black/40 px-1 py-0.5 rounded">npm run init</code>.
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        <button
          onClick={handleConnect}
          disabled={!supported || status === "scanning" || status === "uploading" || status === "researching"}
          className="px-4 py-2 rounded bg-violet-600 hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed text-sm font-medium transition-colors"
        >
          {status === "idle" && "Connect Vault"}
          {status === "scanning" && "Scanning vault…"}
          {status === "uploading" && "Uploading metadata…"}
          {status === "researching" && "Running first research…"}
          {status === "done" && "✓ Connected — pick another"}
          {status === "error" && "Try again"}
        </button>

        {status === "done" && (
          <button
            onClick={handleRunNow}
            disabled={running}
            className="px-4 py-2 rounded border border-violet-700/50 hover:bg-violet-950/40 disabled:opacity-40 text-sm font-medium transition-colors"
          >
            {running ? "Researching 3 topics…" : "Run research now"}
          </button>
        )}
      </div>

      {error && <div className="text-sm text-red-400 mt-3">Error: {error}</div>}

      {result && status === "done" && (
        <div className="mt-5 grid md:grid-cols-2 gap-3 text-sm">
          <Stat label="Notes scanned" value={result.totalNotes} />
          <Stat label="Folders" value={result.folders.length} />
          <Stat label="Recent notes (30d)" value={result.recentNotes.length} />
          <Stat label="Topics detected" value={result.detectedTopics.length} />

          {result.detectedTopics.length > 0 && (
            <div className="md:col-span-2 mt-2">
              <div className="text-xs uppercase tracking-wider text-neutral-500 mb-2">
                Detected research topics
              </div>
              <ul className="space-y-1">
                {result.detectedTopics.map((t) => (
                  <li
                    key={t.name}
                    className="flex items-baseline gap-3 text-sm border-b border-neutral-800 pb-1.5"
                  >
                    <span className="font-medium">{t.name}</span>
                    <span className="text-xs text-neutral-500 flex-1">{t.evidence}</span>
                    <span className="text-xs text-violet-400 font-mono">p{t.priority}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="md:col-span-2 text-xs text-neutral-400 mt-2">
            🟢 Compound configured.
            {researchResult ? (
              <>
                {" "}
                First research run added{" "}
                <span className="text-violet-300 font-medium">
                  {researchResult.papersAdded ?? 0} papers
                </span>{" "}
                across{" "}
                <span className="text-violet-300">
                  {researchResult.topicsResearched?.length ?? 0} topics
                </span>{" "}
                ({researchResult.topicsResearched?.join(", ") ?? "—"}). Scroll down — dashboard
                reflects it now.
              </>
            ) : (
              " Tonight's cron at 03:00 SF will research your top 3 topics. Telegram check-in at 22:00."
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded border border-neutral-800 px-3 py-2 bg-neutral-950/50">
      <div className="text-[10px] uppercase tracking-wider text-neutral-500">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}
