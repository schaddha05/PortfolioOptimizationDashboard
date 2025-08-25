import * as React from "react";
import { cn } from "@/lib/utils";

type Props = React.PropsWithChildren<{ className?: string }>;

export function Badge({ className, children }: Props) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium",
        "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
        className
      )}
    >
      {children}
    </span>
  );
}

export default Badge;
