import { TopBar } from "@/components/layout/top-bar";
import { SprintBar } from "@/components/s2d/sprint-bar";
import { S2DBoard } from "@/components/s2d/s2d-board";

export default function S2DPage() {
  return (
    <>
      <TopBar title="S2D" subtitle="Shit to Do — the only board that matters." />
      <SprintBar />
      <div className="min-h-0 flex-1">
        <S2DBoard />
      </div>
    </>
  );
}
