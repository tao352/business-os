import { z } from "zod";

export const AiBuilderIntentTypeSchema = z.enum([
  "CREATE_CUSTOM_FIELD",
  "CREATE_SMART_RULE",
  "CREATE_SAVED_VIEW",
]);
export type AiBuilderIntentType = z.infer<typeof AiBuilderIntentTypeSchema>;

export interface ChangeProposal {
  id: string;
  intentType: AiBuilderIntentType;
  title: string;
  description: string;
  proposedPayload: Record<string, unknown>;
  previewDiff: {
    entity: string;
    action: string;
    changes: Record<string, unknown>;
  };
  status: "PENDING_APPROVAL" | "APPLIED" | "REJECTED";
  createdAt: Date;
}

export interface ApplyProposalResult {
  proposalId: string;
  applied: boolean;
  resourceType: string;
  resourceId: string;
  resource: unknown;
}
