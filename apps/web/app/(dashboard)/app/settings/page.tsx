import React from "react";
import { notFound } from "next/navigation";
import { getOrganizationSettings } from "@business-os/core";
import { requireTenantContext, getSessionUser } from "@/lib/auth";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/formatters";

export default async function SettingsPage() {
  const context = await requireTenantContext();
  const session = await getSessionUser();

  // Fetch organization settings & members via core read-model service (asserts org read permission)
  let settings: Awaited<ReturnType<typeof getOrganizationSettings>>;
  try {
    settings = await getOrganizationSettings(context);
  } catch {
    notFound();
  }

  const { organization: org, members } = settings;

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-xl font-semibold text-ink tracking-tight">
          Organization Settings
        </h1>
        <p className="text-xs text-ink-muted mt-0.5">
          Workspace profile, membership, and subscription plan
        </p>
      </div>

      {/* Organization Details Card */}
      <div className="bg-surface border border-line rounded-xl p-6">
        <h2 className="text-sm font-semibold text-ink mb-4">
          Workspace Profile
        </h2>
        <dl className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
          <div>
            <dt className="text-ink-muted mb-1">Organization Name</dt>
            <dd className="font-semibold text-ink">{org?.name}</dd>
          </div>
          <div>
            <dt className="text-ink-muted mb-1">Slug Identifier</dt>
            <dd className="font-mono text-ink-secondary">{org?.slug}</dd>
          </div>
          <div>
            <dt className="text-ink-muted mb-1">Subscription Plan</dt>
            <dd>
              <Badge variant="info">{org?.plan || "STARTER"}</Badge>
            </dd>
          </div>
          <div>
            <dt className="text-ink-muted mb-1">Provisioned On</dt>
            <dd className="text-ink-secondary">
              {formatDate(org?.created_at)}
            </dd>
          </div>
        </dl>
      </div>

      {/* Team Members */}
      <div className="bg-surface border border-line rounded-xl overflow-hidden shadow-none">
        <div className="p-5 border-b border-line">
          <h2 className="text-sm font-semibold text-ink">Team Members</h2>
          <p className="text-xs text-ink-muted mt-0.5">
            Staff with access to this tenant workspace ({members.length}{" "}
            members)
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-line bg-surface-subtle text-[11px] font-semibold text-ink-muted tracking-wider uppercase select-none">
                <th className="py-3 px-4">Member</th>
                <th className="py-3 px-4">Email</th>
                <th className="py-3 px-4">Role</th>
                <th className="py-3 px-4 text-right">Joined</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-subtle">
              {members.map((m) => (
                <tr
                  key={m.id}
                  className="hover:bg-surface-subtle transition-colors h-12"
                >
                  <td className="py-2.5 px-4 font-medium text-ink">
                    {m.full_name}
                    {m.user_id === session?.id && (
                      <span className="ml-1.5 text-[10px] text-ink-muted font-normal">
                        (You)
                      </span>
                    )}
                  </td>
                  <td className="py-2.5 px-4 text-ink-secondary">{m.email}</td>
                  <td className="py-2.5 px-4">
                    <Badge variant="neutral">{m.role}</Badge>
                  </td>
                  <td className="py-2.5 px-4 text-right text-ink-muted">
                    {formatDate(m.created_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
