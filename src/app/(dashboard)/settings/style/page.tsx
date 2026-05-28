import { MashiMemoryEditor } from "@/components/settings/mashi-memory-editor";
import { StyleProfileEditor } from "@/components/settings/style-profile-editor";

export default function StyleSettingsPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <MashiMemoryEditor />
      <StyleProfileEditor />
    </div>
  );
}
