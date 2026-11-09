import type { MouseEventHandler, ReactNode } from "react";

type ButtonProps = {
  variant?: "primary" | "secondary";
  onClick?: MouseEventHandler<HTMLButtonElement>;
  disabled?: boolean;
  children: ReactNode;
};

export function Button({
  variant = "primary",
  onClick,
  disabled = false,
  children,
}: ButtonProps) {
  return (
    <button
      type="button"
      className={`button button--${variant}`}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
