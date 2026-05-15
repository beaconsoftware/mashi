import { Suspense } from "react";
import { TopBar } from "@/components/layout/top-bar";
import { HomeCockpit } from "@/components/home/home-cockpit";

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
          <HomeCockpit />
        </Suspense>
      </div>
    </>
  );
}
