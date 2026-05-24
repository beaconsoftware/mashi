import { Suspense } from "react";
import { TopBar } from "@/components/layout/top-bar";
import { HomeCockpit } from "@/components/home/home-cockpit";
import { HomeCockpitV2 } from "@/components/home/home-cockpit-v2";
import { isFeatureEnabled } from "@/lib/feature-flags";

const TODAY = new Date().toLocaleDateString(undefined, {
  weekday: "long",
  month: "long",
  day: "numeric",
});

export default function HomePage() {
  const showV2 = isFeatureEnabled("activity_watcher");
  return (
    <>
      <TopBar title="Cockpit" subtitle={TODAY} />
      <div className="min-h-0 flex-1 overflow-y-auto lg:overflow-hidden">
        <Suspense>{showV2 ? <HomeCockpitV2 /> : <HomeCockpit />}</Suspense>
      </div>
    </>
  );
}
