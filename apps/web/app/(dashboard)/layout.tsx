import React from "react";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { DashboardShell } from "@/components/layout/dashboard-shell";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSessionUser();

  if (!session) {
    redirect("/login");
  }

  return <DashboardShell session={session}>{children}</DashboardShell>;
}
