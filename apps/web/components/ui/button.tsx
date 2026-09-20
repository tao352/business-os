import React from "react";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "destructive" | "outline";
  size?: "sm" | "md" | "lg";
  isLoading?: boolean;
}

export function Button({
  className,
  variant = "secondary",
  size = "md",
  isLoading = false,
  disabled,
  children,
  ...props
}: ButtonProps) {
  const base =
    "inline-flex items-center justify-center font-medium transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed select-none rounded-md";

  const variants = {
    primary: "bg-accent hover:bg-accent-hover text-white shadow-none",
    secondary:
      "bg-surface border border-line hover:bg-surface-subtle text-ink shadow-none",
    ghost:
      "bg-transparent text-ink-secondary hover:bg-surface-muted hover:text-ink",
    destructive:
      "bg-red-50 border border-red-200 text-red-700 hover:bg-red-100",
    outline:
      "bg-transparent border border-line text-ink hover:bg-surface-subtle",
  };

  const sizes = {
    sm: "h-8 px-2.5 text-xs gap-1.5",
    md: "h-9 px-3 text-sm gap-2",
    lg: "h-10 px-4 text-base gap-2",
  };

  return (
    <button
      className={twMerge(clsx(base, variants[variant], sizes[size], className))}
      disabled={disabled || isLoading}
      {...props}
    >
      {isLoading && (
        <svg
          className="animate-spin h-3.5 w-3.5 text-current"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8v8H4z"
          />
        </svg>
      )}
      {children}
    </button>
  );
}
