import type { ReactNode } from "react";

export function FormField({
  label,
  htmlFor,
  children,
  error,
}: {
  label: string;
  htmlFor: string;
  children: ReactNode;
  error?: string;
}) {
  return (
    <div style={{ display: "grid", gap: 6, minWidth: 0 }}>
      <label htmlFor={htmlFor} className="eyebrow">
        {label}
      </label>
      {children}
      {error && (
        <span role="alert" style={{ color: "var(--color-red)", fontSize: 13 }}>
          {error}
        </span>
      )}
    </div>
  );
}
