import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";
import { anthropic, MODELS } from "@/lib/anthropic/client";
import { sanitizeForAITells } from "@/lib/anthropic/sanitize";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { TOOL_REGISTRY_LIST } from "@/lib/agent/registry";
import { appendMessage, loadThread } from "@/lib/agent/threads";
import type { AnyToolDefinition, CursorContext, ToolRing } from "@/lib/agent/types";
import { serializeCursor } from "@/lib/agent/cursor-context";
import { recordAction, type ReverseOp } from "@/lib/agent/undo";
import {
  awaitApprovalDecision,
  createPendingApproval,
} from "@/lib/agent/approval";
import { compactThreadIfNeeded } from "@/lib/agent/compact";

/**
 * Mashi Agent — read-only loop (Phase 2).
 *
 * Streams a single user turn through Claude with the read-tool catalogue
 * exposed. On every assistant `tool_use` block the loop dispatches to
 * the registry's handler and feeds the result back as a `tool_result`
 * input message, then re-streams. Loops until the model emits a final
 * text-only stop reason, then persists the turn to agent_messages.
 *
 * Phase 3 will widen this to ring 2 (audit + undo) and Phase 5 to
 * ring 3 (approval gate). The `toolRings` option controls which rings
 * are exposed on a given turn — Phase 2 callers pass ["read"] only.
 *
 * The model is `MODELS.primary` (Opus). The thread + summary preamble
 * keeps the prompt bounded; full-conversation compaction lands in
 * Phase 6.
 */

export type AgentDelta =
  | { kind: "text"; text: string }
  | { kind: "tool_call_start"; id: string; name: string }
  | { kind: "tool_call_args"; id: string; args: unknown }
  | { kind: "tool_call_result"; id: string; ok: boolean; result?: unknown; error?: string }
  | {
      kind: "undoable";
      /** Undo action id (agent_actions.id). Posted to /api/agent/undo
       * by the in-chat undo strip. */
      token: string;
      summary: string;
      /** Wall-clock expiry of the undo window (server-stamped). */
      expiresAt: string;
      /** Which tool emitted this, so the UI can correlate to the
       * collapsed tool row in the timeline. */
      toolName: string;
    }
  | {
      kind: "approval-needed";
      /** Anthropic tool_use_id — the client POSTs to
       * /approvals/[callId] with this. */
      id: string;
      name: string;
      args: unknown;
      /** Server-stamped expiry (~5 min). After this the loop returns a
       * synthetic error to the model. */
      expiresAt: string;
    }
  | {
      kind: "approval-resolved";
      /** Mirrors the id of the approval-needed delta. */
      id: string;
      outcome: "approve" | "edit" | "cancel" | "expired";
    }
  | { kind: "done" }
  | { kind: "error"; message: string };

export interface RunAgentTurnOpts {
  threadId: string;
  userId: string;
  userMessage: string;
  cursor: CursorContext;
  onDelta: (delta: AgentDelta) => void;
  /** Default ["read"]. Phase 3+ surfaces add "write_mashi" / "write_world". */
  toolRings?: ToolRing[];
  /** Default MODELS.primary. */
  modelKey?: keyof typeof MODELS;
  /** Cap total tool round-trips per turn. Default 6. */
  maxIterations?: number;
}

interface AnthropicToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

function defToAnthropicTool(def: AnyToolDefinition): AnthropicToolDef {
  // zod v4 ships native JSON-schema conversion. We strip the outer
  // `$schema` key because Anthropic's input_schema expects a draft-07
  // shape, and `additionalProperties: false` is fine to keep — it's
  // the validator's hint that no extra keys are allowed.
  let jsonSchema: Record<string, unknown>;
  try {
    jsonSchema = z.toJSONSchema(def.args as z.ZodType) as Record<string, unknown>;
  } catch {
    jsonSchema = { type: "object" };
  }
  delete (jsonSchema as { $schema?: unknown }).$schema;
  // Anthropic requires the top-level schema to be an object.
  if (jsonSchema.type !== "object") {
    jsonSchema = { type: "object", properties: {} };
  }
  return {
    name: def.name,
    description: def.description,
    input_schema: jsonSchema,
  };
}

function buildSystemPrompt(opts: {
  cursor: CursorContext;
  threadTitle: string | null;
  threadSummary: string | null;
}): string {
  const lines: string[] = [];
  lines.push(
    "You are Mashi, the user's executive-function agent. You read the user's structured board, conversations, and calendar, and answer with concrete references."
  );
  lines.push(
    "Style: warm, energetic, casual. Never use em-dashes or en-dashes; use commas or rephrase. Be concise. Reference items by MASH-N when possible."
  );
  lines.push(
    "When the user says 'this' or 'that' without naming an item, infer from the cursor context below. If unsure, ask."
  );
  lines.push(
    "Reference resolution: if the user names an item without a ticket id (e.g. 'the brand spend thing'), call resolve_reference first. If 0 candidates come back, ask the user to be more specific. If exactly 1 candidate with confidence >= 0.8, proceed with that item. If multiple candidates or any low-confidence result, list the candidates back to the user and let them pick before acting."
  );
  lines.push(
    "Orphan threads: if this conversation has no item binding yet (Spotlight chat), once the user confirms an item, call attach_thread_to_item so subsequent turns are anchored to it."
  );
  lines.push(
    "External writes (send_email, draft_email, send_slack_message, create_calendar_event, create_linear_issue, etc.) pause for explicit user approval before firing. Before calling one of these, briefly tell the user what you're about to send so the approval card lands in context. If a call comes back with `edited: true` and `edited_args`, re-issue the tool with the edited arguments (do not call any other tool first). If a ring-3 call returns `user cancelled` or `approval window expired`, acknowledge it and ask what they'd like instead. Linear: call list_linear_teams first to pick the right team_id; never invent one."
  );
  lines.push("");
  lines.push("# Cursor context");
  lines.push(serializeCursor(opts.cursor));
  if (opts.threadTitle) {
    lines.push("");
    lines.push("# Thread");
    lines.push(`title: ${opts.threadTitle}`);
  }
  if (opts.threadSummary) {
    lines.push("");
    lines.push("# Prior-conversation summary");
    lines.push(opts.threadSummary);
  }
  return lines.join("\n");
}

interface ReplayBlock {
  role: "user" | "assistant";
  content: Anthropic.Messages.MessageParam["content"];
}

function messagesToReplay(
  rows: Array<{
    role: string;
    content: string | null;
    tool_calls: unknown;
    tool_results: unknown;
  }>
): ReplayBlock[] {
  // Reconstruct the Anthropic-shaped message list from persisted rows.
  // - role=user  → content text
  // - role=assistant with tool_calls → array of text + tool_use blocks
  // - role=tool                       → user message with tool_result blocks
  // - role=system                     → skip; system prompt is rebuilt fresh
  const out: ReplayBlock[] = [];
  for (const row of rows) {
    if (row.role === "system") continue;
    if (row.role === "user") {
      if (row.content && row.content.trim().length > 0) {
        out.push({ role: "user", content: row.content });
      }
      continue;
    }
    if (row.role === "assistant") {
      const blocks: Array<
        | { type: "text"; text: string }
        | { type: "tool_use"; id: string; name: string; input: unknown }
      > = [];
      if (row.content && row.content.length > 0) {
        blocks.push({ type: "text", text: row.content });
      }
      if (Array.isArray(row.tool_calls)) {
        for (const tc of row.tool_calls as Array<{
          id: string;
          name: string;
          input: unknown;
        }>) {
          blocks.push({
            type: "tool_use",
            id: tc.id,
            name: tc.name,
            input: tc.input,
          });
        }
      }
      if (blocks.length > 0) {
        out.push({
          role: "assistant",
          content: blocks as unknown as ReplayBlock["content"],
        });
      }
      continue;
    }
    if (row.role === "tool") {
      if (!Array.isArray(row.tool_results)) continue;
      const blocks = (row.tool_results as Array<{
        tool_use_id: string;
        content: string;
        is_error?: boolean;
      }>).map((r) => ({
        type: "tool_result" as const,
        tool_use_id: r.tool_use_id,
        content: r.content,
        is_error: r.is_error ?? false,
      }));
      out.push({
        role: "user",
        content: blocks as unknown as ReplayBlock["content"],
      });
    }
  }
  return out;
}

export async function runAgentTurn(opts: RunAgentTurnOpts): Promise<void> {
  const supabase = createSupabaseServiceClient();
  const rings = new Set(opts.toolRings ?? ["read"]);
  const toolDefs = TOOL_REGISTRY_LIST.filter((d) => rings.has(d.ring));
  const anthropicTools = toolDefs.map(defToAnthropicTool);
  const toolMap = new Map(toolDefs.map((d) => [d.name, d]));

  // Persist the user message before we start streaming so a crash
  // mid-stream still leaves a recoverable thread.
  await appendMessage({
    userId: opts.userId,
    threadId: opts.threadId,
    role: "user",
    content: opts.userMessage,
    cursorContext: opts.cursor,
    supabase,
  });

  const { thread, messages } = await loadThread({
    userId: opts.userId,
    threadId: opts.threadId,
    limit: 60,
    supabase,
  });

  const systemPrompt = buildSystemPrompt({
    cursor: opts.cursor,
    threadTitle: thread?.title ?? null,
    threadSummary: thread?.summary ?? null,
  });

  const replay = messagesToReplay(messages);
  const messageList: Anthropic.Messages.MessageParam[] = replay.map((r) => ({
    role: r.role,
    content: r.content,
  }));

  const maxIters = Math.min(Math.max(opts.maxIterations ?? 6, 1), 12);
  const model = MODELS[opts.modelKey ?? "primary"];

  let safety = 0;
  while (safety < maxIters) {
    safety += 1;

    const stream = anthropic.messages.stream({
      model,
      system: systemPrompt,
      messages: messageList,
      max_tokens: 1024,
      tools: anthropicTools as unknown as Anthropic.Messages.Tool[],
    });

    // Live text + tool_use accumulators per content block index.
    const blockState = new Map<
      number,
      | { type: "text"; text: string }
      | { type: "tool_use"; id: string; name: string; partialJson: string }
    >();

    try {
      for await (const event of stream) {
        if (event.type === "content_block_start") {
          if (event.content_block.type === "text") {
            blockState.set(event.index, { type: "text", text: "" });
          } else if (event.content_block.type === "tool_use") {
            blockState.set(event.index, {
              type: "tool_use",
              id: event.content_block.id,
              name: event.content_block.name,
              partialJson: "",
            });
            opts.onDelta({
              kind: "tool_call_start",
              id: event.content_block.id,
              name: event.content_block.name,
            });
          }
        } else if (event.type === "content_block_delta") {
          const state = blockState.get(event.index);
          if (!state) continue;
          if (event.delta.type === "text_delta" && state.type === "text") {
            const sanitized = sanitizeForAITells(event.delta.text);
            state.text += sanitized;
            if (sanitized.length > 0) {
              opts.onDelta({ kind: "text", text: sanitized });
            }
          } else if (
            event.delta.type === "input_json_delta" &&
            state.type === "tool_use"
          ) {
            state.partialJson += event.delta.partial_json;
          }
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "stream error";
      opts.onDelta({ kind: "error", message: msg });
      await appendMessage({
        userId: opts.userId,
        threadId: opts.threadId,
        role: "assistant",
        content: `[stream error] ${msg}`,
        supabase,
      });
      return;
    }

    const finalMsg = await stream.finalMessage();
    // Belt-and-suspenders sanitize: we already strip per-delta above,
    // but a final text block reassembled by the SDK may contain dashes
    // injected from a buffered delta. Strip again for safety.
    const assistantTextBlocks: string[] = [];
    const assistantToolCalls: Array<{
      id: string;
      name: string;
      input: unknown;
    }> = [];
    for (const block of finalMsg.content) {
      if (block.type === "text") {
        assistantTextBlocks.push(sanitizeForAITells(block.text));
      } else if (block.type === "tool_use") {
        assistantToolCalls.push({
          id: block.id,
          name: block.name,
          input: block.input,
        });
      }
    }
    const assistantText = assistantTextBlocks.join("\n");

    await appendMessage({
      userId: opts.userId,
      threadId: opts.threadId,
      role: "assistant",
      content: assistantText.length > 0 ? assistantText : null,
      toolCalls: assistantToolCalls.length > 0 ? assistantToolCalls : null,
      supabase,
    });

    // Push the assistant turn into the in-memory message list so the
    // next iteration sees it.
    messageList.push({
      role: "assistant",
      content: finalMsg.content as unknown as Anthropic.Messages.MessageParam["content"],
    });

    if (finalMsg.stop_reason !== "tool_use" || assistantToolCalls.length === 0) {
      break;
    }

    // Run every tool call, collect results, append a tool-result row,
    // and feed back to the model.
    const toolResults: Array<{
      tool_use_id: string;
      content: string;
      is_error: boolean;
    }> = [];
    for (const call of assistantToolCalls) {
      const def = toolMap.get(call.name);
      if (!def) {
        const error = `Unknown tool: ${call.name}`;
        toolResults.push({
          tool_use_id: call.id,
          content: JSON.stringify({ error }),
          is_error: true,
        });
        opts.onDelta({
          kind: "tool_call_result",
          id: call.id,
          ok: false,
          error,
        });
        continue;
      }
      opts.onDelta({ kind: "tool_call_args", id: call.id, args: call.input });
      try {
        // Ring 3 (write_world) gate: pause before any external call and
        // wait for the user's Approve / Edit / Cancel decision via the
        // approval channel. Edit returns a synthetic tool result so the
        // model re-issues the call with the edited args (intentional —
        // gives the user a second chance to approve the revision).
        // Cancel + Expired surface as synthetic errors so the model can
        // gracefully recover ("got it, want me to draft a different
        // version?"). Approve falls through to the normal arg-parse +
        // handler dispatch path below.
        let effectiveInput: unknown = call.input;
        if (def.ring === "write_world") {
          const pending = await createPendingApproval({
            userId: opts.userId,
            threadId: opts.threadId,
            callId: call.id,
            toolName: def.name,
            args: call.input,
            supabase,
          });
          opts.onDelta({
            kind: "approval-needed",
            id: call.id,
            name: def.name,
            args: call.input,
            expiresAt: pending.expiresAt,
          });
          const outcome = await awaitApprovalDecision({
            userId: opts.userId,
            threadId: opts.threadId,
            callId: call.id,
            supabase,
          });
          if (outcome.kind === "edit") {
            opts.onDelta({
              kind: "approval-resolved",
              id: call.id,
              outcome: "edit",
            });
            const synth = {
              ok: true,
              edited: true,
              edited_args: outcome.editedArgs,
              note: "User edited the call. Re-issue the tool with these arguments to seek a fresh approval.",
            };
            toolResults.push({
              tool_use_id: call.id,
              content: JSON.stringify(synth),
              is_error: false,
            });
            opts.onDelta({
              kind: "tool_call_result",
              id: call.id,
              ok: true,
              result: synth,
            });
            continue;
          }
          if (outcome.kind === "cancel" || outcome.kind === "expired") {
            opts.onDelta({
              kind: "approval-resolved",
              id: call.id,
              outcome: outcome.kind === "cancel" ? "cancel" : "expired",
            });
            const synth = {
              ok: false,
              error:
                outcome.kind === "cancel"
                  ? "user cancelled"
                  : "approval window expired",
            };
            try {
              await recordAction({
                userId: opts.userId,
                threadId: opts.threadId,
                toolName: def.name,
                ring: "write_world",
                args: call.input,
                result: synth,
                ok: false,
                supabase,
              });
            } catch {
              // best-effort
            }
            toolResults.push({
              tool_use_id: call.id,
              content: JSON.stringify(synth),
              is_error: true,
            });
            opts.onDelta({
              kind: "tool_call_result",
              id: call.id,
              ok: false,
              error: synth.error,
            });
            continue;
          }
          // outcome.kind === "approve" — fall through using original args.
          opts.onDelta({
            kind: "approval-resolved",
            id: call.id,
            outcome: "approve",
          });
          effectiveInput = outcome.args ?? call.input;
        }

        const parsed = def.args.safeParse(effectiveInput);
        if (!parsed.success) {
          throw new Error(
            `Invalid arguments: ${parsed.error.issues
              .map((i) => `${i.path.join(".")}: ${i.message}`)
              .join("; ")}`
          );
        }
        const result = await def.handler(parsed.data, {
          userId: opts.userId,
          supabase,
          origin: "session",
          threadId: opts.threadId,
        });

        // Ring 2 dispatch: peel off the private `_undo` channel,
        // persist the audit row, and emit an `undoable` delta the UI
        // can pin to the bottom of the thread. The model-facing
        // result excludes `_undo` so the agent never sees the
        // reverse-op payload.
        let modelResult: unknown = result;
        let undoInfo:
          | { summary: string; op: ReverseOp; ok: boolean }
          | null = null;
        const isObjectResult =
          result != null && typeof result === "object" && !Array.isArray(result);
        if (def.ring === "write_mashi" && isObjectResult) {
          const obj = result as Record<string, unknown> & {
            _undo?: { summary: string; op: ReverseOp };
            ok?: boolean;
          };
          const ok = obj.ok !== false;
          const { _undo, ...rest } = obj;
          modelResult = rest;
          if (ok && _undo) {
            undoInfo = { summary: _undo.summary, op: _undo.op, ok };
          }
          // Always audit a write_mashi attempt, undoable or not.
          const recorded = await recordAction({
            userId: opts.userId,
            threadId: opts.threadId,
            toolName: def.name,
            ring: "write_mashi",
            args: call.input,
            result: modelResult,
            ok,
            undoPayload: undoInfo?.op ?? null,
            undoSummary: undoInfo?.summary ?? null,
            supabase,
          });
          if (recorded.undoSummary && recorded.undoExpiresAt) {
            opts.onDelta({
              kind: "undoable",
              token: recorded.id,
              summary: recorded.undoSummary,
              expiresAt: recorded.undoExpiresAt,
              toolName: def.name,
            });
          }
        } else if (def.ring === "write_world") {
          // Ring 3 audit: every external write lands in agent_actions
          // with ring='write_world' and no undo_payload (irreversible
          // by design — they're explicitly approved, not optimistic).
          // Cancel / expired paths above already audit failures; this
          // branch only reaches here on approve.
          const ok =
            isObjectResult &&
            (result as { ok?: boolean }).ok !== false;
          try {
            await recordAction({
              userId: opts.userId,
              threadId: opts.threadId,
              toolName: def.name,
              ring: "write_world",
              args: effectiveInput,
              result: modelResult,
              ok,
              supabase,
            });
          } catch {
            // best-effort
          }
        }

        toolResults.push({
          tool_use_id: call.id,
          content: JSON.stringify(modelResult),
          is_error: false,
        });
        opts.onDelta({
          kind: "tool_call_result",
          id: call.id,
          ok: true,
          result: modelResult,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "tool failed";
        // Ring 2/3 failures land an audit row so the user can see what
        // was attempted; ring 1 failures stay in-band only.
        if (def.ring === "write_mashi" || def.ring === "write_world") {
          try {
            await recordAction({
              userId: opts.userId,
              threadId: opts.threadId,
              toolName: def.name,
              ring: def.ring,
              args: call.input,
              result: { error: message },
              ok: false,
              supabase,
            });
          } catch {
            // best-effort
          }
        }
        toolResults.push({
          tool_use_id: call.id,
          content: JSON.stringify({ error: message }),
          is_error: true,
        });
        opts.onDelta({
          kind: "tool_call_result",
          id: call.id,
          ok: false,
          error: message,
        });
      }
    }

    await appendMessage({
      userId: opts.userId,
      threadId: opts.threadId,
      role: "tool",
      toolResults,
      supabase,
    });

    messageList.push({
      role: "user",
      content: toolResults.map((r) => ({
        type: "tool_result" as const,
        tool_use_id: r.tool_use_id,
        content: r.content,
        is_error: r.is_error,
      })) as unknown as Anthropic.Messages.MessageParam["content"],
    });
  }

  opts.onDelta({ kind: "done" });

  // Phase 6: after the turn settles, compact the thread if it has
  // crossed the size threshold. Compaction itself is a no-op when the
  // thread is healthy. Fire-and-forget so we don't delay the user's
  // next interaction; we still await internally to surface errors in
  // server logs.
  try {
    await compactThreadIfNeeded({
      userId: opts.userId,
      threadId: opts.threadId,
      supabase,
    });
  } catch (err) {
    console.warn(
      "[agent] thread compaction failed:",
      err instanceof Error ? err.message : err
    );
  }
}
