import { TopBar } from "@/components/layout/top-bar";
import { LinearView } from "@/components/linear/linear-view";

export default function LinearPage() {
  return (
    <>
      <TopBar title="Linear" subtitle="Every portco workspace, unified." />
      <div className="min-h-0 flex-1">
        <LinearView />
      </div>
    </>
  );
}
