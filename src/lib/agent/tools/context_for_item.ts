import { z } from "zod";
import type { ToolDefinition } from "@/lib/agent/types";

const args = z
  .object({
    id: z.string().uuid().optional(),
    ticket_number: z.number().int().optional(),
  })
  .refine((v) => v.id != null || typeof v.ticket_number === "number", {
    message: "Provide `id` or `ticket_number`.",
  });

type Args = z.infer<typeof args>;

interface LinkedSource {
  source_type?: string | null;
  source_thread_id?: string | null;
  source_label?: string | null;
}

export const context_for_item: ToolDefinition<Args, unknown> = {
  name: "context_for_item",
  description:
    "Hydrate every linked source for one S2D item in one round-trip: Gmail / Slack threads, Linear issues, Fireflies meetings, and calendar events. Pulls the full message body of each linked thread, not just the preview.\n\nUse when: you need to answer 'what is this item really about?' or 'why is it open?' — anything that requires reading the underlying conversation, not just the item row. Example: { ticket_number: 1408 }.\n\nDo NOT use to fetch just the S2D row (call get_item). Do NOT call repeatedly for the same item in a turn — it hits multiple sources.\n\nReturns: { item, sources[] }. Each source has hydrated messages / issue / meeting / event payloads. Empty sources when no provider links were captured.",
  ring: "read",
  args,
  handler: async (input, ctx) => {
    let q = ctx.supabase
      .from("s2d_items")
      .select("*")
      .eq("user_id", ctx.userId)
      .limit(1);
    if (input.id) q = q.eq("id", input.id);
    else if (typeof input.ticket_number === "number")
      q = q.eq("ticket_number", input.ticket_number);

    const { data: item, error } = await q.maybeSingle();
    if (error) throw error;
    if (!item) return { item: null, sources: [] };

    const sources: Array<{
      source_type: string;
      source_thread_id: string;
      source_label: string | null;
    }> = [];
    if (item.source_type && item.source_thread_id) {
      sources.push({
        source_type: item.source_type,
        source_thread_id: item.source_thread_id,
        source_label: item.source_label,
      });
    }
    for (const ls of (item.linked_sources ?? []) as LinkedSource[]) {
      if (!ls.source_type || !ls.source_thread_id) continue;
      if (
        sources.some(
          (s) =>
            s.source_type === ls.source_type &&
            s.source_thread_id === ls.source_thread_id
        )
      )
        continue;
      sources.push({
        source_type: ls.source_type,
        source_thread_id: ls.source_thread_id,
        source_label: ls.source_label ?? null,
      });
    }

    const hydrated = await Promise.all(
      sources.map(async (s) => {
        if (s.source_type === "gmail" || s.source_type === "slack") {
          const { data } = await ctx.supabase
            .from("messages")
            .select(
              "sender_name, sender_email, subject, preview, full_content, received_at, channel"
            )
            .eq("user_id", ctx.userId)
            .eq("source", s.source_type)
            .eq("thread_id", s.source_thread_id)
            .order("received_at", { ascending: true });
          return { ...s, messages: data ?? [] };
        }
        if (s.source_type === "linear") {
          const { data } = await ctx.supabase
            .from("linear_issues")
            .select("title, status, description, assignee_name, url")
            .eq("user_id", ctx.userId)
            .eq("external_id", s.source_thread_id)
            .maybeSingle();
          return { ...s, issue: data ?? null };
        }
        if (s.source_type === "fireflies") {
          const { data: m } = await ctx.supabase
            .from("meetings")
            .select("id, title, date, summary, attendees")
            .eq("user_id", ctx.userId)
            .eq("external_id", s.source_thread_id)
            .maybeSingle();
          let actionItems: unknown[] = [];
          if (m?.id) {
            const { data: ai } = await ctx.supabase
              .from("action_items")
              .select("description, assignee, status")
              .eq("user_id", ctx.userId)
              .eq("source_meeting_id", m.id);
            actionItems = ai ?? [];
          }
          return { ...s, meeting: m ?? null, action_items: actionItems };
        }
        if (s.source_type === "calendar") {
          const { data } = await ctx.supabase
            .from("calendar_events")
            .select(
              "title, description, start_at, end_at, attendees, location, meeting_url"
            )
            .eq("user_id", ctx.userId)
            .eq("external_id", s.source_thread_id)
            .maybeSingle();
          return { ...s, event: data ?? null };
        }
        return { ...s, raw: null };
      })
    );

    return { item, sources: hydrated };
  },
};
