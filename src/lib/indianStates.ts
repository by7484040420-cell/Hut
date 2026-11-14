import type { ExtractedDocumentField } from '../types';

export const INDIAN_STATES_AND_UTS: readonly string[] = [
  'Andhra Pradesh',
  'Arunachal Pradesh',
  'Assam',
  'Bihar',
  'Chhattisgarh',
  'Goa',
  'Gujarat',
  'Haryana',
  'Himachal Pradesh',
  'Jharkhand',
  'Karnataka',
  'Kerala',
  'Madhya Pradesh',
  'Maharashtra',
  'Manipur',
  'Meghalaya',
  'Mizoram',
  'Nagaland',
  'Odisha',
  'Punjab',
  'Rajasthan',
  'Sikkim',
  'Tamil Nadu',
  'Telangana',
  'Tripura',
  'Uttar Pradesh',
  'Uttarakhand',
  'West Bengal',
  'Andaman and Nicobar Islands',
  'Chandigarh',
  'Dadra and Nagar Haveli and Daman and Diu',
  'Delhi',
  'Jammu and Kashmir',
  'Ladakh',
  'Lakshadweep',
  'Puducherry',
];

const STATE_ALIASES: Record<string, string[]> = {
  'Andhra Pradesh': ['andhra pradesh', 'andhra', 'ap', 'a.p.', 'आंध्र प्रदेश', 'आंध्रप्रदेश'],
  'Arunachal Pradesh': ['arunachal pradesh', 'arunachal', 'ar', 'अरुणाचल प्रदेश'],
  Assam: ['assam', 'as', 'असम'],
  Bihar: ['bihar', 'br', 'बिहार'],
  Chhattisgarh: ['chhattisgarh', 'chattisgarh', 'cg', 'c.g.', 'छत्तीसगढ़'],
  Goa: ['goa', 'ga', 'गोवा'],
  Gujarat: ['gujarat', 'gujrat', 'gj', 'गुजरात'],
  Haryana: ['haryana', 'hr', 'हरियाणा'],
  'Himachal Pradesh': ['himachal pradesh', 'himachal', 'hp', 'h.p.', 'हिमाचल प्रदेश'],
  Jharkhand: ['jharkhand', 'jh', 'झारखंड', 'झारखण्ड'],
  Karnataka: ['karnataka', 'ka', 'कर्नाटक'],
  Kerala: ['kerala', 'kl', 'केरल'],
  'Madhya Pradesh': ['madhya pradesh', 'mp', 'm.p.', 'मध्य प्रदेश', 'मध्यप्रदेश'],
  Maharashtra: ['maharashtra', 'mh', 'महाराष्ट्र'],
  Manipur: ['manipur', 'mn', 'मणिपुर'],
  Meghalaya: ['meghalaya', 'ml', 'मेघालय'],
  Mizoram: ['mizoram', 'mz', 'मिजोरम'],
  Nagaland: ['nagaland', 'nl', 'नागालैंड'],
  Odisha: ['odisha', 'orissa', 'od', 'or', 'ओडिशा', 'उड़ीसा'],
  Punjab: ['punjab', 'pb', 'पंजाब'],
  Rajasthan: ['rajasthan', 'rj', 'राजस्थान'],
  Sikkim: ['sikkim', 'sk', 'सिक्किम'],
  'Tamil Nadu': ['tamil nadu', 'tamilnadu', 'tn', 't.n.', 'तमिलनाडु'],
  Telangana: ['telangana', 'ts', 'tg', 'तेलंगाना'],
  Tripura: ['tripura', 'tr', 'त्रिपुरा'],
  'Uttar Pradesh': ['uttar pradesh', 'up', 'u.p.', 'उत्तर प्रदेश', 'उत्तरप्रदेश'],
  Uttarakhand: ['uttarakhand', 'uttaranchal', 'uk', 'ua', 'उत्तराखंड', 'उत्तराखण्ड'],
  'West Bengal': ['west bengal', 'wb', 'w.b.', 'पश्चिम बंगाल', 'बंगाल'],
  'Andaman and Nicobar Islands': [
    'andaman and nicobar islands',
    'andaman and nicobar',
    'andaman & nicobar',
    'andaman',
    'अंडमान और निकोबार',
  ],
  Chandigarh: ['chandigarh', 'ch', 'चंडीगढ़'],
  'Dadra and Nagar Haveli and Daman and Diu': [
    'dadra and nagar haveli and daman and diu',
    'dadra and nagar haveli',
    'daman and diu',
    'dadra & nagar haveli',
  ],
  Delhi: ['delhi', 'nct of delhi', 'new delhi', 'dl', 'दिल्ली', 'नई दिल्ली'],
  'Jammu and Kashmir': ['jammu and kashmir', 'jammu & kashmir', 'j&k', 'jk', 'जम्मू और कश्मीर', 'जम्मू कश्मीर'],
  Ladakh: ['ladakh', 'la', 'लद्दाख'],
  Lakshadweep: ['lakshadweep', 'ld', 'लक्षद्वीप'],
  Puducherry: ['puducherry', 'pondicherry', 'py', 'पुदुचेरी', 'पांडिचेरी'],
};

function cleanToken(s: string): string {
  return s
    .toLowerCase()
    .replace(/[.,_/-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeIndianState(raw?: string): string {
  if (!raw || !raw.trim()) return '';
  const cleaned = cleanToken(raw);
  if (!cleaned) return '';

  // Exact or alias match first
  for (const [canonical, aliases] of Object.entries(STATE_ALIASES)) {
    for (const alias of aliases) {
      const normAlias = cleanToken(alias);
      if (cleaned === normAlias) return canonical;
    }
  }

  // Full state name embedded inside a longer string (e.g. "Dist Patna Bihar 800001")
  for (const canonical of INDIAN_STATES_AND_UTS) {
    const aliases = STATE_ALIASES[canonical] || [canonical.toLowerCase()];
    for (const alias of aliases) {
      if (alias.length <= 3) continue; // skip short 2-letter codes for substring search
      const normAlias = cleanToken(alias);
      const regex = new RegExp(`(^|\\s)${normAlias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`, 'i');
      if (regex.test(cleaned) || (normAlias.length >= 4 && cleaned.includes(normAlias))) {
        return canonical;
      }
    }
  }

  return '';
}

export function extractPinCodeFromText(text?: string): string {
  if (!text) return '';
  const m = text.match(/\b([1-8]\d{5})\b/);
  return m ? m[1] : '';
}

export function inferStateFromPinCode(pin?: string): string {
  const digits = String(pin || '').replace(/\D/g, '');
  if (digits.length !== 6) return '';
  const p2 = Number(digits.slice(0, 2));
  const p3 = Number(digits.slice(0, 3));

  if (p2 === 11) return 'Delhi';
  if (p2 === 12 || p2 === 13) return 'Haryana';
  if (p3 === 160) return 'Chandigarh';
  if (p2 >= 14 && p2 <= 16) return 'Punjab';
  if (p2 === 17) return 'Himachal Pradesh';
  if (p3 === 194) return 'Ladakh';
  if (p2 === 18 || p2 === 19) return 'Jammu and Kashmir';

  // Uttarakhand vs Uttar Pradesh (2447xx, 246-249, 262-263 mostly Uttarakhand)
  if (
    p3 === 246 ||
    p3 === 247 ||
    p3 === 248 ||
    p3 === 249 ||
    p3 === 262 ||
    p3 === 263
  ) {
    // 247001-247778 is Saharanpur/Muzaffarnagar (UP), 24766x is Roorkee/Haridwar (UK)
    if (p3 === 247) {
      const n = Number(digits);
      if (n >= 247650 && n <= 247670) return 'Uttarakhand';
      return 'Uttar Pradesh';
    }
    if (p3 === 262) {
      const n = Number(digits);
      if (n >= 262001 && n <= 262499) return 'Uttar Pradesh';
      return 'Uttarakhand';
    }
    return 'Uttarakhand';
  }
  if (p2 >= 20 && p2 <= 28) return 'Uttar Pradesh';

  if (p2 >= 30 && p2 <= 34) return 'Rajasthan';
  if (p3 === 396) {
    const n = Number(digits);
    if (n >= 396210 && n <= 396240) return 'Dadra and Nagar Haveli and Daman and Diu';
    return 'Gujarat';
  }
  if (p2 >= 36 && p2 <= 39) return 'Gujarat';

  if (p3 === 403) return 'Goa';
  if (p2 >= 40 && p2 <= 44) return 'Maharashtra';
  if (p2 >= 45 && p2 <= 48) return 'Madhya Pradesh';
  if (p2 === 49) return 'Chhattisgarh';

  if (p2 === 50) return 'Telangana';
  if (p2 >= 51 && p2 <= 53) return 'Andhra Pradesh';
  if (p2 >= 56 && p2 <= 59) return 'Karnataka';

  if (p3 === 605 || p3 === 609 || p3 === 533 || p3 === 673) {
    if (p3 === 605) return 'Puducherry';
  }
  if (p3 === 682 && Number(digits) >= 682551 && Number(digits) <= 682559) {
    return 'Lakshadweep';
  }
  if (p2 >= 60 && p2 <= 64) return 'Tamil Nadu';
  if (p2 >= 67 && p2 <= 69) return 'Kerala';

  if (p3 === 737) return 'Sikkim';
  if (p3 === 744) return 'Andaman and Nicobar Islands';
  if (p2 >= 70 && p2 <= 74) return 'West Bengal';
  if (p2 >= 75 && p2 <= 77) return 'Odisha';
  if (p2 === 78) return 'Assam';

  if (p3 >= 790 && p3 <= 792) return 'Arunachal Pradesh';
  if (p3 >= 793 && p3 <= 794) return 'Meghalaya';
  if (p3 === 795) return 'Manipur';
  if (p3 === 796) return 'Mizoram';
  if (p3 >= 797 && p3 <= 798) return 'Nagaland';
  if (p3 === 799) return 'Tripura';

  // Bihar vs Jharkhand (80-85)
  if (
    p3 === 814 ||
    p3 === 815 ||
    p3 === 816 ||
    p3 === 825 ||
    p3 === 826 ||
    p3 === 827 ||
    p3 === 828 ||
    p3 === 829 ||
    (p3 >= 831 && p3 <= 835)
  ) {
    return 'Jharkhand';
  }
  if (p2 >= 80 && p2 <= 85) return 'Bihar';

  return '';
}

export function resolveIndianState(params: {
  state?: string;
  addressLine?: string;
  pinCode?: string;
  district?: string;
}): string {
  const fromState = normalizeIndianState(params.state);
  if (fromState) return fromState;

  const fromAddress = normalizeIndianState(params.addressLine);
  if (fromAddress) return fromAddress;

  const pin = params.pinCode || extractPinCodeFromText(params.addressLine);
  const fromPin = inferStateFromPinCode(pin);
  if (fromPin) return fromPin;

  const fromDistrict = normalizeIndianState(params.district);
  if (fromDistrict) return fromDistrict;

  return params.state?.trim() || '';
}

export function enrichExtractedFields(
  fields: ExtractedDocumentField[]
): ExtractedDocumentField[] {
  const next = fields.map((f) => ({ ...f }));

  const findVal = (pred: (k: string, l: string) => boolean) =>
    next.find((f) => pred(f.key.toLowerCase(), f.label.toLowerCase()))?.value || '';

  const rawState = findVal(
    (k, l) =>
      k === 'state' ||
      l === 'state' ||
      l.includes('rajya') ||
      l.includes('राज्य') ||
      l.includes('province')
  );
  const addressLine = findVal((k, l) => k.includes('address') || l.includes('address') || l.includes('पता'));
  let pinCode = findVal((k, l) => k.includes('pin') || l.includes('pin'));
  if (!pinCode && addressLine) {
    pinCode = extractPinCodeFromText(addressLine);
    if (pinCode) {
      next.push({ key: 'pinCode', label: 'PIN Code', value: pinCode });
    }
  }
  const district = findVal((k, l) => k.includes('district') || l.includes('district') || l.includes('जिला'));

  const resolvedState = resolveIndianState({
    state: rawState,
    addressLine,
    pinCode,
    district,
  });

  if (resolvedState) {
    const existingIdx = next.findIndex((f) => {
      const k = f.key.toLowerCase();
      const l = f.label.toLowerCase();
      return k === 'state' || l === 'state' || l.includes('rajya') || l.includes('राज्य');
    });
    if (existingIdx >= 0) {
      next[existingIdx] = {
        ...next[existingIdx],
        key: 'state',
        label: 'State',
        value: resolvedState,
      };
    } else {
      next.push({ key: 'state', label: 'State', value: resolvedState });
    }
  }

  return next;
}
