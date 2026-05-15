import { TopBar } from "@/components/layout/top-bar";
import { SearchView } from "@/components/search/search-view";

export default function SearchPage() {
  return (
    <>
      <TopBar title="Search" subtitle="Keyword search across everything." />
      <div className="min-h-0 flex-1">
        <SearchView />
      </div>
    </>
  );
}
