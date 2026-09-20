import React from "react";
import { getIntegrationStatus } from "@business-os/core";
import { requireTenantContext } from "@/lib/auth";
import { Badge } from "@/components/ui/badge";
import { MessageSquare, Share2 } from "lucide-react";
import { formatDate } from "@/lib/formatters";

export default async function IntegrationsPage() {
  const context = await requireTenantContext();

  // Fetch verified integration status via core read-model service
  const integrations = await getIntegrationStatus(context);
  const { meta, whatsapp } = integrations;

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
              <Badge variant={meta.connected ? "success" : "neutral"}>
                {meta.connected ? "Connected" : "Disconnected"}
              </Badge>
            </div>

            <p className="text-xs text-ink-secondary leading-relaxed mb-4">
              Direct webhook integration receiving inbound lead ads with
              cryptographic HMAC-SHA256 signature verification.
            </p>

            {meta.connected && meta.pageName && (
              <div className="text-xs text-ink-muted mb-2">
                Page:{" "}
                <span className="text-ink font-medium">{meta.pageName}</span>{" "}
                {meta.pageIdMasked && (
                  <span className="font-mono text-ink-faint">
                    ({meta.pageIdMasked})
                  </span>
                )}
              </div>
            )}
          </div>

          <div className="pt-4 border-t border-line-subtle text-xs text-ink-muted flex justify-between">
            <span>Webhook Status</span>
            <span className="font-mono text-ink">
              {meta.connected ? "Active" : "Not configured"}
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
              <Badge variant={whatsapp.connected ? "success" : "neutral"}>
                {whatsapp.connected ? "Connected" : "Disconnected"}
              </Badge>
            </div>

            <p className="text-xs text-ink-secondary leading-relaxed mb-4">
              Transactional outbox messaging and inbound webhook ingestion with
              deduplicated message handling.
            </p>

            {whatsapp.connected && whatsapp.phoneDisplay && (
              <div className="text-xs text-ink-muted mb-2">
                Number:{" "}
                <span className="font-mono text-ink font-medium">
                  {whatsapp.phoneDisplay}
                </span>
              </div>
            )}
          </div>

          <div className="pt-4 border-t border-line-subtle text-xs text-ink-muted flex justify-between">
            <span>Channel Health</span>
            <span className="font-mono text-ink">
              {whatsapp.connected ? "Active" : "Not configured"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
