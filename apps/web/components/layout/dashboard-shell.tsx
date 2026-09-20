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

  return (
    <div className="flex h-screen overflow-hidden bg-canvas text-ink">
      <Sidebar session={session} />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <TopBar onNewLeadClick={() => setIsCreateLeadOpen(true)} />
        <main className="flex-1 overflow-y-auto p-6 md:p-8">
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
