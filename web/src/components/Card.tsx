import type { ReactNode } from "react";

export function Card({
  children,
  className = "",
  animate = false,
}: {
  children: ReactNode;
  className?: string;
  animate?: boolean;
}) {
  return (
    <div className={`card${animate ? " card--animate" : ""} ${className}`}>
      {children}
    </div>
  );
}
