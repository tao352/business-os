"use client";

import React from "react";
import { useRouter } from "next/navigation";
import type { OpportunityListItem } from "@business-os/core";
import { Badge } from "@/components/ui/badge";
import { formatCurrency, formatDate } from "@/lib/formatters";

interface OpportunityTableProps {
  opportunities: OpportunityListItem[];
  totalCount: number;
  currentPage: number;
  pageSize: number;
}

export function OpportunityTable({
  opportunities,
  totalCount,
  currentPage,
  pageSize,
}: OpportunityTableProps) {
  const router = useRouter();
  const totalPages = Math.ceil(totalCount / pageSize);

  const goToPage = (page: number) => {
    const url = new URL(window.location.href);
    url.searchParams.set("page", page.toString());
    router.push(url.toString());
  };

  if (opportunities.length === 0) {
    return (
      <div className="bg-surface border border-line rounded-xl p-12 text-center">
        <p className="text-sm font-medium text-ink">No Opportunities found</p>
        <p className="text-xs text-ink-muted mt-1">
          Create an Opportunity from a customer Lead or adjust the filters.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-surface border border-line rounded-xl overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-line bg-surface-subtle text-[11px] font-semibold text-ink-muted tracking-wider uppercase select-none">
              <th className="py-3 px-4">Opportunity</th>
              <th className="py-3 px-4">Customer</th>
              <th className="py-3 px-4">Stage</th>
              <th className="py-3 px-4">Value</th>
              <th className="py-3 px-4">Assigned To</th>
              <th className="py-3 px-4 text-right">Expected Close</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line-subtle text-xs">
            {opportunities.map((opportunity) => (
              <tr
                key={opportunity.id}
                onClick={() =>
                  router.push(`/app/opportunities/${opportunity.id}`)
                }
                className="hover:bg-surface-subtle cursor-pointer transition-colors h-14"
              >
                <td className="py-2.5 px-4">
                  <div className="font-semibold text-ink text-sm truncate max-w-[240px]">
                    {opportunity.title}
                  </div>
                  <div className="text-[11px] text-ink-faint mt-0.5">
                    Updated {formatDate(opportunity.updated_at)}
                  </div>
                </td>
                <td className="py-2.5 px-4">
                  <div className="font-medium text-ink">
                    {opportunity.lead_name}
                  </div>
                  <div className="text-[11px] text-ink-muted font-mono mt-0.5">
                    {opportunity.lead_phone}
                  </div>
                </td>
                <td className="py-2.5 px-4">
                  <Badge status={opportunity.stage}>{opportunity.stage}</Badge>
                </td>
                <td className="py-2.5 px-4 font-semibold text-ink">
                  {formatCurrency(
                    Number(opportunity.value),
                    opportunity.currency,
                  )}
                </td>
                <td className="py-2.5 px-4 text-ink-secondary">
                  {opportunity.assignee_name || (
                    <span className="text-ink-faint italic">Unassigned</span>
                  )}
                </td>
                <td className="py-2.5 px-4 text-right text-ink-muted">
                  {formatDate(opportunity.expected_close_date)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="px-4 py-3 border-t border-line bg-surface-subtle flex items-center justify-between text-xs text-ink-muted select-none">
        <div>
          Showing{" "}
          <span className="font-medium text-ink">
            {Math.min((currentPage - 1) * pageSize + 1, totalCount)}
          </span>{" "}
          to{" "}
          <span className="font-medium text-ink">
            {Math.min(currentPage * pageSize, totalCount)}
          </span>{" "}
          of <span className="font-medium text-ink">{totalCount}</span>{" "}
          Opportunities
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => goToPage(currentPage - 1)}
            disabled={currentPage <= 1}
            className="px-2.5 py-1 text-xs border border-line rounded bg-surface hover:bg-surface-subtle disabled:opacity-40 disabled:cursor-not-allowed text-ink font-medium transition-colors"
          >
            Previous
          </button>
          <span className="text-[11px] px-1">
            Page {currentPage} of {totalPages || 1}
          </span>
          <button
            onClick={() => goToPage(currentPage + 1)}
            disabled={currentPage >= totalPages}
            className="px-2.5 py-1 text-xs border border-line rounded bg-surface hover:bg-surface-subtle disabled:opacity-40 disabled:cursor-not-allowed text-ink font-medium transition-colors"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
