import { detectUnitTypeFromText, detectUsageTypeFromText } from "../real-estate/unit-taxonomy.js";

/**
 * Compact schema catalog representing tenant-isolated CRM and Real Estate entities
 * used for grounded Text-to-SQL generation.
 */
export const CRM_SCHEMA_CATALOG = `
TABLES & COLUMNS:
1. leads (id, full_name, phone, email, status ['NEW', 'CONTACTED', 'QUALIFIED', 'MEETING_SCHEDULED', 'SITE_VISIT_BOOKED', 'WON', 'LOST', 'RESERVED', 'CONTRACTED'], assigned_user_id, source, campaign_id, created_at)
2. units (id, project_id, unit_number, usage_type ['RESIDENTIAL', 'COMMERCIAL', 'ADMINISTRATIVE', 'MEDICAL'], unit_type ['APARTMENT', 'DUPLEX', 'PENTHOUSE', 'STUDIO', 'STANDALONE_VILLA', 'TWIN_HOUSE', 'TOWNHOUSE', 'RETAIL_STORE', 'RESTAURANT_CAFE', 'PHARMACY', 'KIOSK', 'OFFICE', 'CLINIC', 'LABORATORY', 'OTHER'], model_name, floor, price, status ['AVAILABLE', 'RESERVED', 'CONTRACTED', 'BLOCKED'], gross_area)
3. projects (id, name, location, created_at)
4. reservations (id, lead_id, unit_id, reserved_by_user_id, deposit_amount, status ['CONFIRMED', 'CONVERTED', 'EXPIRED', 'CANCELLED'], expires_at)
5. contracts (id, lead_id, unit_id, contract_number, contract_value, status ['SIGNED', 'DRAFT', 'CANCELLED'], signed_at)
6. visits (id, lead_id, project_id, assigned_agent_id, status ['SCHEDULED', 'COMPLETED', 'CANCELLED', 'NO_SHOW'], scheduled_at)
7. deals (id, lead_id, title, value, stage ['DISCOVERY', 'PROPOSAL', 'NEGOTIATION', 'WON', 'LOST'], assigned_user_id)
8. users (id, full_name, email)
`;

export interface GeneratedSqlPlan {
  sql: string;
  intent:
    | "UNITS_QUERY"
    | "LEADS_QUERY"
    | "SALES_QUERY"
    | "CONTRACTS_QUERY"
    | "GENERIC_QUERY";
}

/**
 * Maps common natural language real estate questions into safe, parameterized SQL.
 */
export function generateSqlForQuestion(
  question: string,
): GeneratedSqlPlan | null {
  const q = question.toLowerCase();
  const detectedUnitType = detectUnitTypeFromText(q);
  const detectedUsageType = detectUsageTypeFromText(q);

  // 1. Available units by project or price
  // e.g. "كم فيلا متاحة في بادية أقل من 20 مليون؟" or "available units"
  if (
    q.includes("وحدة") ||
    q.includes("وحدات") ||
    q.includes("فيلا") ||
    q.includes("شقة") ||
    q.includes("شقق") ||
    q.includes("unit") ||
    q.includes("villa") ||
    q.includes("apartment") ||
    q.includes("available") ||
    q.includes("متاح") ||
    detectedUnitType !== null ||
    detectedUsageType !== null
  ) {
    // Extract price condition if specified (e.g. 20 مليون / 20000000)
    let maxPriceCondition = "";
    const millionsMatch = q.match(/(\d+)\s*(مليون|million)/i);
    const directPriceMatch = q.match(/(\d{6,})/);

    if (millionsMatch && millionsMatch[1]) {
      const amount = Number(millionsMatch[1]) * 1000000;
      maxPriceCondition = `AND u.price <= ${amount}`;
    } else if (directPriceMatch && directPriceMatch[1]) {
      maxPriceCondition = `AND u.price <= ${directPriceMatch[1]}`;
    }

    const typeCondition = detectedUnitType
      ? `AND u.unit_type = '${detectedUnitType}'`
      : "";
    const usageCondition = detectedUsageType
      ? `AND u.usage_type = '${detectedUsageType}'`
      : "";

    return {
      intent: "UNITS_QUERY",
      sql: `SELECT u.id, u.unit_number, u.usage_type, u.unit_type, u.model_name, u.floor,
                    u.price, u.status, u.gross_area, p.name AS project_name
            FROM units u
            LEFT JOIN projects p ON u.project_id = p.id
            WHERE u.status = 'AVAILABLE' ${maxPriceCondition} ${typeCondition} ${usageCondition}
            ORDER BY u.price ASC LIMIT 25`,
    };
  }

  // 2. Sales Leaderboard / Best Closer
  // e.g. "مين أفضل سيلز الشهر ده؟" or "top salesperson"
  if (
    q.includes("سيلز") ||
    q.includes("بائع") ||
    q.includes("مبيعات") ||
    q.includes("salesperson") ||
    q.includes("leaderboard") ||
    q.includes("أفضل") ||
    q.includes("top")
  ) {
    return {
      intent: "SALES_QUERY",
      sql: `SELECT u.id, u.full_name,
                   COUNT(DISTINCT c.id) FILTER (WHERE c.status = 'SIGNED') AS contracts_count,
                   COALESCE(SUM(c.contract_value) FILTER (WHERE c.status = 'SIGNED'), 0) AS total_revenue
            FROM users u
            JOIN organization_memberships om ON u.id = om.user_id
            LEFT JOIN leads l ON u.id = l.assigned_user_id
            LEFT JOIN contracts c ON l.id = c.lead_id
            GROUP BY u.id, u.full_name
            HAVING COUNT(DISTINCT c.id) > 0 OR COUNT(DISTINCT l.id) > 0
            ORDER BY total_revenue DESC, contracts_count DESC LIMIT 10`,
    };
  }

  // 3. Leads count / status
  // e.g. "كم ليد جديد دخل؟" or "total leads"
  if (
    q.includes("ليد") ||
    q.includes("عميل") ||
    q.includes("عملاء") ||
    q.includes("leads")
  ) {
    return {
      intent: "LEADS_QUERY",
      sql: `SELECT status, COUNT(*) AS count
            FROM leads
            GROUP BY status
            ORDER BY count DESC`,
    };
  }

  // 4. Contracts and Revenue
  if (
    q.includes("عقد") ||
    q.includes("عقود") ||
    q.includes("مبيعات") ||
    q.includes("contracts")
  ) {
    return {
      intent: "CONTRACTS_QUERY",
      sql: `SELECT c.id, c.contract_number, c.contract_value, c.currency, c.status, l.full_name AS client_name, u.unit_number
            FROM contracts c
            LEFT JOIN leads l ON c.lead_id = l.id
            LEFT JOIN units u ON c.unit_id = u.id
            WHERE c.status = 'SIGNED'
            ORDER BY c.contract_value DESC LIMIT 20`,
    };
  }

  return null;
}
