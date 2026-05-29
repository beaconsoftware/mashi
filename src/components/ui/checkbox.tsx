"use client";

import * as React from "react";
import { CheckIcon } from "lucide-react";
import { Checkbox as CheckboxPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";

/**
 * Refined dark-UI checkbox. The shadcn default ships with `shadow-xs` +
 * full `bg-primary` fill + `size-3.5` check icon — against Mashi's dark
 * surfaces every checked row screamed. This variant:
 *
 *   - Drops the shadow (an indicator doesn't need depth).
 *   - Quiets the rest border to `border-muted-foreground/35` and adds a
 *     hover brighten so the box reads as interactive without resting at
 *     full contrast.
 *   - Softens the checked fill to `primary/80` (less saturated, same
 *     semantic signal).
 *   - Shrinks the inner check icon (`size-3` not `size-3.5`) so the
 *     mark sits inside the box with breathing room instead of crowding
 *     the corners.
 *
 * The size and a11y target stay at `size-4` so click areas are unchanged.
 * Callers can still override via `className`; we keep the `cn(default,
 * className)` order so a passed class always wins.
 */
function Checkbox({
  className,
  ...props
}: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "peer size-4 shrink-0 rounded-[4px] border border-muted-foreground/35 bg-transparent transition-colors outline-none",
        "hover:border-muted-foreground/60",
        "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40",
        "data-[state=checked]:border-primary/55 data-[state=checked]:bg-primary/80 data-[state=checked]:text-primary-foreground",
        className
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="grid place-content-center text-current transition-none"
      >
        <CheckIcon className="size-3" strokeWidth={2.5} />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export { Checkbox };
