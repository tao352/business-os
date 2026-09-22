/**
 * @deprecated Deal is the legacy name for a Sales Opportunity.
 *
 * New code should import from `../sales/opportunity-service.js` (or the
 * package Sales exports). These aliases intentionally preserve existing callers
 * while R1 migrates the domain boundary without renaming the physical table.
 */
export {
  createOpportunity as createDeal,
  updateOpportunityStage as updateDealStage,
  listOpportunities as listDeals,
} from "../sales/opportunity-service.js";

export type {
  Opportunity as Deal,
  OpportunityStage as DealStage,
  CreateOpportunityInput as CreateDealInput,
  ListOpportunitiesFilters as ListDealsFilters,
} from "../sales/opportunity-service.js";
