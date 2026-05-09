/**
 * Smoke test for the three core libs.
 * Run with: npx tsx --env-file=.env.local scripts/test-libs.ts
 */
import { extractTopics, listVaultNotes, findRelatedNotes, writeNote } from "../src/lib/vault";
import { searchVault } from "../src/lib/nia";
import { withTopicState, recordResearched } from "../src/lib/tensorlake";

async function main() {
  console.log("=== vault.ts ===");
  const notes = await listVaultNotes();
  console.log(`✓ ${notes.length} notes scanned`);

  const topics = await extractTopics();
  console.log(`✓ Folders: ${topics.folders.join(", ")}`);
  console.log(`✓ Hot links (top 5):`, topics.hotLinks.slice(0, 5));

  const related = await findRelatedNotes("liquidity");
  console.log(`✓ Notes related to "liquidity": ${related.length}`);
  related.slice(0, 3).forEach((n) => console.log(`   - ${n.relativePath}`));

  console.log("\n=== nia.ts ===");
  try {
    const niaResp = await searchVault("liquidity sweep");
    if (niaResp.results) {
      console.log(`✓ Nia returned ${niaResp.results.length} results`);
    } else if (niaResp.answer) {
      console.log(`✓ Nia answer length: ${niaResp.answer.length} chars`);
    } else {
      console.log("⚠ Nia returned empty");
    }
  } catch (e: any) {
    console.warn(`⚠ Nia error: ${e.message ?? e}`);
  }

  console.log("\n=== tensorlake.ts ===");
  const result = await withTopicState("pinescript-test", async (state) => {
    const wasNew = recordResearched(state, `paper-${Date.now()}`, "Test paper");
    return { runCount: state.runCount, totalResearched: state.researched.length, wasNew };
  });
  console.log(`✓ Topic state: runCount=${result.runCount}, researched=${result.totalResearched}, wasNew=${result.wasNew}`);

  console.log("\n=== writeNote ===");
  const testFile = await writeNote(
    `_test-compound-${Date.now()}.md`,
    `# Test Note\n\nWritten by smoke test at ${new Date().toISOString()}\n\nDelete me.\n`,
  );
  console.log(`✓ Test note written: ${testFile}`);

  console.log("\n🟢 All libs working");
}

main().catch((err) => {
  console.error("✗ FAIL:", err);
  process.exit(1);
});
