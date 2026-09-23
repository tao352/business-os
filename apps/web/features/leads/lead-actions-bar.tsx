"use client";

import React, { useState } from "react";
import { FileText, Calendar, UserCheck, CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AddNoteDialog } from "./add-note-dialog";
import { CreateTaskDialog } from "./create-task-dialog";
import { ChangeStatusDialog } from "./change-status-dialog";
import { ReassignLeadDialog } from "./reassign-lead-dialog";
import { CreateOpportunityDialog } from "@/features/opportunities/create-opportunity-dialog";
import type { LeadStatus, TenantRole } from "@business-os/types";

interface LeadActionsBarProps {
  leadId: string;
  currentStatus: LeadStatus;
  currentAssigneeId?: string | null;
  userRole: TenantRole;
  members: Array<{ user_id: string; full_name: string; role: string }>;
  canUpdateLead?: boolean;
  canReassignLead?: boolean;
  canCreateOpportunity?: boolean;
  leadName: string;
}

export function LeadActionsBar({
  leadId,
  currentStatus,
  currentAssigneeId,
  userRole,
  members,
  canUpdateLead = true,
  canReassignLead,
  canCreateOpportunity = false,
  leadName,
}: LeadActionsBarProps) {
  const [isNoteOpen, setIsNoteOpen] = useState(false);
  const [isTaskOpen, setIsTaskOpen] = useState(false);
  const [isStatusOpen, setIsStatusOpen] = useState(false);
  const [isReassignOpen, setIsReassignOpen] = useState(false);

  const canReassign =
    canReassignLead !== undefined
      ? canReassignLead
      : userRole === "OWNER" ||
        userRole === "ADMIN" ||
        userRole === "SALES_MANAGER";

  if (!canUpdateLead && !canReassign && !canCreateOpportunity) {
    return (
      <div className="flex items-center">
        <span className="inline-flex items-center px-2.5 py-1 rounded-md bg-surface-muted text-ink-muted text-xs font-medium border border-line">
          Read-only view
        </span>
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {canCreateOpportunity && (
          <CreateOpportunityDialog
            leadId={leadId}
            leadName={leadName}
            assignedUserId={currentAssigneeId}
            canCreate
          />
        )}

        {canUpdateLead && (
          <>
            <Button
              size="sm"
              variant="primary"
              onClick={() => setIsStatusOpen(true)}
              className="text-xs"
            >
              <CheckCircle className="w-3.5 h-3.5 mr-1.5" />
              Change Status
            </Button>

            <Button
              size="sm"
              variant="secondary"
              onClick={() => setIsNoteOpen(true)}
              className="text-xs"
            >
              <FileText className="w-3.5 h-3.5 mr-1.5" />
              Add Note
            </Button>

            <Button
              size="sm"
              variant="secondary"
              onClick={() => setIsTaskOpen(true)}
              className="text-xs"
            >
              <Calendar className="w-3.5 h-3.5 mr-1.5" />
              Follow-up
            </Button>
          </>
        )}

        {canReassign && (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setIsReassignOpen(true)}
            className="text-xs"
          >
            <UserCheck className="w-3.5 h-3.5 mr-1.5" />
            Reassign
          </Button>
        )}
      </div>

      <ChangeStatusDialog
        isOpen={isStatusOpen}
        onClose={() => setIsStatusOpen(false)}
        leadId={leadId}
        currentStatus={currentStatus}
      />

      <AddNoteDialog
        isOpen={isNoteOpen}
        onClose={() => setIsNoteOpen(false)}
        leadId={leadId}
      />

      <CreateTaskDialog
        isOpen={isTaskOpen}
        onClose={() => setIsTaskOpen(false)}
        leadId={leadId}
      />

      {canReassign && (
        <ReassignLeadDialog
          isOpen={isReassignOpen}
          onClose={() => setIsReassignOpen(false)}
          leadId={leadId}
          currentAssigneeId={currentAssigneeId}
          members={members}
        />
      )}
    </>
  );
}
