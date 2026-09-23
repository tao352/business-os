"use client";

import React, { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

interface OpportunityFilterToolbarProps {
  members: Array<{ user_id: string; full_name: string }>;
}

export function OpportunityFilterToolbar({
  members,
}: OpportunityFilterToolbarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const updateParam = (key: string, value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    params.delete("page");
    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`);
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="relative min-w-[240px] flex-1 max-w-sm">
        <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint pointer-events-none" />
        <Input
          type="text"
          placeholder="Search Opportunity or customer..."
          defaultValue={searchParams.get("search") || ""}
          className="pl-8 text-xs h-9 bg-surface"
          onChange={(e) => updateParam("search", e.target.value)}
        />
      </div>

      <div className="w-[160px]">
        <Select
          className="text-xs h-9 bg-surface"
          value={searchParams.get("stage") || ""}
          onChange={(e) => updateParam("stage", e.target.value)}
        >
          <option value="">All Stages</option>
          <option value="DISCOVERY">Discovery</option>
          <option value="PROPOSAL">Proposal</option>
          <option value="NEGOTIATION">Negotiation</option>
          <option value="WON">Won</option>
          <option value="LOST">Lost</option>
        </Select>
      </div>

      <div className="w-[170px]">
        <Select
          className="text-xs h-9 bg-surface"
          value={searchParams.get("assignee") || ""}
          onChange={(e) => updateParam("assignee", e.target.value)}
        >
          <option value="">All Assignees</option>
          {members.map((member) => (
            <option key={member.user_id} value={member.user_id}>
              {member.full_name}
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
