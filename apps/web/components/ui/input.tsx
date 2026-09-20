import React from "react";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  error?: string;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, error, ...props }, ref) => {
    return (
      <div className="w-full">
        <input
          ref={ref}
          className={twMerge(
            clsx(
              "w-full h-9 px-3 text-sm bg-surface border border-line rounded-md text-ink placeholder:text-ink-faint transition-colors duration-150",
              "focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent",
              "disabled:bg-surface-muted disabled:text-ink-faint disabled:cursor-not-allowed",
              error && "border-red-400 focus:border-red-500 focus:ring-red-500",
              className,
            ),
          )}
          {...props}
        />
        {error && (
          <p className="mt-1 text-xs text-red-600 font-normal">{error}</p>
        )}
      </div>
    );
  },
);

Input.displayName = "Input";
