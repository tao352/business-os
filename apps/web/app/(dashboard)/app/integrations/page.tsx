import React from "react";
import { withTenantContext } from "@business-os/database";
import { requireTenantContext } from "@/lib/auth";
import { Badge } from "@/components/ui/badge";
import { MessageSquare, Share2 } from "lucide-react";

export default async function IntegrationsPage() {
  const context = await requireTenantContext();

  const integrations = await withTenantContext(
    context.organizationId,
    async (tx) => {
      const res = await tx.query(`
        SELECT provider, is_active, config, updated_at
        FROM tenant_integrations
        ORDER BY provider ASC
      `);
      return res.rows;
    },
  );

  const metaIntegration = integrations.find(
    (i: any) => i.provider === "META_LEAD_ADS",
  );
  const waIntegration = integrations.find(
    (i: any) => i.provider === "WHATSAPP",
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-ink tracking-tight">
          External Integrations
        </h1>
        <p className="text-xs text-ink-muted mt-0.5">
          Connection status for ad platforms and messaging channels
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Meta Lead Ads Card */}
        <div className="bg-surface border border-line rounded-xl p-6 flex flex-col justify-between">
          <div>
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-600">
                  <Share2 className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-ink">
                    Meta Lead Ads
                  </h2>
                  <p className="text-xs text-ink-muted">
                    Facebook & Instagram instant forms
                  </p>
                </div>
              </div>
              <Badge
                variant={metaIntegration?.is_active ? "success" : "neutral"}
              >
                {metaIntegration?.is_active ? "Connected" : "Disconnected"}
              </Badge>
            </div>

            <p className="text-xs text-ink-secondary leading-relaxed mb-4">
              Direct webhook integration receiving inbound lead ads with
              cryptographic HMAC-SHA256 signature verification.
            </p>
          </div>

          <div className="pt-4 border-t border-line-subtle text-xs text-ink-muted flex justify-between">
            <span>Webhook Status</span>
            <span className="font-mono text-ink">
              {metaIntegration?.is_active ? "Active" : "Not configured"}
            </span>
          </div>
        </div>

        {/* WhatsApp Cloud API Card */}
        <div className="bg-surface border border-line rounded-xl p-6 flex flex-col justify-between">
          <div>
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-600">
                  <MessageSquare className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-ink">
                    WhatsApp Cloud API
                  </h2>
                  <p className="text-xs text-ink-muted">
                    Official Meta WhatsApp Business API
                  </p>
                </div>
              </div>
              <Badge variant={waIntegration?.is_active ? "success" : "neutral"}>
                {waIntegration?.is_active ? "Connected" : "Disconnected"}
              </Badge>
            </div>

            <p className="text-xs text-ink-secondary leading-relaxed mb-4">
              Transactional outbox messaging and inbound webhook ingestion with
              deduplicated message handling.
            </p>
          </div>

          <div className="pt-4 border-t border-line-subtle text-xs text-ink-muted flex justify-between">
            <span>Channel Health</span>
            <span className="font-mono text-ink">
              {waIntegration?.is_active ? "Active" : "Not configured"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
