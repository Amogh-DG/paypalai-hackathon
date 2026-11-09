export function LoadingState({ label }: { label?: string }) {
  return (
    <div className="state" role="status" aria-label={label || "Loading"}>
      <span className="loading-dots" aria-hidden="true">
        <span className="loading-dot" />
        <span className="loading-dot" />
        <span className="loading-dot" />
      </span>
      {label && <span className="loading-label">{label}</span>}
    </div>
  );
}
