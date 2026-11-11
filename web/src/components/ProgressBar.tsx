export function ProgressBar({ value, max }: { value: number; max: number }) {
  const percent =
    Number.isFinite(value) && Number.isFinite(max) && max > 0
      ? Math.min(100, Math.max(0, (value / max) * 100))
      : 0;
  return (
    <div
      role="progressbar"
      aria-label="Budget spent"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      style={{
        height: 4,
        borderRadius: 0,
        background: "var(--color-line)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          height: "100%",
          width: `${percent}%`,
          background: "var(--color-text-primary)",
          borderRadius: "inherit",
        }}
      />
    </div>
  );
}
