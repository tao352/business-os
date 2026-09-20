import React from "react";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/formatters";
import { completeTaskAction } from "@/lib/actions/lead-actions";
import { Check, Clock } from "lucide-react";

interface LeadSidePanelProps {
  lead: {
    id: string;
    phone?: string | null;
    email?: string | null;
    status: any;
    source: string;
    assigned_name?: string | null;
    custom_data?: any;
    created_at: string | Date;
    updated_at: string | Date;
    contact_info_redacted?: boolean;
  };
  tasks: Array<{
    id: string;
    title: string;
    due_date: string | Date;
    priority?: string;
    is_completed: boolean;
  }>;
  canCompleteTasks?: boolean;
}

export function LeadSidePanel({
  lead,
  tasks,
  canCompleteTasks = true,
}: LeadSidePanelProps) {
  const openTasks = tasks.filter((t) => !t.is_completed);
  const customEntries = Object.entries(lead.custom_data || {}).filter(
    ([, v]) => v !== null && v !== undefined && v !== "",
  );

  return (
    <div className="bg-surface border border-line rounded-xl p-5 space-y-6 text-xs select-none">
      {/* Contact Section */}
      <div>
        <h3 className="text-[11px] font-semibold text-ink-muted uppercase tracking-wider mb-3">
          Contact Information
        </h3>
        <dl className="space-y-2.5">
          <div className="flex justify-between">
            <dt className="text-ink-muted">Phone</dt>
            <dd className="font-mono font-medium text-ink select-text">
              {lead.phone}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-ink-muted">Email</dt>
            <dd className="font-medium text-ink select-text truncate max-w-[170px]">
              {lead.email || "—"}
            </dd>
          </div>
        </dl>
      </div>

      <div className="border-t border-line-subtle" />

      {/* Sales Section */}
      <div>
        <h3 className="text-[11px] font-semibold text-ink-muted uppercase tracking-wider mb-3">
          Sales & Pipeline
        </h3>
        <dl className="space-y-2.5">
          <div className="flex justify-between items-center">
            <dt className="text-ink-muted">Status</dt>
            <dd>
              <Badge status={lead.status}>{lead.status}</Badge>
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-ink-muted">Assigned To</dt>
            <dd className="font-medium text-ink">
              {lead.assigned_name || (
                <span className="text-ink-faint italic">Unassigned</span>
              )}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-ink-muted">Source</dt>
            <dd className="font-medium text-ink">{lead.source}</dd>
          </div>
        </dl>
      </div>

      <div className="border-t border-line-subtle" />

      {/* Follow-up & Tasks Section */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-[11px] font-semibold text-ink-muted uppercase tracking-wider">
            Open Tasks
          </h3>
          <span className="text-[11px] text-ink-faint">
            {openTasks.length} pending
          </span>
        </div>

        {openTasks.length === 0 ? (
          <p className="text-ink-faint text-xs py-1">
            No open follow-up tasks.
          </p>
        ) : (
          <ul className="space-y-2">
            {openTasks.map((t) => (
              <li
                key={t.id}
                className="p-2.5 rounded-md border border-line-subtle bg-surface-subtle flex items-start justify-between gap-2"
              >
                <div className="min-w-0">
                  <div className="font-medium text-ink truncate text-xs">
                    {t.title}
                  </div>
                  <div className="text-[11px] text-ink-faint flex items-center gap-1 mt-0.5">
                    <Clock className="w-3 h-3 text-ink-faint" />
                    <span>Due {formatDate(t.due_date)}</span>
                  </div>
                </div>
                {canCompleteTasks && (
                  <form
                    action={async () => {
                      "use server";
                      await completeTaskAction(t.id, lead.id);
                    }}
                  >
                    <button
                      type="submit"
                      title="Mark complete"
                      className="p-1 text-ink-muted hover:text-emerald-700 hover:bg-emerald-50 rounded transition-colors"
                    >
                      <Check className="w-3.5 h-3.5" />
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Custom Fields Section (if any configured) */}
      {customEntries.length > 0 && (
        <>
          <div className="border-t border-line-subtle" />
          <div>
            <h3 className="text-[11px] font-semibold text-ink-muted uppercase tracking-wider mb-3">
              Custom Attributes
            </h3>
            <dl className="space-y-2.5">
              {customEntries.map(([k, v]) => (
                <div key={k} className="flex justify-between">
                  <dt className="text-ink-muted capitalize">
                    {k.replace(/_/g, " ")}
                  </dt>
                  <dd className="font-medium text-ink select-text">
                    {String(v)}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </>
      )}

      <div className="border-t border-line-subtle" />

      {/* Metadata */}
      <div className="pt-1 text-[11px] text-ink-faint space-y-1">
        <div>Created {formatDate(lead.created_at)}</div>
        <div>Updated {formatDate(lead.updated_at)}</div>
      </div>
    </div>
  );
}
