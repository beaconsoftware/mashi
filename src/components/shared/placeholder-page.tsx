import Link from "next/link";
import { TopBar } from "@/components/layout/top-bar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ArrowRight } from "lucide-react";

interface Props {
  title: string;
  subtitle: string;
  phase: string;
  bullets: string[];
}

export function PlaceholderPage({ title, subtitle, phase, bullets }: Props) {
  return (
    <>
      <TopBar title={title} subtitle={subtitle} />
      <ScrollArea className="flex-1">
        <div className="mx-auto max-w-2xl px-6 py-10">
          <div className="rounded-md border border-border/40 bg-card p-6">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-primary">
              {phase}
            </div>
            <h2 className="mt-2 text-xl font-semibold tracking-tight">{title}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>

            <div className="mt-5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              What lives here
            </div>
            <ul className="mt-2 space-y-1.5 text-sm text-foreground/80">
              {bullets.map((b) => (
                <li key={b} className="flex items-start gap-2">
                  <span className="mt-1.5 h-1 w-1 rounded-full bg-muted-foreground/60" />
                  <span>{b}</span>
                </li>
              ))}
            </ul>

            <Link
              href="/s2d"
              className="mt-6 inline-flex items-center gap-1 text-[12px] text-primary hover:underline"
            >
              Go to S2D <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
        </div>
      </ScrollArea>
    </>
  );
}
