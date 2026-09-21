import React from "react";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import type { LeadStatus } from "@business-os/types";

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  status?: LeadStatus | "DEFAULT" | "ACTIVE" | "INACTIVE";
  variant?:
    | "neutral"
    | "info"
    | "success"
    | "warning"
    | "error"
    | "purple"
    | "outline"
    | "default";
}

export function Badge({
  status,
  variant,
  className,
  children,
  ...props
}: BadgeProps) {
  let style = "bg-zinc-100 text-zinc-700 border-zinc-200";

  if (status) {
    switch (status) {
      case "NEW":
        style = "bg-zinc-100 text-zinc-700 border-zinc-200";
        break;
      case "CONTACTED":
        style = "bg-blue-50 text-blue-700 border-blue-200";
        break;
      case "QUALIFIED":
        style = "bg-teal-50 text-teal-700 border-teal-200";
        break;
      case "MEETING_SCHEDULED":
        style = "bg-indigo-50 text-indigo-700 border-indigo-200";
        break;
      case "SITE_VISIT_BOOKED":
        style = "bg-purple-50 text-purple-700 border-purple-200";
        break;
      case "RESERVED":
        style = "bg-amber-50 text-amber-800 border-amber-200";
        break;
      case "CONTRACTED":
        style = "bg-emerald-50 text-emerald-800 border-emerald-200";
        break;
      case "UNQUALIFIED":
      case "LOST":
        style = "bg-rose-50 text-rose-700 border-rose-200";
        break;
      case "ACTIVE":
        style = "bg-emerald-50 text-emerald-800 border-emerald-200";
        break;
      case "INACTIVE":
        style = "bg-zinc-100 text-zinc-500 border-zinc-200";
        break;
    }
  } else if (variant) {
    switch (variant) {
      case "info":
        style = "bg-blue-50 text-blue-700 border-blue-200";
        break;
      case "success":
        style = "bg-emerald-50 text-emerald-800 border-emerald-200";
        break;
      case "warning":
        style = "bg-amber-50 text-amber-800 border-amber-200";
        break;
      case "error":
        style = "bg-rose-50 text-rose-700 border-rose-200";
        break;
      case "purple":
        style = "bg-purple-50 text-purple-700 border-purple-200";
        break;
      case "outline":
        style = "bg-transparent text-zinc-700 border-zinc-300";
        break;
      case "default":
      case "neutral":
      default:
        style = "bg-zinc-100 text-zinc-700 border-zinc-200";
        break;
    }
  }

  return (
    <span
      className={twMerge(
        clsx(
          "inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border leading-normal whitespace-nowrap",
          style,
          className,
        ),
      )}
      {...props}
    >
      {children}
    </span>
  );
}
