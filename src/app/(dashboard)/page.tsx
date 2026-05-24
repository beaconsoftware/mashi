import { Suspense } from "react";
import { TopBar } from "@/components/layout/top-bar";
import { HomeCockpitV2 } from "@/components/home/home-cockpit-v2";

const TODAY = new Date().toLocaleDateString(undefined, {
  weekday: "long",
  month: "long",
  day: "numeric",
});

export default function HomePage() {
  return (
    <>
      <TopBar title="Cockpit" subtitle={TODAY} />
      <div className="min-h-0 flex-1 overflow-y-auto lg:overflow-hidden">
        <Suspense>
          <HomeCockpitV2 />
        </Suspense>
      </div>
    </>
  );
}
