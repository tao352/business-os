"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight, Plus, Menu } from "lucide-react";
import { Button } from "@/components/ui/button";

interface TopBarProps {
  onNewLeadClick?: () => void;
  onMenuClick?: () => void;
  canCreateLead?: boolean;
}

export function TopBar({
  onNewLeadClick,
  onMenuClick,
  canCreateLead = true,
}: TopBarProps) {
  const pathname = usePathname();

  // Generate breadcrumb segments from pathname
  const segments = pathname.split("/").filter(Boolean);

  return (
    <header className="h-14 border-b border-line bg-surface flex items-center justify-between px-4 md:px-6 shrink-0 select-none">
      <div className="flex items-center gap-2 min-w-0">
        {onMenuClick && (
          <button
            type="button"
            onClick={onMenuClick}
            className="md:hidden p-1.5 -ml-1 rounded-md text-ink-muted hover:text-ink hover:bg-surface-muted transition-colors"
            aria-label="Open navigation menu"
          >
            <Menu className="w-4 h-4" />
          </button>
        )}
        {/* Breadcrumbs */}
        <nav className="flex items-center gap-1.5 text-xs text-ink-muted truncate">
          <Link
            href="/app"
            className="hover:text-ink font-medium transition-colors"
          >
            Workspace
          </Link>
          {segments.map((seg, idx) => {
            const href = "/" + segments.slice(0, idx + 1).join("/");
            const isLast = idx === segments.length - 1;
            const isUuid =
              /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
                seg,
              );
            const label = isUuid
              ? "Lead Details"
              : seg.charAt(0).toUpperCase() + seg.slice(1).replace(/-/g, " ");

            return (
              <React.Fragment key={href}>
                <ChevronRight className="w-3 h-3 text-ink-faint shrink-0" />
                {isLast ? (
                  <span className="font-semibold text-ink truncate max-w-[200px]">
                    {label}
                  </span>
                ) : (
                  <Link
                    href={href}
                    className="hover:text-ink transition-colors truncate max-w-[150px]"
                  >
                    {label}
                  </Link>
                )}
              </React.Fragment>
            );
          })}
        </nav>
      </div>

      {/* Right Actions */}
      <div className="flex items-center gap-3">
        {onNewLeadClick && canCreateLead && (
          <Button
            size="sm"
            variant="primary"
            onClick={onNewLeadClick}
            className="text-xs"
          >
            <Plus className="w-3.5 h-3.5 mr-1" />
            New Lead
          </Button>
        )}
      </div>
    </header>
  );
}
