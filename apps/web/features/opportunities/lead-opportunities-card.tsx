import React from "react";
import Link from "next/link";
import type { Opportunity } from "@business-os/core";
import { Badge } from "@/components/ui/badge";
import { formatCurrency, formatDate } from "@/lib/formatters";
import { Target } from "lucide-react";

interface LeadOpportunitiesCardProps {
  opportunities: Opportunity[];
}

export function LeadOpportunitiesCard({
  opportunities,
}: LeadOpportunitiesCardProps) {
  return (
    <div className="bg-surface border border-line rounded-xl p-5 space-y-4 text-xs">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-ink flex items-center gap-2">
            <Target className="w-4 h-4 text-accent" />
            Sales Opportunities ({opportunities.length})
          </h3>
          <p className="text-[11px] text-ink-muted mt-0.5">
            Separate commercial deals for this customer.
          </p>
        </div>
        <Link
          href="/app/opportunities"
          className="text-[11px] font-semibold text-accent hover:underline"
        >
          View pipeline
        </Link>
      </div>

      {opportunities.length === 0 ? (
        <div className="p-4 border border-line-subtle rounded-lg bg-surface-subtle text-center text-ink-muted">
          No commercial Opportunities yet. Use “New Opportunity” above when a
          concrete deal starts.
        </div>
      ) : (
        <div className="space-y-2">
          {opportunities.map((opportunity) => (
            <Link
              key={opportunity.id}
              href={`/app/opportunities/${opportunity.id}`}
              className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-lg border border-line hover:border-line-strong hover:bg-surface-subtle transition-colors"
            >
              <div className="min-w-0">
                <div className="font-semibold text-ink text-sm truncate">
                  {opportunity.title}
                </div>
                <div className="text-[11px] text-ink-muted mt-1">
                  Expected close {formatDate(opportunity.expected_close_date)}
                </div>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <span className="font-semibold text-ink">
                  {formatCurrency(
                    Number(opportunity.value),
                    opportunity.currency,
                  )}
                </span>
                <Badge status={opportunity.stage}>{opportunity.stage}</Badge>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
