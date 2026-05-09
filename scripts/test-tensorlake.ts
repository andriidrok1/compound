import { Sandbox } from "tensorlake";

if (!process.env.TENSORLAKE_API_KEY) {
  console.error("✗ TENSORLAKE_API_KEY missing");
  process.exit(1);
}
console.log(`✓ Key loaded (length=${process.env.TENSORLAKE_API_KEY.length})`);

const TOPIC = "compound-test";

async function main() {
  // Check if exists via list
  console.log("→ Listing sandboxes...");
  const all = await Sandbox.list();
  const existing = all.find((sb) => sb.name === TOPIC);

  let sandbox;
  if (existing) {
    console.log(`✓ Found existing ${existing.sandboxId} (${existing.status}) — connecting...`);
    sandbox = await Sandbox.connect({ sandboxId: existing.sandboxId });
    if (String(existing.status).toLowerCase() === "suspended") {
      await sandbox.resume();
      console.log("✓ Resumed");
    }
  } else {
    console.log("→ Creating new named sandbox...");
    sandbox = await Sandbox.create({
      name: TOPIC,
      cpus: 1.0,
      memoryMb: 1024,
      timeoutSecs: 600,
    });
    console.log(`✓ Created sandbox ${sandbox.sandboxId}`);
  }

  // Read existing state
  let state: { researched: string[]; runCount: number } = { researched: [], runCount: 0 };
  try {
    const bytes = await sandbox.readFile("/workspace/state.json");
    state = JSON.parse(new TextDecoder().decode(bytes));
    console.log(`✓ Loaded prior state: runCount=${state.runCount}, researched=${state.researched.length}`);
  } catch {
    console.log("→ No prior state, fresh start");
  }

  // Mutate
  state.runCount += 1;
  state.researched.push(`paper-${Date.now()}`);

  await sandbox.writeFile(
    "/workspace/state.json",
    new TextEncoder().encode(JSON.stringify(state, null, 2)),
  );
  console.log(`✓ Wrote state (runCount=${state.runCount}, researched=${state.researched.length})`);

  await sandbox.suspend();
  console.log("✓ Suspended");

  console.log("\n🟢 M1 PASS — named sandbox + persistent state working");
}

main().catch((err) => {
  console.error("✗ FAIL:", err.message ?? err);
  if (err.statusCode) console.error("   status:", err.statusCode);
  process.exit(1);
});
