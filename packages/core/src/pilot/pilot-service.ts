import { logger } from "@business-os/logger";
import type { TenantContext, TenantRole } from "@business-os/types";
import { registerUser } from "../auth/auth-service.js";
import { createOrganization } from "../auth/index.js";
import { inviteMember } from "../permissions/member-service.js";
import { setFeatureFlag } from "../ops/feature-flags-service.js";

export interface PilotStaffInput {
  email: string;
  fullName: string;
  role: TenantRole;
}

export interface ProvisionPilotInput {
  organizationName: string;
  slug: string;
  ownerEmail: string;
  ownerName: string;
  staff?: PilotStaffInput[];
  featureFlags?: string[];
}

export interface ProvisionedPilotResult {
  organizationId: string;
  organizationName: string;
  slug: string;
  ownerUserId: string;
  staffCount: number;
  activatedFlags: string[];
  context: TenantContext;
}

const DEFAULT_PILOT_FLAGS = [
  "ai_builder_v1",
  "whatsapp_cloud_two_way",
  "pilot_experimental_dashboards",
  "meta_lead_ads_auto_sync",
];

/**
 * Onboards and provisions a controlled pilot developer organization (Master Plan Section 67).
 */
export async function provisionPilotOrganization(
  input: ProvisionPilotInput,
): Promise<ProvisionedPilotResult> {
  logger.info(
    { orgName: input.organizationName },
    "Initiating pilot organization provisioning",
  );

  // 1. Create or Register Owner
  const owner = await registerUser({
    email: input.ownerEmail,
    password: "PilotPassword2026!",
    fullName: input.ownerName,
  });

  // 2. Create Pilot Organization
  const org = await createOrganization({
    userId: owner.id,
    name: input.organizationName,
    slug: input.slug,
  });

  const tenantContext: TenantContext = {
    userId: owner.id,
    organizationId: org.id,
    role: "OWNER",
    correlationId: `pilot-init-${org.id}`,
  };

  // 3. Activate Pilot Feature Flags
  const flagsToActivate = input.featureFlags || DEFAULT_PILOT_FLAGS;
  for (const flagKey of flagsToActivate) {
    await setFeatureFlag(
      {
        key: flagKey,
        name: `Pilot: ${flagKey}`,
        enabled_globally: false,
        target_tenants: [org.id],
      },
      tenantContext,
    );
  }

  // 4. Invite Initial Staff Members
  let staffCount = 0;
  if (input.staff && input.staff.length > 0) {
    for (const member of input.staff) {
      await inviteMember(tenantContext, {
        email: member.email,
        fullName: member.fullName,
        role: member.role,
      });
      staffCount++;
    }
  }

  logger.info(
    { organizationId: org.id, staffCount, flagsCount: flagsToActivate.length },
    "Successfully provisioned pilot organization",
  );

  return {
    organizationId: org.id,
    organizationName: org.name,
    slug: org.slug,
    ownerUserId: owner.id,
    staffCount,
    activatedFlags: flagsToActivate,
    context: tenantContext,
  };
}
