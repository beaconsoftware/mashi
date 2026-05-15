import { TopBar } from "@/components/layout/top-bar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CompaniesGrid } from "@/components/companies/companies-grid";

export default function CompaniesPage() {
  return (
    <>
      <TopBar title="Companies" subtitle="Portfolio at a glance." />
      <ScrollArea className="flex-1">
        <div className="mx-auto max-w-5xl px-6 py-8">
          <CompaniesGrid />
        </div>
      </ScrollArea>
    </>
  );
}
