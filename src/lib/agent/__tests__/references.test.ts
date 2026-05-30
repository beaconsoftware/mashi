/**
 * B2 (P3) — unit tests for the @-mention references pure module + replay
 * injection.
 *
 * Self-running assertion script (no framework, matching attachments.test.ts /
 * replay.test.ts). Runs with:
 *   pnpm test:references
 *
 * Covers the testable slice of the acceptance criteria:
 *   - sanitizeReferences drops malformed / non-item / dupe entries and caps
 *     the count (the server-side shape guard)
 *   - referenceLabel + referencesToPromptText emit the "already resolved,
 *     don't call resolve_reference" note naming each item
 *   - messagesToReplay prepends the note to a user row carrying references
 *     (with text, refs-only, and alongside attachments) and leaves a row
 *     with none untouched
 */
import {
  MAX_REFERENCES,
  referenceLabel,
  referencesToPromptText,
  sanitizeReferences,
  type AgentReference,
} from "@/lib/agent/references";
import { messagesToReplay } from "@/lib/agent/replay";

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

function ref(over: Partial<AgentReference> = {}): AgentReference {
  return {
    kind: "item",
    id: "item-1",
    label: "Approve Q4 brand spend",
    ticketNumber: 1408,
    ...over,
  };
}

function testSanitize() {
  console.log("sanitizeReferences");
  assert(sanitizeReferences(undefined).length === 0, "undefined → []");
  assert(sanitizeReferences("nope").length === 0, "non-array → []");
  assert(sanitizeReferences([{}]).length === 0, "missing id dropped");
  assert(
    sanitizeReferences([{ kind: "person", id: "p1", label: "x" }]).length === 0,
    "non-item kind dropped"
  );
  assert(
    sanitizeReferences([{ kind: "item", id: "x".repeat(200) }]).length === 0,
    "over-long id dropped"
  );

  const dupes = sanitizeReferences([
    { kind: "item", id: "a", label: "A", ticketNumber: 1 },
    { kind: "item", id: "a", label: "A again", ticketNumber: 1 },
  ]);
  assert(dupes.length === 1, "dupe ids collapsed");

  const noLabel = sanitizeReferences([{ kind: "item", id: "a" }]);
  assert(
    noLabel.length === 1 && noLabel[0].label === "item",
    "missing label defaults to 'item'"
  );
  const noTicket = sanitizeReferences([{ kind: "item", id: "a", label: "A" }]);
  assert(noTicket[0].ticketNumber === null, "missing ticket → null");

  const longLabel = sanitizeReferences([
    { kind: "item", id: "a", label: "z".repeat(500) },
  ]);
  assert(longLabel[0].label.length === 256, "label sliced to 256");

  const many = sanitizeReferences(
    Array.from({ length: MAX_REFERENCES + 5 }, (_, i) => ({
      kind: "item",
      id: `id-${i}`,
      label: `L${i}`,
    }))
  );
  assert(many.length === MAX_REFERENCES, `capped at MAX_REFERENCES (${MAX_REFERENCES})`);
}

function testPromptText() {
  console.log("referenceLabel / referencesToPromptText");
  assert(
    referenceLabel(ref()) === 'MASH-1408 "Approve Q4 brand spend"',
    "label with ticket"
  );
  assert(
    referenceLabel(ref({ ticketNumber: null })) === '"Approve Q4 brand spend"',
    "label without ticket"
  );
  assert(referencesToPromptText([]) === "", "empty → empty string");

  const note = referencesToPromptText([ref(), ref({ id: "i2", label: "Other", ticketNumber: 902 })]);
  assert(note.includes("MASH-1408"), "note names the ticket");
  assert(note.includes("Approve Q4 brand spend"), "note names the title");
  assert(note.includes("item id item-1"), "note carries the item id");
  assert(
    /do NOT call resolve_reference/i.test(note),
    "note instructs not to call resolve_reference"
  );
}

function testReplayInjection() {
  console.log("messagesToReplay reference injection");

  // Refs + text → single string user message led by the note.
  const withText = messagesToReplay([
    {
      role: "user",
      content: "snooze it until Monday",
      tool_calls: null,
      tool_results: null,
      pinned_references: [ref()],
    },
  ]);
  assert(withText.length === 1, "one block emitted");
  const body = withText[0].content as string;
  assert(typeof body === "string", "plain-string user content");
  assert(
    body.startsWith("[Pinned references"),
    "note prepended before user text"
  );
  assert(body.includes("snooze it until Monday"), "user text preserved");

  // Refs only (no text) → still emits the note.
  const refsOnly = messagesToReplay([
    {
      role: "user",
      content: null,
      tool_calls: null,
      tool_results: null,
      pinned_references: [ref()],
    },
  ]);
  assert(
    refsOnly.length === 1 &&
      (refsOnly[0].content as string).includes("MASH-1408"),
    "refs-only row still carries the note"
  );

  // No refs → unchanged plain string.
  const noRefs = messagesToReplay([
    {
      role: "user",
      content: "hello",
      tool_calls: null,
      tool_results: null,
    },
  ]);
  assert(
    noRefs[0].content === "hello",
    "row without refs is the plain string (unchanged)"
  );

  // Refs + attachments → array content with the note as the trailing text.
  const withAttachments = messagesToReplay([
    {
      role: "user",
      content: "what is this",
      tool_calls: null,
      tool_results: null,
      attachments: [
        {
          kind: "image",
          storagePath: "u/a.png",
          mime: "image/png",
          name: "a.png",
          size: 10,
        },
      ],
      pinned_references: [ref()],
    },
  ]);
  const blocks = withAttachments[0].content as Array<{ type: string; text?: string }>;
  assert(Array.isArray(blocks), "attachment row content is an array");
  const textBlock = blocks.find((b) => b.type === "text");
  assert(
    !!textBlock && textBlock.text!.includes("[Pinned references"),
    "note rides in the trailing text block alongside attachments"
  );
  assert(
    !!textBlock && textBlock.text!.includes("what is this"),
    "user text preserved alongside attachments"
  );
}

console.log("\n=== references.test.ts ===\n");
testSanitize();
testPromptText();
testReplayInjection();

console.log(`\n${stats.pass} passed, ${stats.fail} failed\n`);
if (stats.fail > 0) process.exit(1);
