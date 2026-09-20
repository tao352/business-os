"use client";

import React, { useState } from "react";
import { Sidebar } from "@/components/layout/sidebar";
import { TopBar } from "@/components/layout/topbar";
import { CreateLeadDrawer } from "@/features/leads/create-lead-drawer";
import type { SessionUser } from "@/lib/auth";

interface DashboardShellProps {
  session: SessionUser;
  children: React.ReactNode;
}

export function DashboardShell({ session, children }: DashboardShellProps) {
  const [isCreateLeadOpen, setIsCreateLeadOpen] = useState(false);
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden bg-canvas text-ink">
      {/* Mobile Backdrop */}
      {isMobileNavOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={() => setIsMobileNavOpen(false)}
        />
      )}

      {/* Sidebar - responsive container */}
      <div
        className={`fixed inset-y-0 left-0 z-50 transform transition-transform duration-200 ease-in-out md:static md:translate-x-0 ${
          isMobileNavOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <Sidebar
          session={session}
          onNavClick={() => setIsMobileNavOpen(false)}
        />
      </div>

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <TopBar
          onNewLeadClick={() => setIsCreateLeadOpen(true)}
          onMenuClick={() => setIsMobileNavOpen(true)}
          canCreateLead={session.capabilities?.canCreateLead}
        />
        <main className="flex-1 overflow-y-auto p-4 md:p-8">
          <div className="max-w-[1400px] mx-auto w-full">{children}</div>
        </main>
      </div>

      <CreateLeadDrawer
        isOpen={isCreateLeadOpen}
        onClose={() => setIsCreateLeadOpen(false)}
      />
    </div>
  );
}
