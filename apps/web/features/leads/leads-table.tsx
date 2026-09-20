"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/formatters";
import type { LeadStatus } from "@business-os/types";

export interface LeadRow {
  id: string;
  full_name: string;
  phone: string;
  email: string | null;
  status: LeadStatus;
  source: string;
  assigned_name?: string | null;
  created_at: string;
  updated_at: string;
}

interface LeadsTableProps {
  leads: LeadRow[];
  totalCount: number;
  currentPage: number;
  pageSize: number;
}

export function LeadsTable({
  leads,
  totalCount,
  currentPage,
  pageSize,
}: LeadsTableProps) {
  const router = useRouter();
  const totalPages = Math.ceil(totalCount / pageSize);

  const goToPage = (page: number) => {
    const url = new URL(window.location.href);
    url.searchParams.set("page", page.toString());
    router.push(url.toString());
  };

  if (leads.length === 0) {
    return (
      <div className="bg-surface border border-line rounded-xl p-12 text-center">
        <p className="text-sm font-medium text-ink">No leads found</p>
        <p className="text-xs text-ink-muted mt-1">
          Try adjusting your search criteria or add a new lead.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-surface border border-line rounded-xl overflow-hidden shadow-none">
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-line bg-surface-subtle text-[11px] font-semibold text-ink-muted tracking-wider uppercase select-none">
              <th className="py-3 px-4">Contact</th>
              <th className="py-3 px-4">Phone</th>
              <th className="py-3 px-4">Status</th>
              <th className="py-3 px-4">Source</th>
              <th className="py-3 px-4">Assigned To</th>
              <th className="py-3 px-4 text-right">Created</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line-subtle text-xs">
            {leads.map((lead) => (
              <tr
                key={lead.id}
                onClick={() => router.push(`/app/leads/${lead.id}`)}
                className="hover:bg-surface-subtle cursor-pointer transition-colors h-14"
              >
                <td className="py-2.5 px-4">
                  <div className="font-semibold text-ink text-sm truncate max-w-[200px]">
                    {lead.full_name}
                  </div>
                  {lead.email && (
                    <div className="text-[11px] text-ink-muted truncate max-w-[200px]">
                      {lead.email}
                    </div>
                  )}
                </td>
                <td className="py-2.5 px-4 font-mono text-ink-secondary text-xs">
                  {lead.phone}
                </td>
                <td className="py-2.5 px-4">
                  <Badge status={lead.status}>{lead.status}</Badge>
                </td>
                <td className="py-2.5 px-4 text-ink-secondary text-xs">
                  {lead.source}
                </td>
                <td className="py-2.5 px-4 text-ink-secondary text-xs">
                  {lead.assigned_name || (
                    <span className="text-ink-faint italic">Unassigned</span>
                  )}
                </td>
                <td className="py-2.5 px-4 text-right text-ink-muted text-xs">
                  {formatDate(lead.created_at)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination Bar */}
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
          of <span className="font-medium text-ink">{totalCount}</span> leads
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
