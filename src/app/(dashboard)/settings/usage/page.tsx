import { UsageView } from "@/components/settings/usage-view";

export const dynamic = "force-dynamic";

export default function UsagePage() {
  return (
    <div className="mx-auto max-w-5xl">
      <UsageView />
    </div>
  );
}
