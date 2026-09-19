import type { MetaLeadDetails, ParsedMetaLead } from "@business-os/types";

/**
 * Standard field keys used by Meta Lead Gen forms.
 */
const STANDARD_NAME_KEYS = ["full_name", "name", "fullname"];
const FIRST_NAME_KEYS = ["first_name", "firstname"];
const LAST_NAME_KEYS = ["last_name", "lastname"];
const STANDARD_PHONE_KEYS = [
  "phone_number",
  "phone",
  "phonenumber",
  "mobile_number",
  "mobile",
];
const STANDARD_EMAIL_KEYS = ["email", "email_address", "e-mail"];

/**
 * Normalizes and extracts standard CRM attributes and custom form questions from Meta lead data.
 */
export function parseMetaLeadData(
  leadDetails: MetaLeadDetails,
  fieldMappings: Record<string, string> = {},
): ParsedMetaLead {
  const fields = leadDetails.field_data || [];
  const fieldMap = new Map<string, string>();

  for (const item of fields) {
    if (item.name && item.values && item.values.length > 0) {
      const val =
        item.values[0] !== undefined ? String(item.values[0]).trim() : "";
      fieldMap.set(item.name.toLowerCase().trim(), val);
    }
  }

  // 1. Extract Full Name
  let fullName = "";
  for (const key of STANDARD_NAME_KEYS) {
    const val = fieldMap.get(key);
    if (val) {
      fullName = val;
      break;
    }
  }

  if (!fullName) {
    let first = "";
    let last = "";
    for (const key of FIRST_NAME_KEYS) {
      const val = fieldMap.get(key);
      if (val) {
        first = val;
        break;
      }
    }
    for (const key of LAST_NAME_KEYS) {
      const val = fieldMap.get(key);
      if (val) {
        last = val;
        break;
      }
    }
    fullName = `${first} ${last}`.trim();
  }

  if (!fullName) {
    fullName = "Unknown Meta Lead";
  }

  // 2. Extract Phone
  let phone = "";
  for (const key of STANDARD_PHONE_KEYS) {
    const val = fieldMap.get(key);
    if (val) {
      phone = val;
      break;
    }
  }

  // 3. Extract Email
  let email: string | null = null;
  for (const key of STANDARD_EMAIL_KEYS) {
    const val = fieldMap.get(key);
    if (val) {
      email = val;
      break;
    }
  }

  // 4. Extract Custom Questions / Additional Fields
  const allStandardKeys = new Set([
    ...STANDARD_NAME_KEYS,
    ...FIRST_NAME_KEYS,
    ...LAST_NAME_KEYS,
    ...STANDARD_PHONE_KEYS,
    ...STANDARD_EMAIL_KEYS,
  ]);

  const customQuestions: Record<string, unknown> = {};

  for (const item of fields) {
    const rawKey = item.name.trim();
    const lowerKey = rawKey.toLowerCase();
    const val = item.values && item.values.length > 0 ? item.values[0] : null;

    if (!allStandardKeys.has(lowerKey)) {
      // Check if custom field mapping applies
      const targetKey =
        fieldMappings[rawKey] || fieldMappings[lowerKey] || rawKey;
      customQuestions[targetKey] = val;
    }
  }

  return {
    fullName,
    phone,
    email,
    campaignId: leadDetails.campaign_id || null,
    campaignName: leadDetails.campaign_name || null,
    adId: leadDetails.ad_id || null,
    adName: leadDetails.ad_name || null,
    adsetId: leadDetails.adset_id || null,
    adsetName: leadDetails.adset_name || null,
    formId: leadDetails.form_id || null,
    formName: leadDetails.form_name || null,
    platform: leadDetails.platform || "fb",
    customQuestions,
    rawFieldData: fields,
  };
}
