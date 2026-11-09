export function EmptyState({ message }: { message: string }) {
  return (
    <div className="state state--empty">
      <span className="empty-icon-frame">
        <svg
          className="empty-icon"
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M4 4h16l2 10v6H2v-6L4 4Z" />
          <path d="M2 14h6l2 3h4l2-3h6" />
        </svg>
      </span>
      <p>{message}</p>
    </div>
  );
}
