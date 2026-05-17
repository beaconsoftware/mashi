import { TopBar } from "@/components/layout/top-bar";
import { ApiTokensManager } from "@/components/settings/api-tokens-manager";

export default function ApiTokensPage() {
  return (
    <>
      <TopBar
        title="API Tokens"
        subtitle="Long-lived tokens for the Mashi DXT and any other agent that should read your data."
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <ApiTokensManager />
      </div>
    </>
  );
}
