import type { CustomFieldDefinition } from '@business-os/types';

const LEAD_SYNONYMS: Record<string, string[]> = {
  full_name: [
    'full_name',
    'fullname',
    'name',
    'full name',
    'client_name',
    'client name',
    'lead_name',
    'lead name',
    'اسم العميل',
    'الاسم',
    'اسم',
    'العميل',
    'اسم المشتري',
  ],
  phone: [
    'phone',
    'mobile',
    'telephone',
    'phone_number',
    'phone number',
    'cell',
    'mobile_number',
    'رقم الهاتف',
    'الهاتف',
    'الموبايل',
    'تليفون',
    'موبايل',
    'رقم الموبايل',
    'الجوال',
    'رقم الجوال',
  ],
  email: [
    'email',
    'e-mail',
    'mail',
    'email_address',
    'البريد',
    'الايميل',
    'البريد الالكتروني',
    'ايميل',
  ],
  status: ['status', 'lead_status', 'الحالة', 'حالة العميل'],
  source: ['source', 'campaign', 'channel', 'المصدر', 'مصدر العميل', 'القناة'],
};

const UNIT_SYNONYMS: Record<string, string[]> = {
  unit_number: [
    'unit_number',
    'unit_no',
    'unit_code',
    'unit',
    'unit #',
    'رقم الوحدة',
    'الوحدة',
    'كود الوحدة',
    'شقة رقم',
    'فيلا رقم',
  ],
  unit_type: ['unit_type', 'type', 'model', 'نوع الوحدة', 'النوع', 'نموذج'],
  gross_area: [
    'gross_area',
    'area',
    'size',
    'bua',
    'المساحة',
    'مساحة الوحدة',
    'المساحة الاجمالية',
  ],
  price: [
    'price',
    'total_price',
    'unit_price',
    'amount',
    'السعر',
    'سعر الوحدة',
    'القيمة',
    'اجمالي السعر',
  ],
  status: ['status', 'unit_status', 'الحالة', 'حالة الوحدة'],
};

function normalizeString(str: string): string {
  return str
    .toLowerCase()
    .trim()
    .replace(/[\s\-_#]+/g, '');
}

export function autoDetectColumnMapping(
  entityType: 'leads' | 'units',
  detectedHeaders: string[],
  customFieldDefs: CustomFieldDefinition[] = []
): Record<string, string> {
  const mapping: Record<string, string> = {};
  const synonyms = entityType === 'leads' ? LEAD_SYNONYMS : UNIT_SYNONYMS;

  for (const rawHeader of detectedHeaders) {
    const norm = normalizeString(rawHeader);
    let matched = false;

    // 1. Try standard entity fields
    for (const [targetField, synList] of Object.entries(synonyms)) {
      if (synList.some((syn) => normalizeString(syn) === norm)) {
        mapping[rawHeader] = targetField;
        matched = true;
        break;
      }
    }

    // 2. Try custom field definitions if not matched
    if (!matched) {
      for (const def of customFieldDefs) {
        if (
          normalizeString(def.field_key) === norm ||
          normalizeString(def.display_name) === norm
        ) {
          mapping[rawHeader] = def.field_key;
          matched = true;
          break;
        }
      }
    }
  }

  return mapping;
}
