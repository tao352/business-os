import React from "react";
import { withTenantContext } from "@business-os/database";
import { requireTenantContext } from "@/lib/auth";
import { Badge } from "@/components/ui/badge";
import { Cpu } from "lucide-react";
import { formatDate } from "@/lib/formatters";

export default async function AutomationsPage() {
  const context = await requireTenantContext();

  const rules = await withTenantContext(context.organizationId, async (tx) => {
    const res = await tx.query(`
        SELECT id, name, trigger_event, is_active, created_at, updated_at
        FROM smart_rules
        ORDER BY created_at DESC
      `);
    return res.rows;
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-ink tracking-tight">
          Automations & Smart Rules
        </h1>
        <p className="text-xs text-ink-muted mt-0.5">
          Configured event triggers and background automation rules
        </p>
      </div>

      {rules.length === 0 ? (
        <div className="bg-surface border border-line rounded-xl p-12 text-center">
          <Cpu className="w-8 h-8 text-ink-faint mx-auto mb-2" />
          <p className="text-sm font-medium text-ink">
            No smart rules configured
          </p>
          <p className="text-xs text-ink-muted mt-1">
            Rules execute actions automatically upon lead creation or status
            updates.
          </p>
        </div>
      ) : (
        <div className="bg-surface border border-line rounded-xl overflow-hidden shadow-none">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-line bg-surface-subtle text-[11px] font-semibold text-ink-muted tracking-wider uppercase select-none">
                  <th className="py-3 px-4">Rule Name</th>
                  <th className="py-3 px-4">Trigger Event</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-subtle">
                {rules.map((rule: any) => (
                  <tr
                    key={rule.id}
                    className="hover:bg-surface-subtle transition-colors h-12"
                  >
                    <td className="py-2.5 px-4 font-semibold text-ink">
                      {rule.name}
                    </td>
                    <td className="py-2.5 px-4 font-mono text-ink-secondary text-xs">
                      {rule.trigger_event}
                    </td>
                    <td className="py-2.5 px-4">
                      <Badge variant={rule.is_active ? "success" : "neutral"}>
                        {rule.is_active ? "Active" : "Inactive"}
                      </Badge>
                    </td>
                    <td className="py-2.5 px-4 text-right text-ink-muted">
                      {formatDate(rule.updated_at || rule.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
