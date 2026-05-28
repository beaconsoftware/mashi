"use client"

import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Tabs as TabsPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function Tabs({
  className,
  orientation = "horizontal",
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      data-orientation={orientation}
      orientation={orientation}
      className={cn(
        "group/tabs flex gap-2 data-[orientation=horizontal]:flex-col",
        className
      )}
      {...props}
    />
  )
}

const tabsListVariants = cva(
  "group/tabs-list inline-flex w-fit items-center justify-center rounded-lg p-[3px] text-muted-foreground group-data-[orientation=horizontal]/tabs:h-9 group-data-[orientation=vertical]/tabs:h-fit group-data-[orientation=vertical]/tabs:flex-col data-[variant=line]:rounded-none",
  {
    variants: {
      variant: {
        default: "bg-muted",
        line: "gap-1 bg-transparent",
        // Animated: same chrome as default (rounded muted track) but a
        // single absolute pill slides between the active triggers. The
        // trigger CSS below suppresses its own active-state background
        // so the sliding pill IS the active background.
        animated: "relative bg-muted",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function TabsList({
  className,
  variant = "default",
  children,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List> &
  VariantProps<typeof tabsListVariants>) {
  if (variant === "animated") {
    return (
      <AnimatedTabsList className={className} {...props}>
        {children}
      </AnimatedTabsList>
    )
  }
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(tabsListVariants({ variant }), className)}
      {...props}
    >
      {children}
    </TabsPrimitive.List>
  )
}

/**
 * Sliding-pill TabsList. Same Radix Tabs API as the default variant:
 * drop a `<TabsList variant="animated">` over any existing tabs and
 * the active background slides between triggers as the user switches.
 *
 * Implementation: a single absolute pill is rendered behind the
 * triggers (`-z-10`). On mount + whenever any trigger's data-state
 * changes (Radix flips data-state="active" on the new tab) we measure
 * the active trigger's offset relative to the list and write
 * `transform: translateX(x) ; width: w` on the pill. CSS handles the
 * transition. First paint uses `transition-none` so the pill doesn't
 * fly in from 0,0 on mount.
 *
 * Why not Framer Motion's layoutId? We don't have framer-motion in
 * package.json and a single tabs flourish isn't worth a new runtime
 * dependency. The JS-measured approach is ~30 lines and uses the
 * same MutationObserver pattern the underlying primitive already
 * relies on for keyboard nav.
 */
function AnimatedTabsList({
  className,
  children,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List>) {
  const listRef = React.useRef<HTMLDivElement | null>(null)
  const [pill, setPill] = React.useState<{
    x: number
    width: number
    measured: boolean
  }>({ x: 0, width: 0, measured: false })

  React.useEffect(() => {
    const list = listRef.current
    if (!list) return

    const measure = () => {
      const active = list.querySelector<HTMLElement>(
        '[role="tab"][data-state="active"]'
      )
      if (!active) return
      const listRect = list.getBoundingClientRect()
      const activeRect = active.getBoundingClientRect()
      setPill({
        x: activeRect.left - listRect.left,
        width: activeRect.width,
        measured: true,
      })
    }

    // Initial sync measurement after layout.
    measure()

    // Subsequent updates: watch every trigger's data-state attribute
    // (Radix flips them when the value changes — keyboard nav, click,
    // controlled `value` prop change all funnel through this).
    const observer = new MutationObserver(measure)
    const triggers = list.querySelectorAll('[role="tab"]')
    triggers.forEach((t) => {
      observer.observe(t, {
        attributes: true,
        attributeFilter: ["data-state"],
      })
    })

    // Resize: container width changes (window resize, parent flex
    // reflow, font load shift) reposition triggers. Re-measure.
    const ro = new ResizeObserver(measure)
    ro.observe(list)

    return () => {
      observer.disconnect()
      ro.disconnect()
    }
  }, [children])

  return (
    <TabsPrimitive.List
      ref={listRef}
      data-slot="tabs-list"
      data-variant="animated"
      className={cn(tabsListVariants({ variant: "animated" }), className)}
      {...props}
    >
      <span
        aria-hidden
        // The pill. Sits behind the triggers via -z-10; the parent
        // muted track shows around it via the `p-[3px]` inset.
        // transition-[transform,width] gets us the slide; we gate the
        // transition on `measured` so the first paint pops into place
        // rather than flying in from (0, 0).
        className={cn(
          "pointer-events-none absolute top-[3px] bottom-[3px] -z-10 rounded-md bg-background shadow-sm",
          pill.measured
            ? "transition-[transform,width] duration-200 ease-out"
            : "opacity-0"
        )}
        style={{
          transform: `translateX(${pill.x}px)`,
          width: `${pill.width}px`,
        }}
      />
      {children}
    </TabsPrimitive.List>
  )
}

function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        "relative inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center gap-1.5 rounded-md border border-transparent px-2 py-1 text-sm font-medium whitespace-nowrap text-foreground/60 transition-all group-data-[orientation=vertical]/tabs:w-full group-data-[orientation=vertical]/tabs:justify-start hover:text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 group-data-[variant=default]/tabs-list:data-[state=active]:shadow-sm group-data-[variant=line]/tabs-list:data-[state=active]:shadow-none dark:text-muted-foreground dark:hover:text-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        "group-data-[variant=line]/tabs-list:bg-transparent group-data-[variant=line]/tabs-list:data-[state=active]:bg-transparent dark:group-data-[variant=line]/tabs-list:data-[state=active]:border-transparent dark:group-data-[variant=line]/tabs-list:data-[state=active]:bg-transparent",
        "data-[state=active]:bg-background data-[state=active]:text-foreground dark:data-[state=active]:border-input dark:data-[state=active]:bg-input/30 dark:data-[state=active]:text-foreground",
        // Animated variant: the sliding pill provides the active bg, so
        // suppress the trigger's own active-state background + border.
        // The text-color bump on active still applies (inherited from
        // the default rule above).
        "group-data-[variant=animated]/tabs-list:data-[state=active]:bg-transparent group-data-[variant=animated]/tabs-list:data-[state=active]:shadow-none group-data-[variant=animated]/tabs-list:data-[state=active]:border-transparent dark:group-data-[variant=animated]/tabs-list:data-[state=active]:bg-transparent dark:group-data-[variant=animated]/tabs-list:data-[state=active]:border-transparent",
        "after:absolute after:bg-foreground after:opacity-0 after:transition-opacity group-data-[orientation=horizontal]/tabs:after:inset-x-0 group-data-[orientation=horizontal]/tabs:after:bottom-[-5px] group-data-[orientation=horizontal]/tabs:after:h-0.5 group-data-[orientation=vertical]/tabs:after:inset-y-0 group-data-[orientation=vertical]/tabs:after:-right-1 group-data-[orientation=vertical]/tabs:after:w-0.5 group-data-[variant=line]/tabs-list:data-[state=active]:after:opacity-100",
        className
      )}
      {...props}
    />
  )
}

function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn("flex-1 outline-none", className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants }
