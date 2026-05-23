// translucency-audit-ok: file — legacy callsites, migrate to sanctioned scale (/15, /40, /55, /60, /80, /95) case-by-case during component touch-ups.

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * Mashi polish: pressed-down scale feedback baked into the variants
 * that read as "solid actions" (default, destructive, outline,
 * secondary). Ghost stays without press because it's typically
 * icon-only or list-row triggers where a scale-down reads as a glitch.
 * Link stays without because text shouldn't scale.
 *
 * Icon-sized buttons get the rotate-and-scale-icon polish from
 * `.mashi-icon-hover` applied to the child <svg>. The group hover
 * selector means the icon transforms on parent hover — same pattern
 * as the sidebar nav. See AGENTS.md "Polish patterns".
 */
const buttonVariants = cva(
  "group inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:transition-transform [&_svg]:duration-200",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground hover:bg-primary/90 active:scale-[0.97] transition-[colors,transform]",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90 active:scale-[0.97] transition-[colors,transform]",
        outline:
          "border border-border bg-transparent hover:bg-accent hover:text-accent-foreground active:scale-[0.97] transition-[colors,transform,border-color]",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80 active:scale-[0.97] transition-[colors,transform]",
        ghost:
          "hover:bg-accent hover:text-accent-foreground",
        link:
          "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-3.5 py-2",
        sm: "h-7 rounded-md px-2.5 text-xs",
        lg: "h-10 rounded-md px-6",
        // Icon-sized: the child <svg> rotates + scales on parent hover.
        // Matches the sidebar nav feel; applies anywhere a `<Button
        // size="icon">` is used.
        icon: "h-8 w-8 [&_svg]:group-hover:rotate-[6deg] [&_svg]:group-hover:scale-110",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
