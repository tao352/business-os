import React from "react";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  error?: string;
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, error, children, ...props }, ref) => {
    return (
      <div className="w-full">
        <select
          ref={ref}
          className={twMerge(
            clsx(
              "w-full h-9 px-3 text-sm bg-surface border border-line rounded-md text-ink transition-colors duration-150 appearance-none bg-no-repeat",
              "focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent",
              "disabled:bg-surface-muted disabled:text-ink-faint disabled:cursor-not-allowed",
              error && "border-red-400 focus:border-red-500 focus:ring-red-500",
              className,
            ),
          )}
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%2371717A' stroke-width='2'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' d='M19 9l-7 7-7-7'%3E%3C/path%3E%3C/svg%3E")`,
            backgroundPosition: "right 0.75rem center",
            backgroundSize: "1rem",
          }}
          {...props}
        >
          {children}
        </select>
        {error && (
          <p className="mt-1 text-xs text-red-600 font-normal">{error}</p>
        )}
      </div>
    );
  },
);

Select.displayName = "Select";
