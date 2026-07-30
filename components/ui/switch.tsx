"use client"

import { Switch as SwitchPrimitive } from "@base-ui/react/switch"

import { cn } from "@/lib/utils"

function Switch({
  className,
  size = "default",
  ...props
}: SwitchPrimitive.Root.Props & {
  size?: "sm" | "default"
}) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      className={cn(
        "peer group/switch relative inline-flex size-11 shrink-0 items-center rounded-full border border-transparent bg-transparent transition-all outline-none before:absolute before:top-1/2 before:-translate-y-1/2 before:rounded-full before:transition-colors data-[size=default]:before:left-1.5 data-[size=default]:before:h-5 data-[size=default]:before:w-8 data-[size=sm]:before:left-2 data-[size=sm]:before:h-4 data-[size=sm]:before:w-7 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 data-checked:before:bg-primary data-unchecked:before:bg-input dark:data-unchecked:before:bg-input/80 data-disabled:cursor-not-allowed data-disabled:opacity-50",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none absolute top-1/2 -translate-y-1/2 rounded-full bg-background ring-0 transition-transform group-data-[size=default]/switch:left-2 group-data-[size=default]/switch:size-4 group-data-[size=sm]/switch:left-2.5 group-data-[size=sm]/switch:size-3 data-checked:translate-x-3 data-unchecked:translate-x-0 dark:data-checked:bg-primary-foreground dark:data-unchecked:bg-foreground"
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
