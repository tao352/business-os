"use client";

import React, { useState } from "react";
import { RefreshCw, TrendingUp } from "lucide-react";
import type { OpportunityStage } from "@business-os/core";
import { Button } from "@/components/ui/button";
import {
  OpportunityStageDialog,
  ReopenOpportunityDialog,
} from "./opportunity-stage-dialog";

interface OpportunityActionsBarProps {
  opportunityId: string;
  currentStage: OpportunityStage;
  canUpdate?: boolean;
}

export function OpportunityActionsBar({
  opportunityId,
  currentStage,
  canUpdate = true,
}: OpportunityActionsBarProps) {
  const [isStageOpen, setIsStageOpen] = useState(false);
  const [isReopenOpen, setIsReopenOpen] = useState(false);

  if (!canUpdate || currentStage === "WON") {
    return (
      <span className="inline-flex items-center px-2.5 py-1 rounded-md bg-surface-muted text-ink-muted text-xs font-medium border border-line">
        {currentStage === "WON" ? "Won — closed" : "Read-only view"}
      </span>
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {currentStage === "LOST" ? (
          <Button
            size="sm"
            variant="primary"
            onClick={() => setIsReopenOpen(true)}
            className="text-xs"
          >
            <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
            Reopen
          </Button>
        ) : (
          <Button
            size="sm"
            variant="primary"
            onClick={() => setIsStageOpen(true)}
            className="text-xs"
          >
            <TrendingUp className="w-3.5 h-3.5 mr-1.5" />
            Change Stage
          </Button>
        )}
      </div>

      {currentStage !== "LOST" && (
        <OpportunityStageDialog
          isOpen={isStageOpen}
          onClose={() => setIsStageOpen(false)}
          opportunityId={opportunityId}
          currentStage={currentStage}
        />
      )}

      {currentStage === "LOST" && (
        <ReopenOpportunityDialog
          isOpen={isReopenOpen}
          onClose={() => setIsReopenOpen(false)}
          opportunityId={opportunityId}
        />
      )}
    </>
  );
}
