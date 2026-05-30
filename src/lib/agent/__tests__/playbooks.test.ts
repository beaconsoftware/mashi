/**
 * F2 (P6.b) — unit tests for the pure playbooks module.
 *
 * Self-running assertion script (no framework, matching memory.test.ts /
 * approval-meta.test.ts). Runs with:
 *   pnpm test:playbooks
 *
 * Covers the testable slice of the F2 acceptance criteria:
 *   - interpolate substitutes {{param}} values (and leaves unknowns visible)
 *   - validatePlaybookParams flags missing required params
 *   - buildPlaybookPrompt composes an ordered, parameter-honoring plan
 *   - validatePlaybookDraft enforces the bounds + normalizes a draft
 *   - slugify produces a stable lowercase slug
 *   - the built-in library is well-formed
 */
import {
  BUILTIN_PLAYBOOKS,
  buildPlaybookPrompt,
  interpolate,
  MAX_STEPS,
  slugify,
  validatePlaybookDraft,
  validatePlaybookParams,
  type Playbook,
} from "@/lib/agent/playbooks";

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

function testInterpolate() {
  console.log("interpolate");
  assert(
    interpolate("prep for {{subject}}", { subject: "Acme" }) === "prep for Acme",
    "substitutes a known param"
  );
  assert(
    interpolate("prep for {{ subject }}", { subject: "Acme" }) === "prep for Acme",
    "tolerates inner whitespace"
  );
  assert(
    interpolate("hi {{subject}}", { subject: "  Acme  " }) === "hi Acme",
    "trims the substituted value"
  );
  assert(
    interpolate("hi {{missing}}", {}) === "hi {{missing}}",
    "leaves unknown placeholders verbatim"
  );
  assert(
    interpolate("{{a}} and {{b}}", { a: "1", b: "2" }) === "1 and 2",
    "substitutes multiple params"
  );
}

function testValidateParams() {
  console.log("validatePlaybookParams");
  const pb = {
    params: [
      { key: "subject", label: "Subject", required: true },
      { key: "tone", label: "Tone", required: false },
    ],
  };
  assert(validatePlaybookParams(pb, { subject: "Acme" }).ok, "ok when required present");
  const missing = validatePlaybookParams(pb, { subject: "  " });
  assert(!missing.ok && missing.missing[0] === "subject", "flags blank required");
  assert(validatePlaybookParams({ params: [] }, {}).ok, "no params → ok");
}

function testBuildPrompt() {
  console.log("buildPlaybookPrompt");
  const pb: Playbook = {
    id: "x",
    slug: "x",
    name: "Deal prep",
    description: "",
    builtin: false,
    params: [{ key: "subject", label: "Company", required: true }],
    steps: ["Find everything about {{subject}}", "Draft a brief"],
  };
  const prompt = buildPlaybookPrompt(pb, { subject: "Acme" });
  assert(prompt.includes('Run the "Deal prep" playbook.'), "names the playbook");
  assert(prompt.includes("Company: Acme"), "lists filled parameter");
  assert(prompt.includes("1. Find everything about Acme"), "step 1 interpolated + numbered");
  assert(prompt.includes("2. Draft a brief"), "step 2 numbered");
  assert(/approval/i.test(prompt), "reminds about approval gates");
  // Steps appear in order.
  assert(
    prompt.indexOf("1. Find") < prompt.indexOf("2. Draft"),
    "steps are in order"
  );

  const noParams = buildPlaybookPrompt(
    { name: "Pulse", params: [], steps: ["List today", "Summarize Slack"] },
    {}
  );
  assert(!noParams.includes("Parameters:"), "omits the Parameters block when none filled");
}

function testValidateDraft() {
  console.log("validatePlaybookDraft");
  const good = validatePlaybookDraft({
    name: "  My playbook ",
    description: "does a thing",
    params: [{ key: "subject", label: "Subject", required: true }],
    steps: ["  step one ", "", "step two"],
  });
  assert(good.ok, "accepts a well-formed draft");
  if (good.ok) {
    assert(good.draft.name === "My playbook", "trims name");
    assert(good.draft.steps.length === 2, "drops blank steps");
    assert(good.draft.steps[0] === "step one", "trims steps");
    assert(good.draft.params[0].required === true, "carries required flag");
  }

  assert(!validatePlaybookDraft({ name: "", steps: ["x"] }).ok, "rejects empty name");
  assert(!validatePlaybookDraft({ name: "x", steps: [] }).ok, "rejects no steps");
  assert(
    !validatePlaybookDraft({
      name: "x",
      steps: Array.from({ length: MAX_STEPS + 1 }, (_, i) => `s${i}`),
    }).ok,
    "rejects too many steps"
  );
  assert(
    !validatePlaybookDraft({
      name: "x",
      steps: ["s"],
      params: [{ key: "1bad", label: "Bad" }],
    }).ok,
    "rejects an invalid param key"
  );
  assert(
    !validatePlaybookDraft({
      name: "x",
      steps: ["s"],
      params: [
        { key: "dup", label: "A" },
        { key: "dup", label: "B" },
      ],
    }).ok,
    "rejects duplicate param keys"
  );
}

function testSlugify() {
  console.log("slugify");
  assert(slugify("Monday Pulse") === "monday-pulse", "spaces to hyphens, lowercased");
  assert(slugify("  Deal / Prep!! ") === "deal-prep", "strips punctuation + edges");
  assert(slugify("***") === "", "all-punctuation → empty");
}

function testBuiltins() {
  console.log("BUILTIN_PLAYBOOKS");
  assert(BUILTIN_PLAYBOOKS.length >= 2, "ships at least two built-ins");
  const slugs = new Set<string>();
  let wellFormed = true;
  for (const pb of BUILTIN_PLAYBOOKS) {
    if (!pb.builtin) wellFormed = false;
    if (!pb.name || pb.steps.length === 0) wellFormed = false;
    if (slugs.has(pb.slug)) wellFormed = false;
    slugs.add(pb.slug);
    // Every {{param}} used in steps must be declared.
    const declared = new Set(pb.params.map((p) => p.key));
    for (const step of pb.steps) {
      const used = [...step.matchAll(/\{\{\s*([a-z][a-z0-9_]*)\s*\}\}/gi)].map(
        (m) => m[1]
      );
      for (const u of used) if (!declared.has(u)) wellFormed = false;
    }
  }
  assert(wellFormed, "every built-in is well-formed (builtin flag, steps, unique slug, declared params)");
}

console.log("\n=== playbooks ===");
testInterpolate();
testValidateParams();
testBuildPrompt();
testValidateDraft();
testSlugify();
testBuiltins();

console.log(`\n${stats.pass} passed, ${stats.fail} failed`);
if (stats.fail > 0) process.exit(1);
