/**
 * Offline embedder for the agent tool registry.
 *
 * Reads TOOL_REGISTRY_LIST, embeds each tool's `description` via the
 * OpenAI embeddings API, writes `src/lib/agent/tools/_embeddings.json`
 * as the runtime cache. Requires OPENAI_API_KEY in the environment.
 *
 * The embeddings ride into `retrieveTools()` (src/lib/agent/retrieve.ts)
 * which embeds the user's message at request time and returns the top-K
 * tools by cosine similarity. Massive token + accuracy win vs shipping
 * every tool every turn (Phase 6 of the agent quality upgrade).
 *
 * Run:
 *   pnpm embed-tools                — regenerate the cache.
 *   pnpm embed-tools --check        — exit non-zero if the cache is stale
 *                                     (any tool added, removed, or its
 *                                     description rewritten). Does NOT
 *                                     hit the model — purely a hash
 *                                     check, so CI can run it without
 *                                     hitting the OpenAI API.
 *
 * Output schema (versioned so a future model swap can invalidate):
 *
 *   {
 *     "model": "text-embedding-3-small",
 *     "dimensions": 1536,
 *     "generatedAt": "2026-05-28T...",
 *     "tools": {
 *       "<tool_name>": {
 *         "descriptionHash": "<sha256>",
 *         "embedding": [number, ...]
 *       }
 *     }
 *   }
 *
 * `descriptionHash` is a sha256 of the description text. The `--check`
 * path recomputes hashes from the live registry and compares — any
 * mismatch / missing / extra entry fails. The full embedder regenerates
 * the file from scratch on a successful run so the on-disk shape
 * always reflects the current registry exactly.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";

import { TOOL_REGISTRY_LIST } from "../src/lib/agent/registry";
import { EMBEDDING_MODEL, embedRemoteBatch } from "../src/lib/embeddings/openai";

const EMBEDDINGS_PATH = resolve(
  process.cwd(),
  "src/lib/agent/tools/_embeddings.json"
);

interface EmbeddingEntry {
  descriptionHash: string;
  embedding: number[];
}

interface EmbeddingsFile {
  model: string;
  dimensions: number;
  generatedAt: string;
  tools: Record<string, EmbeddingEntry>;
}

function hashDescription(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function loadExisting(): EmbeddingsFile | null {
  try {
    return JSON.parse(readFileSync(EMBEDDINGS_PATH, "utf8")) as EmbeddingsFile;
  } catch {
    return null;
  }
}

function expectedHashes(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const def of TOOL_REGISTRY_LIST) {
    out[def.name] = hashDescription(def.description);
  }
  return out;
}

function diffStale(): { stale: boolean; reasons: string[] } {
  const expected = expectedHashes();
  const existing = loadExisting();
  if (!existing) {
    return {
      stale: true,
      reasons: [`${EMBEDDINGS_PATH} is missing — run \`pnpm embed-tools\`.`],
    };
  }
  if (existing.model !== EMBEDDING_MODEL) {
    return {
      stale: true,
      reasons: [
        `Embedding model changed (${existing.model} → ${EMBEDDING_MODEL}). Regenerate.`,
      ],
    };
  }
  const reasons: string[] = [];
  for (const name of Object.keys(expected)) {
    const entry = existing.tools[name];
    if (!entry) {
      reasons.push(`Missing embedding for tool: ${name}`);
      continue;
    }
    if (entry.descriptionHash !== expected[name]) {
      reasons.push(
        `Stale embedding for tool: ${name} (description changed since last embed)`
      );
    }
  }
  for (const name of Object.keys(existing.tools)) {
    if (!expected[name]) {
      reasons.push(`Stale embedding for removed tool: ${name}`);
    }
  }
  return { stale: reasons.length > 0, reasons };
}

async function regenerate(): Promise<void> {
  console.log(
    `[embed-tools] embedding ${TOOL_REGISTRY_LIST.length} tools with ${EMBEDDING_MODEL}...`
  );
  const texts = TOOL_REGISTRY_LIST.map((d) => d.description);
  const vectors = await embedRemoteBatch(texts);
  if (vectors.length !== TOOL_REGISTRY_LIST.length) {
    throw new Error(
      `embedder returned ${vectors.length} vectors for ${TOOL_REGISTRY_LIST.length} tools`
    );
  }
  const dimensions = vectors[0]?.length ?? 0;
  const tools: Record<string, EmbeddingEntry> = {};
  TOOL_REGISTRY_LIST.forEach((def, i) => {
    tools[def.name] = {
      descriptionHash: hashDescription(def.description),
      embedding: vectors[i],
    };
  });
  const out: EmbeddingsFile = {
    model: EMBEDDING_MODEL,
    dimensions,
    generatedAt: new Date().toISOString(),
    tools,
  };
  writeFileSync(EMBEDDINGS_PATH, JSON.stringify(out, null, 2) + "\n", "utf8");
  console.log(
    `[embed-tools] wrote ${EMBEDDINGS_PATH} (${TOOL_REGISTRY_LIST.length} tools, ${dimensions}d)`
  );
}

async function main(): Promise<void> {
  const checkOnly = process.argv.includes("--check");
  if (checkOnly) {
    const { stale, reasons } = diffStale();
    if (stale) {
      console.error("[embed-tools] embeddings cache is STALE:");
      for (const r of reasons) console.error("  - " + r);
      console.error("\nRun: pnpm embed-tools");
      process.exit(1);
    }
    console.log(
      `[embed-tools] cache fresh (${TOOL_REGISTRY_LIST.length} tools).`
    );
    return;
  }
  await regenerate();
}

main().catch((err) => {
  console.error("[embed-tools] failed:", err);
  process.exit(1);
});
