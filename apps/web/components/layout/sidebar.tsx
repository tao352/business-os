"use client";

import React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  Building2,
  Boxes,
  Cpu,
  Share2,
  Settings,
  LogOut,
  ChevronDown,
  Building,
  Activity,
} from "lucide-react";
import type { SessionUser } from "@/lib/auth";

interface SidebarProps {
  session: SessionUser;
  onNavClick?: () => void;
}

export function Sidebar({ session, onNavClick }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [isOrgDropdownOpen, setIsOrgDropdownOpen] = React.useState(false);
  const [isSwitching, setIsSwitching] = React.useState(false);

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  };

  const handleSwitchOrg = async (targetOrgId: string) => {
    if (targetOrgId === session.activeOrganization.id) {
      setIsOrgDropdownOpen(false);
      return;
    }
    setIsSwitching(true);
    try {
      const res = await fetch("/api/auth/switch-org", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetOrganizationId: targetOrgId }),
      });
      if (res.ok) {
        setIsOrgDropdownOpen(false);
        router.refresh();
      }
    } finally {
      setIsSwitching(false);
    }
  };

  // Capability-aware navigation gating (authoritative matrix-backed)
  const role = session.role;
  const caps = session.capabilities;

  const workspaceItems = [
    { label: "Overview", href: "/app", icon: LayoutDashboard },
    { label: "Leads", href: "/app/leads", icon: Users },
    ...(caps?.canReadSalesCommandCenter
      ? [{ label: "Sales", href: "/app/sales", icon: Activity }]
      : []),
    ...(caps?.canReadProjects
      ? [{ label: "Projects", href: "/app/projects", icon: Building2 }]
      : []),
    ...(caps?.canReadUnits
      ? [{ label: "Units", href: "/app/units", icon: Boxes }]
      : []),
  ];

  const intelligenceItems = caps?.canReadAutomations
    ? [{ label: "Automations", href: "/app/automations", icon: Cpu }]
    : [];

  const systemItems = [
    ...(caps?.canReadIntegrations
      ? [{ label: "Integrations", href: "/app/integrations", icon: Share2 }]
      : []),
    ...(caps?.canReadSettings
      ? [{ label: "Settings", href: "/app/settings", icon: Settings }]
      : []),
  ];

  const navSections = [
    {
      title: "Workspace",
      items: workspaceItems,
    },
    ...(intelligenceItems.length > 0
      ? [
          {
            title: "Intelligence",
            items: intelligenceItems,
          },
        ]
      : []),
    ...(systemItems.length > 0
      ? [
          {
            title: "System",
            items: systemItems,
          },
        ]
      : []),
  ];

  return (
    <aside className="w-[232px] bg-sidebar border-r border-sidebar-border flex flex-col h-screen shrink-0 text-sidebar-text select-none">
      {/* Brand & Organization Header */}
      <div className="p-4 border-b border-sidebar-border relative">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-6 h-6 rounded bg-accent flex items-center justify-center text-white font-semibold text-xs shrink-0">
              B
            </div>
            <div className="min-w-0">
              <span className="text-sm font-semibold text-white tracking-tight block truncate">
                Business OS
              </span>
            </div>
          </div>
        </div>

        {/* Organization Switcher Trigger */}
        <button
          onClick={() => setIsOrgDropdownOpen(!isOrgDropdownOpen)}
          className="mt-3 w-full flex items-center justify-between px-2.5 py-1.5 rounded-md bg-sidebar-hover text-xs text-sidebar-text hover:text-white transition-colors"
        >
          <div className="flex items-center gap-2 min-w-0">
            <Building className="w-3.5 h-3.5 shrink-0 text-ink-faint" />
            <span className="truncate font-medium text-white">
              {session.activeOrganization.name}
            </span>
          </div>
          {session.organizations.length > 1 && (
            <ChevronDown className="w-3.5 h-3.5 shrink-0 text-ink-faint" />
          )}
        </button>

        {/* Organization Switcher Dropdown */}
        {isOrgDropdownOpen && session.organizations.length > 1 && (
          <div className="absolute top-[88px] left-3 right-3 bg-surface border border-line rounded-lg shadow-xl z-50 py-1 overflow-hidden">
            <div className="px-3 py-1.5 text-[11px] font-medium text-ink-muted border-b border-line">
              Switch Organization
            </div>
            {session.organizations.map((org) => (
              <button
                key={org.id}
                onClick={() => handleSwitchOrg(org.id)}
                disabled={isSwitching}
                className={`w-full text-left px-3 py-2 text-xs flex items-center justify-between hover:bg-surface-subtle transition-colors ${
                  org.id === session.activeOrganization.id
                    ? "font-semibold text-accent"
                    : "text-ink"
                }`}
              >
                <span className="truncate">{org.name}</span>
                <span className="text-[10px] text-ink-muted uppercase">
                  {org.role}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Navigation Sections */}
      <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-5">
        {navSections.map((section) => (
          <div key={section.title}>
            <div className="px-2.5 mb-1.5 text-[11px] font-medium tracking-wider text-ink-muted uppercase">
              {section.title}
            </div>
            <ul className="space-y-0.5">
              {section.items.map((item) => {
                const isActive =
                  item.href === "/app"
                    ? pathname === "/app"
                    : pathname.startsWith(item.href);
                const Icon = item.icon;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onNavClick}
                      className={`flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
                        isActive
                          ? "bg-sidebar-active-bg text-sidebar-active border-l-2 border-accent pl-[8px]"
                          : "text-sidebar-text hover:text-white hover:bg-sidebar-hover"
                      }`}
                    >
                      <Icon
                        className={`w-4 h-4 shrink-0 ${
                          isActive ? "text-accent" : "text-sidebar-text"
                        }`}
                      />
                      <span className="truncate">{item.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {/* Footer User Profile & Sign Out */}
      <div className="p-3 border-t border-sidebar-border">
        <div className="flex items-center justify-between px-2 py-1.5">
          <div className="min-w-0 pr-2">
            <div className="text-xs font-medium text-white truncate">
              {session.fullName}
            </div>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="text-[10px] text-sidebar-text uppercase font-semibold">
                {role}
              </span>
            </div>
          </div>
          <button
            onClick={handleLogout}
            title="Sign out"
            className="p-1.5 rounded text-sidebar-text hover:text-white hover:bg-sidebar-hover transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </aside>
  );
}
