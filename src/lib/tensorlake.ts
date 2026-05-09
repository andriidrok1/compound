import { Sandbox } from "tensorlake";

export interface TopicState {
  topic: string;
  researched: { paperId: string; title: string; addedAt: number }[];
  runCount: number;
  lastRun: number;
}

const STATE_PATH = "/workspace/state.json";

/**
 * Sandbox name from topic. Tensorlake disallows colons; use hyphens.
 */
export function sandboxName(topic: string): string {
  return `compound-${topic.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
}

/**
 * Find or create a named sandbox per topic.
 * Resumes if suspended.
 */
export async function getTopicSandbox(topic: string): Promise<Sandbox> {
  const name = sandboxName(topic);

  const all = await Sandbox.list();
  const existing = all.find((sb) => sb.name === name);

  if (existing) {
    const sandbox = await Sandbox.connect({ sandboxId: existing.sandboxId });
    if (String(existing.status).toLowerCase() === "suspended") {
      await sandbox.resume();
    }
    return sandbox;
  }

  return Sandbox.create({
    name,
    cpus: 1.0,
    memoryMb: 1024,
    timeoutSecs: 600,
  });
}

/**
 * Load topic state from sandbox. Returns fresh state if none exists.
 */
export async function loadState(sandbox: Sandbox, topic: string): Promise<TopicState> {
  try {
    const bytes = await sandbox.readFile(STATE_PATH);
    const parsed = JSON.parse(new TextDecoder().decode(bytes));
    return parsed as TopicState;
  } catch {
    return {
      topic,
      researched: [],
      runCount: 0,
      lastRun: 0,
    };
  }
}

/**
 * Save state and suspend the sandbox.
 */
export async function saveStateAndSuspend(sandbox: Sandbox, state: TopicState): Promise<void> {
  await sandbox.writeFile(
    STATE_PATH,
    new TextEncoder().encode(JSON.stringify(state, null, 2)),
  );
  await sandbox.suspend();
}

/**
 * Convenience: do a stateful work cycle for a topic.
 *  - load existing state
 *  - run callback (which may push new researched items)
 *  - save + suspend
 */
export async function withTopicState<T>(
  topic: string,
  fn: (state: TopicState) => Promise<T>,
): Promise<T> {
  const sandbox = await getTopicSandbox(topic);
  const state = await loadState(sandbox, topic);
  state.runCount += 1;
  state.lastRun = Date.now();
  try {
    const result = await fn(state);
    await saveStateAndSuspend(sandbox, state);
    return result;
  } catch (err) {
    // still try to save partial progress
    try {
      await saveStateAndSuspend(sandbox, state);
    } catch {
      // ignore
    }
    throw err;
  }
}

/**
 * Mark paper as researched. Idempotent.
 */
export function recordResearched(state: TopicState, paperId: string, title: string): boolean {
  if (state.researched.some((r) => r.paperId === paperId)) return false;
  state.researched.push({ paperId, title, addedAt: Date.now() });
  return true;
}
