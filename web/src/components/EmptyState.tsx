export function EmptyState({ message }: { message: string }) {
  return (
    <div className="state state--empty">
      <p>{message}</p>
    </div>
  );
}
