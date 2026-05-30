import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";
import { MODELS } from "@/lib/anthropic/client";
import { trackedStream } from "@/lib/anthropic/tracked";
import { sanitizeForAITells } from "@/lib/anthropic/sanitize";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { TOOL_REGISTRY } from "@/lib/agent/registry";
import { appendMessage, loadThread, releaseThreadTurn } from "@/lib/agent/threads";
import { messagesToReplay } from "@/lib/agent/replay";
import type { AnyToolDefinition, CursorContext, ToolRing } from "@/lib/agent/types";
import { serializeCursor } from "@/lib/agent/cursor-serialize";
import type { ReverseOp } from "@/lib/agent/undo";
import { compactThreadIfNeeded } from "@/lib/agent/compact";
import { HOOKS } from "@/lib/agent/hooks/registry";
import { runPostToolHooks, runPreToolHooks } from "@/lib/agent/hooks/runner";
import {
  calledToolNamesFromMessages,
  retrieveTools,
} from "@/lib/agent/retrieve";

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
  | {
      kind: "follow-up-question";
      /** Anthropic tool_use_id for ask_followup_question. The UI uses
       * this when POSTing the option click to the follow-up route, and
       * to dedupe a re-rendered card against a stream-emitted one. */
      id: string;
      question: string;
      /** 2-5 short option strings. Absent when the model asked an
       * open-ended question. */
      options?: string[];
    }
  | { kind: "done" }
  | { kind: "error"; message: string };

export type AgentMode = "plan" | "act";

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
  /**
   * Quality Phase 3: plan/act mode. In plan mode the toolset is filtered
   * down to ring="read" plus ask_followup_question regardless of what
   * toolRings the caller asked for, and the system prompt gains a
   * directive that the agent can't write. Default is whatever the
   * thread row says (act if not specified).
   */
  mode?: AgentMode;
  /**
   * A1 turn lock: the claim token the route obtained via claimThreadTurn
   * before starting this turn. When present, the loop releases the lock
   * in a finally so the thread frees up the moment the turn ends (or
   * throws). Absent for callers that don't take the lock.
   */
  turnId?: string;
}

interface AnthropicToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

function safeParseJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
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
  mode: AgentMode;
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
    "Before any write tool, you MUST be able to name (a) the exact target entity by its ID, (b) the user's intent in one sentence, (c) the success criterion. If any is uncertain, call ask_followup_question with 2-5 specific options. Do not call any tool to find out what the user meant — ask."
  );
  lines.push(
    "Orphan threads: if this conversation has no item binding yet (Spotlight chat), once the user confirms an item, call attach_thread_to_item so subsequent turns are anchored to it."
  );
  lines.push(
    "External writes (send_email, draft_email, send_slack_message, create_calendar_event, create_linear_issue, etc.) pause for explicit user approval before firing. Before calling one of these, briefly tell the user what you're about to send so the approval card lands in context. If a call comes back with `edited: true` and `edited_args`, re-issue the tool with the edited arguments (do not call any other tool first). If a ring-3 call returns `user cancelled` or `approval window expired`, acknowledge it and ask what they'd like instead. Linear: call list_linear_teams first to pick the right team_id; never invent one."
  );
  lines.push(
    "Email + Slack bodies: when the user asks about content of a message (what someone said, what they asked for, an amount, a date), call get_message_thread and read the `full_content` field, not the `preview`. Previews are truncated at 240 chars and routinely cut off mid-sentence."
  );
  if (opts.mode === "plan") {
    lines.push("");
    lines.push("# Mode");
    lines.push(
      "You are in PLAN mode. You can read sources and ask follow-up questions only. You cannot send messages, write to the board, snooze, decide, or take any action. Help the user decide what to do; they will switch to ACT mode to execute."
    );
  }
  lines.push("");
  lines.push("# Clarification");
  lines.push(
    "If the user references an entity ambiguously (e.g., 'the brand spend thing' matching multiple items), call resolve_reference first; if multiple candidates come back with confidence < 0.9, call ask_followup_question with the candidates as options. Never guess. Never run a write tool on a guess."
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

export async function runAgentTurn(opts: RunAgentTurnOpts): Promise<void> {
  const supabase = createSupabaseServiceClient();

  try {
    await runAgentTurnInner(opts, supabase);
  } finally {
    // A1: release the turn lock the moment the turn ends, whether it
    // completed, errored, or threw. Only clears the lock if we still own
    // it (releaseThreadTurn checks the token), so a TTL-reclaim by a
    // later turn is never clobbered.
    if (opts.turnId) {
      try {
        await releaseThreadTurn({
          userId: opts.userId,
          threadId: opts.threadId,
          turnId: opts.turnId,
          supabase,
        });
      } catch (err) {
        console.warn(
          "[agent] failed to release turn lock:",
          err instanceof Error ? err.message : err
        );
      }
    }
  }
}

async function runAgentTurnInner(
  opts: RunAgentTurnOpts,
  supabase: ReturnType<typeof createSupabaseServiceClient>
): Promise<void> {
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

  // Quality Phase 3: resolve mode (caller override > thread row > 'act').
  // The mode is persisted on agent_threads, so the loop's behavior follows
  // the toggle even when the caller forgets to pass it in. In plan mode
  // we filter the toolset down to read-only + ask_followup_question
  // regardless of what toolRings the caller asked for.
  const threadMode = ((thread as { mode?: unknown } | null)?.mode === "plan"
    ? "plan"
    : "act") as AgentMode;
  const mode: AgentMode = opts.mode ?? threadMode;

  // Quality Phase 6: per-turn tool retrieval. The candidate pool is
  // still bounded by mode (plan = read+ask) and the caller's rings, but
  // we then narrow further: always-on CORE_TOOLS ∪ sticky (tools
  // already called in this thread) ∪ top-K cosine-similar by user
  // message. Falls back to the full candidate pool on any embed
  // failure, so the agent never breaks if the local model can't load.
  const rings: ToolRing[] = opts.toolRings ?? ["read"];
  const calledThisThread = calledToolNamesFromMessages(messages);
  const toolDefs = await retrieveTools({
    userMessage: opts.userMessage,
    mode,
    rings,
    calledThisThread,
  });
  const anthropicTools = toolDefs.map(defToAnthropicTool);
  const toolMap = new Map(toolDefs.map((d) => [d.name, d]));

  const systemPrompt = buildSystemPrompt({
    cursor: opts.cursor,
    threadTitle: thread?.title ?? null,
    threadSummary: thread?.summary ?? null,
    mode,
  });

  const replay = messagesToReplay(messages);
  const messageList: Anthropic.Messages.MessageParam[] = replay.map((r) => ({
    role: r.role,
    content: r.content,
  }));

  // Quality Phase 5: MASHI.md per-user memory. Free-text the user
  // maintains in /settings/style. Injected as a user-role message after
  // the system prompt so directives ("call me Sidd", "I manage MPP")
  // persist across threads. Not persisted in agent_messages, so the
  // compaction summarizer never folds it away — it's re-read fresh
  // every turn. Cached as ephemeral so token cost only hits on change.
  const { data: profileRow } = await supabase
    .from("user_profile")
    .select("mashi_md")
    .eq("user_id", opts.userId)
    .maybeSingle();
  const mashiMd = ((profileRow as { mashi_md?: string } | null)?.mashi_md ?? "").trim();
  if (mashiMd.length > 0) {
    messageList.unshift({
      role: "user",
      content: [
        {
          type: "text",
          text: `# My MASHI.md\n\n${mashiMd}`,
          cache_control: { type: "ephemeral" },
        },
      ] as unknown as Anthropic.Messages.MessageParam["content"],
    });
  }

  const maxIters = Math.min(Math.max(opts.maxIterations ?? 6, 1), 12);
  const model = MODELS[opts.modelKey ?? "primary"];

  let safety = 0;
  while (safety < maxIters) {
    safety += 1;

    // A2: route every interactive model call through trackedStream so each
    // round-trip lands a row in ai_usage_log (purpose "agent:turn",
    // attributed to the user). The interactive loop is the dominant cost
    // (Opus, up to maxIters calls per user turn); leaving it on the raw
    // client meant the usage view silently under-reported. trackedStream
    // returns the same MessageStream the SDK does, so the async-iteration
    // and finalMessage() calls below are unchanged — it just awaits the
    // final message internally to log usage as a side effect.
    const stream = trackedStream(
      {
        model,
        system: systemPrompt,
        messages: messageList,
        max_tokens: 1024,
        tools: anthropicTools as unknown as Anthropic.Messages.Tool[],
      },
      "agent:turn",
      opts.userId
    );

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
    // Quality Phase 1: when ask_followup_question fires we break out of
    // the loop after this iteration so the model can't keep tool-calling
    // before the user replies. The follow-up card stays in the timeline;
    // the user's reply lands as the next user turn (either by clicking
    // an option or typing in the composer).
    let askedFollowUp = false;
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
      const toolCtx = {
        userId: opts.userId,
        supabase,
        origin: "session" as const,
        threadId: opts.threadId,
      };
      try {
        // Quality Phase 4: pre-tool hook chain. Replaces the inline
        // ring-3 approval, dedup, and any future gates. Hooks see the
        // call before the handler runs and can deny, ask a follow-up,
        // synthesize a tool_result directly (respond), or rewrite the
        // input — and optionally the tool — before dispatch.
        const pre = await runPreToolHooks({
          toolName: def.name,
          input: call.input,
          ring: def.ring,
          ctx: toolCtx,
          callId: call.id,
          hooks: HOOKS.preTool,
          emitFollowUp: (d) =>
            opts.onDelta({
              kind: "follow-up-question",
              id: d.id,
              question: d.question,
              options: d.options,
            }),
          emitApprovalNeeded: (d) =>
            opts.onDelta({
              kind: "approval-needed",
              id: d.id,
              name: d.name,
              args: d.args,
              expiresAt: d.expiresAt,
            }),
          emitApprovalResolved: (d) =>
            opts.onDelta({
              kind: "approval-resolved",
              id: d.id,
              outcome: d.outcome,
            }),
        });

        if (
          pre.decision.decision === "deny" ||
          pre.decision.decision === "respond"
        ) {
          const isError =
            pre.decision.decision === "deny"
              ? true
              : pre.decision.isError;
          const content =
            pre.decision.decision === "deny"
              ? JSON.stringify({ ok: false, error: pre.decision.message })
              : pre.decision.content;
          toolResults.push({
            tool_use_id: call.id,
            content,
            is_error: isError,
          });
          opts.onDelta({
            kind: "tool_call_result",
            id: call.id,
            ok: !isError,
            result: safeParseJson(content),
            error: isError && pre.decision.decision === "deny"
              ? pre.decision.message
              : undefined,
          });
          continue;
        }
        if (pre.decision.decision === "ask") {
          opts.onDelta({
            kind: "follow-up-question",
            id: call.id,
            question: pre.decision.message,
          });
          // Surface the message as a non-error tool_result so the loop
          // remains shape-consistent; the model will see the question
          // and the loop short-circuits below.
          toolResults.push({
            tool_use_id: call.id,
            content: JSON.stringify({
              ok: true,
              follow_up_question: pre.decision.message,
            }),
            is_error: false,
          });
          opts.onDelta({
            kind: "tool_call_result",
            id: call.id,
            ok: true,
            result: { follow_up_question: pre.decision.message },
          });
          askedFollowUp = true;
          continue;
        }

        // Allow / transform. Resolve the (possibly redirected) tool def.
        const effectiveDef =
          pre.effectiveToolName === def.name
            ? def
            : TOOL_REGISTRY[pre.effectiveToolName] ?? def;
        const effectiveInput = pre.effectiveInput;

        const parsed = effectiveDef.args.safeParse(effectiveInput);
        if (!parsed.success) {
          throw new Error(
            `Invalid arguments: ${parsed.error.issues
              .map((i) => `${i.path.join(".")}: ${i.message}`)
              .join("; ")}`
          );
        }
        const handlerResult = await effectiveDef.handler(parsed.data, toolCtx);

        // Structural: peel the private _undo channel so the model never
        // sees the reverse-op payload. The audit hook still reads
        // _undo from the original result via its own `result` arg.
        let modelResult: unknown = handlerResult;
        const isObjectResult =
          handlerResult != null &&
          typeof handlerResult === "object" &&
          !Array.isArray(handlerResult);
        if (effectiveDef.ring === "write_mashi" && isObjectResult) {
          const obj = handlerResult as Record<string, unknown> & {
            _undo?: { summary: string; op: ReverseOp };
          };
          const { _undo: _strippedUndo, ...rest } = obj;
          void _strippedUndo;
          modelResult = rest;
        }
        const ok = isObjectResult
          ? (handlerResult as { ok?: boolean }).ok !== false
          : true;

        await runPostToolHooks({
          toolName: effectiveDef.name,
          input: effectiveInput,
          result: handlerResult,
          ok,
          ring: effectiveDef.ring,
          ctx: toolCtx,
          hooks: HOOKS.postTool,
          emitUndoable: (d) =>
            opts.onDelta({
              kind: "undoable",
              token: d.token,
              summary: d.summary,
              expiresAt: d.expiresAt,
              toolName: d.toolName,
            }),
        });

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
        if (effectiveDef.name === "ask_followup_question") {
          const followUpArgs = parsed.data as {
            question: string;
            options?: string[];
          };
          opts.onDelta({
            kind: "follow-up-question",
            id: call.id,
            question: followUpArgs.question,
            options: followUpArgs.options,
          });
          askedFollowUp = true;
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "tool failed";
        // Audit thrown failures via the post-tool chain so the audit
        // hook captures them regardless of which ring fired.
        if (def.ring === "write_mashi" || def.ring === "write_world") {
          await runPostToolHooks({
            toolName: def.name,
            input: call.input,
            result: { error: message },
            ok: false,
            ring: def.ring,
            ctx: toolCtx,
            hooks: HOOKS.postTool,
          });
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

    if (askedFollowUp) break;
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
