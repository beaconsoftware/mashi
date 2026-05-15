import { TopBar } from "@/components/layout/top-bar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { UsageView } from "@/components/settings/usage-view";

export const dynamic = "force-dynamic";

export default function UsagePage() {
  return (
    <>
      <TopBar title="Usage" subtitle="AI calls + cost breakdown." />
      <ScrollArea className="flex-1">
        <div className="mx-auto max-w-5xl px-6 py-8">
          <UsageView />
        </div>
      </ScrollArea>
    </>
  );
}
