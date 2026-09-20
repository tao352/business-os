"use client";

import React, { useTransition } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type { LeadStatus } from "@business-os/types";

interface FilterToolbarProps {
  members: Array<{ id: string; user_id: string; full_name: string }>;
}

export function LeadsFilterToolbar({ members }: FilterToolbarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const currentSearch = searchParams.get("search") || "";
  const currentStatus = searchParams.get("status") || "";
  const currentAssignee = searchParams.get("assignee") || "";

  const updateParam = (key: string, value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    params.delete("page"); // reset page on filter change
    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`);
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      {/* Search Input */}
      <div className="relative min-w-[240px] flex-1 max-w-sm">
        <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint pointer-events-none" />
        <Input
          type="text"
          placeholder="Search by name, phone, or email..."
          defaultValue={currentSearch}
          className="pl-8 text-xs h-9 bg-surface"
          onChange={(e) => updateParam("search", e.target.value)}
        />
      </div>

      {/* Status Filter */}
      <div className="w-[150px]">
        <Select
          className="text-xs h-9 bg-surface"
          value={currentStatus}
          onChange={(e) => updateParam("status", e.target.value)}
        >
          <option value="">All Statuses</option>
          <option value="NEW">New</option>
          <option value="CONTACTED">Contacted</option>
          <option value="QUALIFIED">Qualified</option>
          <option value="MEETING_SCHEDULED">Meeting Scheduled</option>
          <option value="SITE_VISIT_BOOKED">Site Visit Booked</option>
          <option value="RESERVED">Reserved</option>
          <option value="CONTRACTED">Contracted</option>
          <option value="UNQUALIFIED">Unqualified</option>
          <option value="LOST">Lost</option>
        </Select>
      </div>

      {/* Assignee Filter */}
      <div className="w-[160px]">
        <Select
          className="text-xs h-9 bg-surface"
          value={currentAssignee}
          onChange={(e) => updateParam("assignee", e.target.value)}
        >
          <option value="">All Assignees</option>
          {members.map((m) => (
            <option key={m.user_id} value={m.user_id}>
              {m.full_name}
            </option>
          ))}
        </Select>
      </div>

      {isPending && (
        <span className="text-[11px] text-ink-faint animate-pulse">
          Filtering...
        </span>
      )}
    </div>
  );
}
