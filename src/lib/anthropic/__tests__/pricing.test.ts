/**
 * A7 — model/pricing drift guard.
 *
 * Every model id referenced by `MODELS` must have a `PRICING` row. Without
 * this, bumping `MODELS.*` to a new model id (e.g. an Opus 4.8 id) without
 * adding the matching pricing entry makes `priceFor` fall through to the
 * all-zero default and silently log $0 cost for the dominant spend source.
 *
 * Self-running assertion script (no test framework, matching the convention
 * in replay.test.ts / hooks/__tests__/runner.test.ts). Runs with:
 *   pnpm test:pricing
 *
 * Acceptance criterion: removing a pricing row fails this test.
 */
import { MODELS } from "@/lib/anthropic/client";
import { PRICING } from "@/lib/anthropic/tracked";

const stats = { pass: 0, fail: 0 };

function assert(ok: boolean, label: string) {
  if (ok) {
    stats.pass += 1;
    console.log(`  ✓ ${label}`);
  } else {
    stats.fail += 1;
    console.error(`  ✗ ${label}`);
  }
}

function testEveryModelHasPricing() {
  console.log("every MODELS id has a PRICING row");
  for (const [tier, model] of Object.entries(MODELS)) {
    assert(
      Object.prototype.hasOwnProperty.call(PRICING, model),
      `MODELS.${tier} = "${model}" has a PRICING entry`
    );
  }
}

function testPricingRowsAreNonzero() {
  console.log("each MODELS pricing row charges nonzero input + output");
  for (const [tier, model] of Object.entries(MODELS)) {
    const p = PRICING[model];
    if (!p) continue; // already reported by the row-existence test above
    assert(
      p.input > 0 && p.output > 0,
      `MODELS.${tier} = "${model}" has nonzero input/output rates`
    );
  }
}

function main() {
  console.log("model/pricing drift guard\n");
  testEveryModelHasPricing();
  testPricingRowsAreNonzero();

  console.log(`\n${stats.pass} passed, ${stats.fail} failed`);
  if (stats.fail > 0) process.exit(1);
}

main();
