import type { CSSProperties, MouseEventHandler, ReactNode } from "react";

type ButtonProps = {
  variant?: "primary" | "secondary";
  onClick?: MouseEventHandler<HTMLButtonElement>;
  disabled?: boolean;
  style?: CSSProperties;
  children: ReactNode;
};

export function Button({
  variant = "primary",
  onClick,
  disabled = false,
  style,
  children,
}: ButtonProps) {
  return (
    <button
      type="button"
      className={`button button--${variant}`}
      onClick={onClick}
      disabled={disabled}
      style={style}
    >
      {children}
    </button>
  );
}
