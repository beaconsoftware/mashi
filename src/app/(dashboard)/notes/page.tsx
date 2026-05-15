import { TopBar } from "@/components/layout/top-bar";
import { NotesView } from "@/components/notes/notes-view";

export default function NotesPage() {
  return (
    <>
      <TopBar title="Notes" subtitle="Fireflies meetings + extracted action items." />
      <div className="min-h-0 flex-1">
        <NotesView />
      </div>
    </>
  );
}
