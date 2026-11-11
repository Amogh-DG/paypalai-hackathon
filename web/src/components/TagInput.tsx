import { useState } from "react";

export function TagInput({
  value,
  onChange,
  placeholder,
  normalize,
  id,
}: {
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
  normalize?: (value: string) => string;
  id?: string;
}) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const tag = normalize ? normalize(draft) : draft;
    if (
      tag &&
      !value.some(
        (existing) => (normalize ? normalize(existing) : existing) === tag,
      )
    )
      onChange([...value, tag]);
    setDraft("");
  };
  return (
    <div
      className="tag-input"
      style={{
        border: "1px solid var(--color-line)",
        borderRadius: 2,
        padding: 10,
        display: "flex",
        flexWrap: "wrap",
        gap: 8,
        background: "var(--color-bg)",
      }}
    >
      {value.map((tag) => (
        <span
          key={tag}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            borderRadius: 2,
            background: "transparent",
            border: "1px solid var(--color-line)",
            padding: "3px 10px",
          }}
        >
          {tag}
          <button
            type="button"
            aria-label={`Remove ${tag}`}
            onClick={() => onChange(value.filter((item) => item !== tag))}
            style={{
              border: 0,
              background: "transparent",
              color: "inherit",
              cursor: "pointer",
            }}
          >
            ×
          </button>
        </span>
      ))}
      <input
        id={id}
        value={draft}
        placeholder={placeholder}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === "Enter" || event.key === ",") {
            event.preventDefault();
            add();
          } else if (event.key === "Backspace" && draft === "") {
            event.preventDefault();
            onChange(value.slice(0, -1));
          }
        }}
        style={{
          flex: "1 1 180px",
          minWidth: 0,
          background: "transparent",
          border: 0,
          color: "var(--color-text-primary)",
          font: "inherit",
          padding: 4,
        }}
      />
    </div>
  );
}
