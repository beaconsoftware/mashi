import { ToolPoliciesManager } from "@/components/settings/tool-policies-manager";

export const dynamic = "force-dynamic";

export default function PoliciesPage() {
  return (
    <div className="mx-auto max-w-5xl">
      <ToolPoliciesManager />
    </div>
  );
}
