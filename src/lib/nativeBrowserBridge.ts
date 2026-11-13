import type { EphemeralDocumentExtract, ProfileVault } from '../types';

export interface SarthiNativeInterface {
  isNativeApk?: () => boolean;
  openPortal?: (url: string, payloadJson: string) => void;
  autoFillPortal?: (payloadJson: string) => void;
  closePortal?: () => void;
  wipePortalSession?: () => void;
  scanDocumentOcr?: (base64Image: string, requestId: string) => void;
  getNativeInfo?: () => string;
}

declare global {
  interface Window {
    SarthiNative?: SarthiNativeInterface;
    onSarthiNativeOcrResult?: (requestId: string, resultJson: string) => void;
    onSarthiNativePortalEvent?: (eventJson: string) => void;
  }
}

export function hasNativePortalBridge(): boolean {
  try {
    return Boolean(window.SarthiNative && window.SarthiNative.isNativeApk?.());
  } catch {
    return false;
  }
}

export function buildAutoFillPayload(params: {
  profile: ProfileVault;
  ephemeralDocs: EphemeralDocumentExtract[];
  zeroSave: boolean;
  goal?: string;
}): Record<string, string> {
  const map: Record<string, string> = {};

  if (!params.zeroSave) {
    const p = params.profile;
    const baseEntries: [string, string][] = [
      ['fullName', p.fullName],
      ['fatherName', p.fatherName],
      ['motherName', p.motherName],
      ['dob', p.dob],
      ['gender', p.gender],
      ['category', p.category],
      ['maritalStatus', p.maritalStatus],
      ['mobile', p.mobile],
      ['email', p.email],
      ['addressLine', p.addressLine],
      ['villageOrWard', p.villageOrWard],
      ['postOffice', p.postOffice],
      ['policeStation', p.policeStation],
      ['blockOrTehsil', p.blockOrTehsil],
      ['district', p.district],
      ['state', p.state],
      ['pinCode', p.pinCode],
      ['qualification', p.qualification],
      ['boardOrUniversity', p.boardOrUniversity],
      ['passingYear', p.passingYear],
      ['percentageOrGrade', p.percentageOrGrade],
      ['panNumber', p.panNumber],
      ['passportNumber', p.passportNumber],
      ['dlNumber', p.dlNumber],
      ['voterId', p.voterId],
      ['preferredDepartureCity', p.preferredDepartureCity],
    ];
    for (const [k, v] of baseEntries) {
      if (v && v.trim()) map[k] = v.trim();
    }
  }

  // Merge ephemeral RAM-only OCR document fields (highest priority)
  for (const doc of params.ephemeralDocs) {
    for (const f of doc.fields) {
      const k = f.key.trim();
      const v = f.value.trim();
      if (!v) continue;
      const lower = `${k} ${f.label}`.toLowerCase();
      if (lower.includes('full_name') || (lower.includes('name') && !lower.includes('father') && !lower.includes('mother'))) {
        map.fullName = map.fullName || v;
      } else if (lower.includes('father')) {
        map.fatherName = map.fatherName || v;
      } else if (lower.includes('mother')) {
        map.motherName = map.motherName || v;
      } else if (lower.includes('dob') || lower.includes('birth')) {
        map.dob = map.dob || v;
      } else if (lower.includes('gender') || lower.includes('sex')) {
        map.gender = map.gender || v;
      } else if (lower.includes('mobile') || lower.includes('phone')) {
        map.mobile = map.mobile || v;
      } else if (lower.includes('email')) {
        map.email = map.email || v;
      } else if (lower.includes('pin')) {
        map.pinCode = map.pinCode || v;
      } else if (lower.includes('pan')) {
        map.panNumber = map.panNumber || v;
      } else if (lower.includes('aadhaar') || lower.includes('uid')) {
        map.aadhaarNumber = map.aadhaarNumber || v;
      } else if (lower.includes('address')) {
        map.addressLine = map.addressLine || v;
      } else if (lower.includes('district')) {
        map.district = map.district || v;
      } else if (lower.includes('state')) {
        map.state = map.state || v;
      }
      map[`ocr_${k}`] = v;
    }
  }

  if (params.goal?.trim()) {
    map.goal = params.goal.trim();
  }

  return map;
}

export function launchNativeControlledPortal(params: {
  url: string;
  profile: ProfileVault;
  ephemeralDocs: EphemeralDocumentExtract[];
  zeroSave: boolean;
  goal?: string;
}): boolean {
  if (!hasNativePortalBridge() || !window.SarthiNative?.openPortal) {
    return false;
  }
  const payload = buildAutoFillPayload(params);
  window.SarthiNative.openPortal(params.url, JSON.stringify(payload));
  return true;
}

export function runNativeOnDeviceOcr(file: File): Promise<EphemeralDocumentExtract | null> {
  return new Promise((resolve) => {
    if (!hasNativePortalBridge() || !window.SarthiNative?.scanDocumentOcr) {
      resolve(null);
      return;
    }
    if (!file.type.startsWith('image/')) {
      resolve(null);
      return;
    }

    const reader = new FileReader();
    reader.onerror = () => resolve(null);
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
      if (!base64) {
        resolve(null);
        return;
      }

      const reqId = `ocr-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const timer = window.setTimeout(() => {
        resolve(null);
      }, 15000);

      const prevHandler = window.onSarthiNativeOcrResult;
      window.onSarthiNativeOcrResult = (incomingId: string, resultJson: string) => {
        if (prevHandler) prevHandler(incomingId, resultJson);
        if (incomingId !== reqId) return;
        window.clearTimeout(timer);
        try {
          const parsed = JSON.parse(resultJson) as {
            ok?: boolean;
            rawText?: string;
            fields?: { key: string; label: string; value: string }[];
            documentType?: string;
          };
          if (!parsed.ok) {
            resolve(null);
            return;
          }
          resolve({
            id: reqId,
            fileName: file.name,
            documentType: parsed.documentType || 'On-Device ML Kit OCR',
            summary: `On-Device APK ML Kit ne ${parsed.fields?.length || 0} fields RAM me extract kiye (Zero-Save).`,
            fields: Array.isArray(parsed.fields) ? parsed.fields : [],
            extractedAt: new Date().toISOString(),
          });
        } catch {
          resolve(null);
        }
      };

      window.SarthiNative?.scanDocumentOcr?.(base64, reqId);
    };
    reader.readAsDataURL(file);
  });
}
