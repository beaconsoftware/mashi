/**
 * B1 (P3) — unit tests for the attachments pure module + replay emission.
 *
 * Self-running assertion script (no framework, matching replay.test.ts /
 * provenance.test.ts). Runs with:
 *   pnpm test:attachments
 *
 * Covers the testable slice of the acceptance criteria:
 *   - mime classification + per-kind size validation
 *   - sanitizeAttachments drops foreign-prefix / oversized / wrong-type
 *     descriptors and caps the count (the server-side forgery guard)
 *   - placeholder block emission (image vs document, title on documents)
 *   - messagesToReplay emits placeholder blocks for a user row with
 *     attachments (with and without text) and keeps the plain-string form
 *     when there are none
 */
import {
  MAX_FILES,
  MAX_IMAGE_BYTES,
  attachmentToPlaceholderBlock,
  classifyMime,
  isMashiRefBlock,
  sanitizeAttachments,
  validateFile,
  type AttachmentDescriptor,
} from "@/lib/agent/attachments";
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

function desc(over: Partial<AttachmentDescriptor> = {}): AttachmentDescriptor {
  return {
    kind: "image",
    storagePath: "user-1/abc.png",
    mime: "image/png",
    name: "shot.png",
    size: 1234,
    ...over,
  };
}

function testClassify() {
  console.log("classifyMime");
  assert(classifyMime("image/png") === "image", "png is image");
  assert(classifyMime("application/pdf") === "document", "pdf is document");
  assert(classifyMime("text/csv") === "document", "csv is document");
  assert(classifyMime("application/zip") === null, "zip unsupported");
}

function testValidate() {
  console.log("validateFile");
  assert(validateFile({ mime: "image/png", size: 100 }).ok, "small png ok");
  assert(
    !validateFile({ mime: "image/png", size: MAX_IMAGE_BYTES + 1 }).ok,
    "oversized image rejected"
  );
  assert(!validateFile({ mime: "video/mp4", size: 1 }).ok, "video rejected");
}

function testSanitize() {
  console.log("sanitizeAttachments");
  const ok = sanitizeAttachments([desc()], { expectedPrefix: "user-1" });
  assert(ok.length === 1, "valid descriptor kept");

  const foreign = sanitizeAttachments(
    [desc({ storagePath: "user-2/abc.png" })],
    { expectedPrefix: "user-1" }
  );
  assert(foreign.length === 0, "foreign-prefix descriptor dropped");

  const oversized = sanitizeAttachments(
    [desc({ size: MAX_IMAGE_BYTES + 1 })],
    { expectedPrefix: "user-1" }
  );
  assert(oversized.length === 0, "oversized descriptor dropped");

  const badType = sanitizeAttachments([desc({ mime: "video/mp4" })], {
    expectedPrefix: "user-1",
  });
  assert(badType.length === 0, "wrong-type descriptor dropped");

  const many = sanitizeAttachments(
    Array.from({ length: MAX_FILES + 3 }, (_, i) =>
      desc({ storagePath: `user-1/f${i}.png` })
    ),
    { expectedPrefix: "user-1" }
  );
  assert(many.length === MAX_FILES, "count capped at MAX_FILES");

  assert(sanitizeAttachments("nope").length === 0, "non-array → empty");
}

function testPlaceholder() {
  console.log("attachmentToPlaceholderBlock");
  const img = attachmentToPlaceholderBlock(desc());
  assert(img.type === "image", "image block type");
  assert(isMashiRefBlock(img), "image block is a mashi_ref");
  assert(
    img.source.storagePath === "user-1/abc.png" && img.source.mime === "image/png",
    "image carries path + mime"
  );
  assert(img.title === undefined, "image has no title");

  const doc = attachmentToPlaceholderBlock(
    desc({ kind: "document", mime: "application/pdf", name: "deck.pdf", storagePath: "user-1/d.pdf" })
  );
  assert(doc.type === "document", "document block type");
  assert(doc.title === "deck.pdf", "document carries title");

  assert(!isMashiRefBlock({ type: "text", text: "hi" }), "text block isn't a ref");
}

function testReplayEmission() {
  console.log("messagesToReplay: attachments");

  const withBoth = messagesToReplay([
    {
      role: "user",
      content: "what is this",
      tool_calls: null,
      tool_results: null,
      attachments: [desc()],
    },
  ]);
  assert(withBoth.length === 1, "one replay block");
  assert(Array.isArray(withBoth[0].content), "content is an array");
  const blocks = withBoth[0].content as Array<{ type: string }>;
  assert(blocks.length === 2, "placeholder + text");
  assert(blocks[0].type === "image", "image placeholder first");
  assert(blocks[1].type === "text", "text last");

  const attachOnly = messagesToReplay([
    { role: "user", content: "", tool_calls: null, tool_results: null, attachments: [desc()] },
  ]);
  assert(attachOnly.length === 1, "attachment-only row still replays");
  assert(
    (attachOnly[0].content as Array<{ type: string }>).length === 1,
    "just the placeholder, no empty text block"
  );

  const textOnly = messagesToReplay([
    { role: "user", content: "hello", tool_calls: null, tool_results: null },
  ]);
  assert(textOnly[0].content === "hello", "no-attachment row keeps plain string");
}

function main() {
  console.log("B1 attachments\n");
  testClassify();
  testValidate();
  testSanitize();
  testPlaceholder();
  testReplayEmission();
  console.log(`\n${stats.pass} passed, ${stats.fail} failed`);
  if (stats.fail > 0) process.exit(1);
}

main();
