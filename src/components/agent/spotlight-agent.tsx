"use client";

/**
 * Spotlight agent — Phase 4.
 *
 * ⌘+K opens a centered dialog with two tabs:
 *   - "Ask Mashi" (default) — orphan agent chat. The agent uses
 *     resolve_reference + attach_thread_to_item to bind the orphan
 *     thread to a board item mid-conversation.
 *   - "Search" — the previous keyword spotlight (S2D / Gmail / Slack /
 *     Linear / meetings / calendar), now embedded as a tab body.
 *
 * Stays mounted while the dialog is open; the orphan thread is created
 * lazily on the user's first message so opening the surface to glance
 * doesn't litter `agent_threads`.
 *
 * Routes through the same global ⌘+K hook the old spotlight used
 * (`useSpotlightModal`), so the keyboard shortcut keeps working with
 * no plumbing changes elsewhere.
 */

import { useCallback, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  Loader2,
  ListChecks,
  MessageSquareText,
  Search,
  Sparkles,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSpotlightModal } from "@/components/spotlight/spotlight-context";
import { SpotlightSearchPanel } from "@/components/spotlight/spotlight-modal";
import type { SpotlightHit } from "@/hooks/use-spotlight";
import { ThreadView } from "@/components/agent/thread-view";
import { useAgentThread } from "@/store/agent-thread-store";
import { useS2DStore } from "@/store/s2d-store";
import { AgentComposer } from "@/components/agent/composer";
import type { AttachmentDescriptor } from "@/lib/agent/attachments";
import type { AgentReference } from "@/lib/agent/references";
import { Button } from "@/components/ui/button";
import { Suggestion, Suggestions } from "@/components/ai-elements/suggestion";
import { PlaybooksTab } from "@/components/agent/playbooks-tab";

type SpotlightTab = "ask" | "search" | "playbooks";

// I6: the Spotlight empty state shows real, clickable suggestion chips
// (consistent with the item-bound thread), not a single italic example.
const SPOTLIGHT_SUGGESTIONS = [
  "what should I focus on today?",
  "what's blocked right now?",
  "summarize my unread Slack",
];

export function SpotlightAgent() {
  const { open, setOpen } = useSpotlightModal();
  const [tab, setTab] = useState<SpotlightTab>("ask");
  const router = useRouter();
  const pathname = usePathname();
  const setSelectedItem = useS2DStore((s) => s.setSelectedItem);

  // L1: open a board item from an interactive tool-result row — dismiss the
  // Spotlight, route to the board, and select the item so its sheet opens (the
  // same move the notification hub makes). On /s2d the board is already mounted,
  // so select immediately; off-board, defer a tick so the sheet has a board.
  const openBoardItem = useCallback(
    (id: string) => {
      setOpen(false);
      if (pathname !== "/s2d") {
        router.push("/s2d");
        setTimeout(() => setSelectedItem(id), 50);
      } else {
        setSelectedItem(id);
      }
    },
    [router, pathname, setSelectedItem, setOpen]
  );

  // Orphan thread id — created on first send. Stays null until the
  // user actually types something so empty dialog opens don't create
  // dead rows.
  const [orphanThreadId, setOrphanThreadId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  // F2 (P6.b): a composed playbook prompt waiting to seed a fresh thread.
  // Set when the user runs a playbook, consumed as ThreadView's initial
  // message once the orphan thread exists.
  const [seedMessage, setSeedMessage] = useState<string | null>(null);
  // When the agent binds the orphan to an item, swap the ThreadView
  // over to the item-bound endpoint by setting this and dropping the
  // dialog after a brief beat so the persistent Ask Mashi sheet can
  // take over.
  const openFor = useAgentThread((s) => s.openFor);

  // Reset state on close. Done via the Dialog's onOpenChange below
  // rather than an effect to keep React Compiler happy (cascading
  // setStates in effects are flagged).
  const reset = useCallback(() => {
    setOrphanThreadId(null);
    setCreating(false);
    setCreateError(null);
    setSeedMessage(null);
    setTab("ask");
  }, []);

  // Create the lazy orphan thread (shared by the Ask composer's first send
  // and the Playbooks "Run" action). Returns the new thread id or null.
  const createOrphan = useCallback(async () => {
    setCreating(true);
    setCreateError(null);
    try {
      const res = await fetch("/api/agent/threads/orphan", {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `create ${res.status}`);
      }
      const json = (await res.json()) as { thread: { id: string } };
      setOrphanThreadId(json.thread.id);
      return json.thread.id;
    } catch (err) {
      setCreateError(
        err instanceof Error ? err.message : "Couldn't open a new chat."
      );
      return null;
    } finally {
      setCreating(false);
    }
  }, []);

  // F2: run a playbook — open a seeded orphan thread on the Ask tab. The
  // composed prompt becomes ThreadView's initial message, which fires the
  // turn (ring-3 steps still pause for approval as usual).
  const handleRunPlaybook = useCallback(
    async (prompt: string) => {
      setSeedMessage(prompt);
      const id = await createOrphan();
      if (!id) {
        setSeedMessage(null);
        return;
      }
      setTab("ask");
    },
    [createOrphan]
  );

  const handleItemBound = useCallback(
    (itemId: string) => {
      // Close Spotlight, open the item-bound Ask Mashi sheet on the
      // same thread (now item-bound). The thread sheet finds the row
      // by item_id, which is the freshly-attached binding.
      setOpen(false);
      // Slight delay so Radix's Dialog close animation doesn't race
      // with the Sheet open animation.
      setTimeout(() => openFor(itemId), 120);
    },
    [setOpen, openFor]
  );

  // D4: open a thread picked from the Search tab's Conversations group.
  // Item-bound threads open the persistent Ask Mashi sheet (Spotlight
  // closes); orphan threads resume right here in the Ask tab.
  const handleConversation = useCallback(
    (hit: SpotlightHit) => {
      const thread = hit.thread;
      if (!thread) return;
      if (thread.itemId) {
        setOpen(false);
        setTimeout(() => openFor(thread.itemId!), 120);
      } else {
        // Resuming an existing thread — never carry a stale playbook seed.
        setSeedMessage(null);
        setOrphanThreadId(thread.threadId);
        setTab("ask");
      }
    },
    [setOpen, openFor]
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) reset();
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="top-[10vh] translate-y-0 gap-3 overflow-hidden p-0 sm:max-w-2xl"
      >
        <DialogHeader className="sr-only">
          <DialogTitle>Spotlight</DialogTitle>
          <DialogDescription>
            Ask Mashi a question or search across S2D, Gmail, Slack, Linear,
            meetings, and calendar.
          </DialogDescription>
        </DialogHeader>
        <Tabs
          value={tab}
          onValueChange={(v) => setTab(v as SpotlightTab)}
          className="gap-0"
        >
          <div className="flex items-center justify-between border-b border-border/40 bg-card/95 px-3 py-2">
            <TabsList variant="animated" className="h-7 gap-2">
              <TabsTrigger value="ask" className="px-2 text-xs">
                <Sparkles className="h-3 w-3 text-primary" />
                Ask Mashi
              </TabsTrigger>
              <TabsTrigger value="search" className="px-2 text-xs">
                <Search className="h-3 w-3" />
                Search
              </TabsTrigger>
              <TabsTrigger value="playbooks" className="px-2 text-xs">
                <ListChecks className="h-3 w-3" />
                Playbooks
              </TabsTrigger>
            </TabsList>
            <span className="font-mono text-[10px] text-muted-foreground/80">
              ⌘K
            </span>
          </div>
          <TabsContent value="ask" className="m-0">
            <div className="flex h-[60vh] min-h-0 flex-col gap-2 bg-card p-3">
              <AskMashiTab
                threadId={orphanThreadId}
                creating={creating}
                error={createError}
                seedMessage={seedMessage}
                onResumeOrphan={(id) => {
                  setSeedMessage(null);
                  setOrphanThreadId(id);
                }}
                onCreate={createOrphan}
                onItemBound={handleItemBound}
                onOpenItem={openBoardItem}
              />
            </div>
          </TabsContent>
          <TabsContent value="search" className="m-0">
            <SpotlightSearchPanel
              onPicked={() => setOpen(false)}
              onConversation={handleConversation}
            />
          </TabsContent>
          <TabsContent value="playbooks" className="m-0">
            <div className="flex h-[60vh] min-h-0 flex-col bg-card p-3">
              <PlaybooksTab onRun={handleRunPlaybook} running={creating} />
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Ask-Mashi tab body. Lazy-creates the orphan thread on first send so
 * empty dialog opens don't litter agent_threads. Once the orphan
 * exists we hand off to the same `<ThreadView>` the item-bound sheet
 * uses, parametrized by threadId instead of itemId.
 */
interface RecentThread {
  id: string;
  title: string;
  item_id: string | null;
  ticket_number: number | null;
  last_message_at: string | null;
  created_at: string;
  is_orphan: boolean;
}

function AskMashiTab({
  threadId,
  creating,
  error,
  seedMessage,
  onCreate,
  onItemBound,
  onResumeOrphan,
  onOpenItem,
}: {
  threadId: string | null;
  creating: boolean;
  error: string | null;
  /** F2: a composed playbook prompt to send as the thread's first message. */
  seedMessage?: string | null;
  onCreate: () => Promise<string | null>;
  onItemBound: (itemId: string) => void;
  onResumeOrphan: (threadId: string) => void;
  /** L1: open a board item from an interactive tool-result row. */
  onOpenItem: (itemId: string) => void;
}) {
  const openFor = useAgentThread((s) => s.openFor);
  const [sending, setSending] = useState(false);
  // First message the user typed on this empty Spotlight session.
  // Once the orphan row is created we hand this down to ThreadView,
  // which fires the actual send (optimistic bubble + streaming) so the
  // user sees their message land instead of staring at an empty thread
  // while a parallel POST drains in the background. The previous
  // implementation POSTed here AND mounted ThreadView in parallel —
  // ThreadView had no awareness of the in-flight message, rendered an
  // empty conversation with the default "Act" mode toggle, and the
  // user reasonably concluded the message had been eaten.
  const [pendingFirstMessage, setPendingFirstMessage] = useState<string | null>(
    null
  );
  // B1 (P3): attachments uploaded in the empty-state composer before the
  // orphan thread row exists. Handed to ThreadView with the first message.
  const [pendingFirstAttachments, setPendingFirstAttachments] = useState<
    AttachmentDescriptor[] | undefined
  >(undefined);
  // B2 (P3): references pinned in the empty-state composer before the orphan
  // thread row exists. Handed to ThreadView with the first message.
  const [pendingFirstReferences, setPendingFirstReferences] = useState<
    AgentReference[] | undefined
  >(undefined);

  const recents = useQuery<{ threads: RecentThread[] }>({
    queryKey: ["agent-threads-recent"],
    queryFn: async () => {
      const res = await fetch("/api/agent/threads/recent?limit=8", {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`recent ${res.status}`);
      return res.json();
    },
    staleTime: 30_000,
    enabled: !threadId,
  });

  if (threadId) {
    return (
      <ThreadView
        threadId={threadId}
        key={threadId}
        onItemBound={onItemBound}
        onOpenItem={onOpenItem}
        initialMessage={pendingFirstMessage ?? seedMessage ?? undefined}
        initialAttachments={pendingFirstAttachments}
        initialReferences={pendingFirstReferences}
      />
    );
  }

  // Empty state with a Recent rail so the user can pick up a prior
  // Spotlight chat (or jump to an item-bound thread). Item-bound rows
  // open the persistent Ask Mashi sheet; orphan rows load right here.

  async function send(
    message: string,
    attachments?: AttachmentDescriptor[],
    references?: AgentReference[]
  ) {
    if (sending || (!message.trim() && !(attachments?.length ?? 0))) return;
    setSending(true);
    setPendingFirstMessage(message);
    setPendingFirstAttachments(attachments);
    setPendingFirstReferences(references);
    const newId = await onCreate();
    if (!newId) {
      setSending(false);
      setPendingFirstMessage(null);
      setPendingFirstAttachments(undefined);
      setPendingFirstReferences(undefined);
      return;
    }
    // No-op: setOrphanThreadId in the parent triggers the early-return
    // branch above, mounting <ThreadView initialMessage={message} />.
    // ThreadView owns the POST + stream + optimistic bubble from here.
    setSending(false);
  }

  const threads = recents.data?.threads ?? [];

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex flex-1 min-h-0 flex-col gap-2 overflow-hidden">
        <div className="shrink-0 rounded-md border border-dashed border-border/40 bg-card/60 p-3 text-center text-xs text-muted-foreground">
          {creating || sending ? (
            <div className="inline-flex items-center gap-2">
              <Loader2 className="h-3 w-3 animate-spin" />
              {pendingFirstMessage
                ? "Opening a new conversation…"
                : "Loading…"}
            </div>
          ) : error ? (
            <div className="space-y-1">
              <div className="text-destructive">{error}</div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => onCreate()}
                className="mashi-press h-6 text-[11px]"
              >
                Try again
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="inline-flex items-center gap-1 font-medium text-foreground">
                <Sparkles className="h-3 w-3 text-primary" />
                Ask Mashi anything
              </p>
              <Suggestions>
                {SPOTLIGHT_SUGGESTIONS.map((s) => (
                  <Suggestion
                    key={s}
                    suggestion={s}
                    onClick={send}
                    className="text-[11px]"
                  />
                ))}
              </Suggestions>
            </div>
          )}
        </div>
        {threads.length > 0 && (
          <div className="flex min-h-0 flex-col gap-1.5 overflow-hidden">
            <div className="flex shrink-0 items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              <MessageSquareText className="h-3 w-3" />
              Recent
            </div>
            <div className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
              {threads.map((t) => (
                <RecentThreadRow
                  key={t.id}
                  thread={t}
                  onClick={() => {
                    if (t.is_orphan) {
                      onResumeOrphan(t.id);
                    } else if (t.item_id) {
                      openFor(t.item_id);
                    }
                  }}
                />
              ))}
            </div>
          </div>
        )}
      </div>
      <AgentComposer disabled={sending} onSend={send} />
    </div>
  );
}

function RecentThreadRow({
  thread,
  onClick,
}: {
  thread: RecentThread;
  onClick: () => void;
}) {
  const stamp = thread.last_message_at ?? thread.created_at;
  const relative = formatRelative(stamp);
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={onClick}
      className="mashi-magnetic h-auto w-full justify-start gap-2 rounded-md px-2 py-1.5 text-left text-[11px] font-normal hover:bg-secondary/40"
    >
      <span
        className={
          thread.is_orphan
            ? "text-muted-foreground"
            : "text-primary"
        }
      >
        {thread.is_orphan ? "·" : "•"}
      </span>
      <span className="min-w-0 flex-1 truncate text-foreground/90">
        {thread.title}
      </span>
      <span className="shrink-0 font-mono text-[10px] text-muted-foreground/70">
        {relative}
      </span>
    </Button>
  );
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const diff = Date.now() - then;
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return "just now";
  if (diff < hour) return `${Math.round(diff / minute)}m`;
  if (diff < day) return `${Math.round(diff / hour)}h`;
  if (diff < 30 * day) return `${Math.round(diff / day)}d`;
  return new Date(iso).toLocaleDateString();
}
