import type { UnitType, UnitUsageType } from "@business-os/types";

function normalizeToken(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/[\s_-]+/g, " ");
}

const UNIT_TYPE_ALIASES: Record<string, UnitType> = {
  apartment: "APARTMENT", "شقه": "APARTMENT",
  duplex: "DUPLEX", "دوبلكس": "DUPLEX",
  penthouse: "PENTHOUSE", "بنتهاوس": "PENTHOUSE",
  studio: "STUDIO", "استوديو": "STUDIO",
  villa: "STANDALONE_VILLA", "standalone villa": "STANDALONE_VILLA",
  "فيلا": "STANDALONE_VILLA", "فيلا مستقله": "STANDALONE_VILLA",
  "twin house": "TWIN_HOUSE", twinhouse: "TWIN_HOUSE", "توين هاوس": "TWIN_HOUSE",
  townhouse: "TOWNHOUSE", "town house": "TOWNHOUSE", "تاون هاوس": "TOWNHOUSE",
  "retail store": "RETAIL_STORE", retail: "RETAIL_STORE", shop: "RETAIL_STORE",
  store: "RETAIL_STORE", "محل": "RETAIL_STORE", "محل تجاري": "RETAIL_STORE",
  restaurant: "RESTAURANT_CAFE", cafe: "RESTAURANT_CAFE",
  "restaurant cafe": "RESTAURANT_CAFE", "مطعم": "RESTAURANT_CAFE", "كافيه": "RESTAURANT_CAFE",
  pharmacy: "PHARMACY", "صيدليه": "PHARMACY",
  kiosk: "KIOSK", "كشك": "KIOSK",
  office: "OFFICE", "مكتب": "OFFICE",
  clinic: "CLINIC", "عياده": "CLINIC",
  laboratory: "LABORATORY", lab: "LABORATORY", "معمل": "LABORATORY",
  other: "OTHER", "اخرى": "OTHER",
};

const USAGE_TYPE_ALIASES: Record<string, UnitUsageType> = {
  residential: "RESIDENTIAL", "سكني": "RESIDENTIAL",
  commercial: "COMMERCIAL", "تجاري": "COMMERCIAL",
  administrative: "ADMINISTRATIVE", admin: "ADMINISTRATIVE", "اداري": "ADMINISTRATIVE",
  medical: "MEDICAL", "طبي": "MEDICAL",
};

const UNIT_TYPE_USAGE: Record<UnitType, UnitUsageType | null> = {
  APARTMENT: "RESIDENTIAL",
  DUPLEX: "RESIDENTIAL",
  PENTHOUSE: "RESIDENTIAL",
  STUDIO: "RESIDENTIAL",
  STANDALONE_VILLA: "RESIDENTIAL",
  TWIN_HOUSE: "RESIDENTIAL",
  TOWNHOUSE: "RESIDENTIAL",
  RETAIL_STORE: "COMMERCIAL",
  RESTAURANT_CAFE: "COMMERCIAL",
  PHARMACY: "MEDICAL",
  KIOSK: "COMMERCIAL",
  OFFICE: "ADMINISTRATIVE",
  CLINIC: "MEDICAL",
  LABORATORY: "MEDICAL",
  OTHER: null,
};

export function normalizeUnitType(value: string): UnitType | null {
  return UNIT_TYPE_ALIASES[normalizeToken(value)] ?? null;
}

export function normalizeUsageType(value: string): UnitUsageType | null {
  return USAGE_TYPE_ALIASES[normalizeToken(value)] ?? null;
}

export function inferUsageTypeFromUnitType(unitType: UnitType): UnitUsageType | null {
  return UNIT_TYPE_USAGE[unitType];
}

export function isUsageTypeCompatible(unitType: UnitType, usageType: UnitUsageType): boolean {
  const inferred = inferUsageTypeFromUnitType(unitType);
  return inferred === null || inferred === usageType;
}

export function detectUnitTypeFromText(text: string): UnitType | null {
  const normalized = normalizeToken(text);
  for (const alias of Object.keys(UNIT_TYPE_ALIASES).sort((a,b)=>b.length-a.length)) {
    if (normalized.includes(alias)) return UNIT_TYPE_ALIASES[alias] ?? null;
  }
  return null;
}

export function detectUsageTypeFromText(text: string): UnitUsageType | null {
  const normalized = normalizeToken(text);
  for (const alias of Object.keys(USAGE_TYPE_ALIASES).sort((a,b)=>b.length-a.length)) {
    if (normalized.includes(alias)) return USAGE_TYPE_ALIASES[alias] ?? null;
  }
  return null;
}
