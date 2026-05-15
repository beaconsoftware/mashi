import { TopBar } from "@/components/layout/top-bar";
import { CalendarView } from "@/components/calendar/calendar-view";

export default function CalendarPage() {
  return (
    <>
      <TopBar title="Calendar" subtitle="Agenda from connected accounts." />
      <div className="min-h-0 flex-1">
        <CalendarView />
      </div>
    </>
  );
}
