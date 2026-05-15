import { TopBar } from "@/components/layout/top-bar";
import { InboxView } from "@/components/inbox/inbox-view";

export default function InboxPage() {
  return (
    <>
      <TopBar title="Inbox" subtitle="Gmail + Slack, triaged and ranked." />
      <div className="min-h-0 flex-1">
        <InboxView />
      </div>
    </>
  );
}
