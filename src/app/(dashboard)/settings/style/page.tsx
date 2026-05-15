import { TopBar } from "@/components/layout/top-bar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { StyleProfileEditor } from "@/components/settings/style-profile-editor";

export default function StyleSettingsPage() {
  return (
    <>
      <TopBar
        title="Communication style"
        subtitle="Teach Mashi to write like you."
      />
      <ScrollArea className="flex-1">
        <div className="mx-auto max-w-3xl px-6 py-8">
          <StyleProfileEditor />
        </div>
      </ScrollArea>
    </>
  );
}
