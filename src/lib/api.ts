import type {
  PortalBookmark,
  ProfileVault,
  WorkspaceBootstrap,
} from '../types';

const BACKEND_URL_STORAGE_KEY = 'sarthiai_backend_url';
const LOCAL_WORKSPACE_STORAGE_KEY = 'sarthiai_local_workspace_v1';

export class BackendUnavailableError extends Error {
  constructor(
    message = 'Backend API server connected nahi hai. APK me AI Agent & Live Browser chalane ke liye apna deployed SarthiAI Server URL connect karein.'
  ) {
    super(message);
    this.name = 'BackendUnavailableError';
  }
}

export function normalizeBackendUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
    return `https://${trimmed}`;
  }
  return trimmed;
}

export function getSavedBackendUrl(): string {
  try {
    const stored = window.localStorage.getItem(BACKEND_URL_STORAGE_KEY)?.trim() || '';
    if (stored) return normalizeBackendUrl(stored);
  } catch {
    // ignore storage errors
  }
  const envBase = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() || '';
  return envBase ? normalizeBackendUrl(envBase) : '';
}

export function setSavedBackendUrl(rawUrl: string): string {
  const normalized = normalizeBackendUrl(rawUrl);
  try {
    if (normalized) {
      window.localStorage.setItem(BACKEND_URL_STORAGE_KEY, normalized);
    } else {
      window.localStorage.removeItem(BACKEND_URL_STORAGE_KEY);
    }
  } catch {
    // ignore storage errors
  }
  return normalized;
}

export function isRunningInNativeApk(): boolean {
  const cap = (
    window as unknown as {
      Capacitor?: { isNativePlatform?: () => boolean };
    }
  ).Capacitor;
  if (cap?.isNativePlatform?.()) return true;
  if (window.location.protocol === 'capacitor:' || window.location.protocol === 'file:') {
    return true;
  }
  return false;
}

export function buildApiUrl(path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const base = getSavedBackendUrl();
  return base ? `${base}${normalizedPath}` : normalizedPath;
}

export function buildWsUrl(path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const base = getSavedBackendUrl();
  if (base) {
    const u = new URL(base);
    const wsProto = u.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${wsProto}//${u.host}${normalizedPath}`;
  }
  const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${wsProto}//${window.location.host}${normalizedPath}`;
}

export async function apiFetchJson<T = Record<string, unknown>>(
  path: string,
  init?: RequestInit
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(buildApiUrl(path), init);
  } catch (err) {
    throw new BackendUnavailableError(
      err instanceof Error
        ? `Server se connect nahi ho pa raha (${err.message}).`
        : 'Server se connect nahi ho pa raha.'
    );
  }

  const contentType = (res.headers.get('content-type') || '').toLowerCase();
  const rawText = await res.text();
  const trimmed = rawText.trimStart();

  if (
    contentType.includes('text/html') ||
    trimmed.startsWith('<!DOCTYPE') ||
    trimmed.startsWith('<!doctype') ||
    trimmed.startsWith('<html')
  ) {
    throw new BackendUnavailableError(
      'Yeh APK abhi bina live backend server ke khuli hai (HTML mila, JSON API nahi). Upar "Connect Live Server" me apna deployed SarthiAI Server URL dalein ya browser app URL kholein.'
    );
  }

  let parsed: unknown = {};
  if (rawText) {
    try {
      parsed = JSON.parse(rawText);
    } catch {
      throw new BackendUnavailableError(
        `Server se valid JSON nahi mila (HTTP ${res.status}).`
      );
    }
  }

  if (!res.ok) {
    const msg =
      (parsed as { error?: string; message?: string })?.error ||
      (parsed as { message?: string })?.message ||
      `Request failed (${res.status})`;
    throw new Error(msg);
  }

  return parsed as T;
}

function createDefaultProfile(): ProfileVault {
  return {
    fullName: '',
    fatherName: '',
    motherName: '',
    dob: '',
    gender: '',
    category: 'General',
    maritalStatus: 'Unmarried',
    mobile: '',
    alternateMobile: '',
    email: '',
    addressLine: '',
    villageOrWard: '',
    postOffice: '',
    policeStation: '',
    blockOrTehsil: '',
    district: '',
    state: '',
    pinCode: '',
    qualification: '',
    boardOrUniversity: '',
    passingYear: '',
    percentageOrGrade: '',
    panNumber: '',
    aadhaarLast4: '',
    passportNumber: '',
    dlNumber: '',
    voterId: '',
    preferredDepartureCity: '',
    preferredTrainClass: '3A (AC 3 Tier)',
    customFields: [],
    updatedAt: new Date().toISOString(),
  };
}

function createDefaultBookmarks(): PortalBookmark[] {
  return [
    {
      id: 'bm-pan',
      name: 'Protean (NSDL) PAN Portal',
      category: 'pan',
      url: 'https://www.onlineservices.nsdl.com/paam/endUserRegisterContact.html',
      description: 'New PAN Card (Form 49A) & PAN correction portal',
    },
    {
      id: 'bm-irctc',
      name: 'IRCTC Train Tickets & Account',
      category: 'ticket',
      url: 'https://www.irctc.co.in',
      description: 'Official Indian Railways account registration & e-ticketing portal',
    },
    {
      id: 'bm-passport',
      name: 'Passport Seva (MEA India)',
      category: 'passport',
      url: 'https://www.passportindia.gov.in',
      description: 'Fresh/Re-issue Indian Passport & PSK appointment booking',
    },
    {
      id: 'bm-parivahan',
      name: 'Parivahan Sarathi (Driving License)',
      category: 'dl',
      url: 'https://sarathi.parivahan.gov.in',
      description: 'Learner License (LL), Driving License (DL) & renewal',
    },
    {
      id: 'bm-army',
      name: 'Join Indian Army (Agniveer)',
      category: 'job',
      url: 'https://joinindianarmy.nic.in',
      description: 'Official Indian Army recruitment & rally application portal',
    },
    {
      id: 'bm-ssc',
      name: 'SSC Portal (Sarkari Bharti)',
      category: 'job',
      url: 'https://ssc.gov.in',
      description: 'Staff Selection Commission jobs & OTR registration',
    },
    {
      id: 'bm-ecourts',
      name: 'eCourts India Services',
      category: 'court_block',
      url: 'https://services.ecourts.gov.in',
      description: 'District & High Court case status, cause lists & orders',
    },
    {
      id: 'bm-umang',
      name: 'UMANG & Block Services',
      category: 'court_block',
      url: 'https://web.umang.gov.in',
      description: 'Unified portal for Block, Ration, Caste/Income/Residence certificates',
    },
    {
      id: 'bm-ncs',
      name: 'National Career Service (Jobs)',
      category: 'job',
      url: 'https://www.ncs.gov.in',
      description: 'Official Ministry of Labour & Employment job portal',
    },
    {
      id: 'bm-india',
      name: 'India.gov.in National Portal',
      category: 'general',
      url: 'https://www.india.gov.in',
      description: 'Directory of all Central & State Government online services',
    },
  ];
}

export function loadLocalFallbackBootstrap(): WorkspaceBootstrap {
  try {
    const raw = window.localStorage.getItem(LOCAL_WORKSPACE_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<WorkspaceBootstrap>;
      return {
        profile: { ...createDefaultProfile(), ...(parsed.profile || {}) },
        applications: Array.isArray(parsed.applications) ? parsed.applications : [],
        chatHistory:
          Array.isArray(parsed.chatHistory) && parsed.chatHistory.length > 0
            ? parsed.chatHistory
            : [
                {
                  id: 'msg-apk-welcome',
                  role: 'assistant',
                  text:
                    'SarthiAI APK offline/standalone mode me khul gaya hai! AI Autopilot, OCR scanner aur Live Chromium Browser chalane ke liye upar "Connect Live Server" bar me apna deployed SarthiAI Server URL dalein. Tab tak aap Profile Vault me apni details save kar sakte hain.',
                  createdAt: new Date().toISOString(),
                },
              ],
        bookmarks:
          Array.isArray(parsed.bookmarks) && parsed.bookmarks.length > 0
            ? parsed.bookmarks
            : createDefaultBookmarks(),
        aiConfigured: false,
        liveBrowserAvailable: false,
      };
    }
  } catch {
    // ignore storage errors
  }

  return {
    profile: createDefaultProfile(),
    applications: [],
    chatHistory: [
      {
        id: 'msg-apk-welcome',
        role: 'assistant',
        text:
          'SarthiAI APK standalone mode me ready hai! AI Autopilot, OCR aur Live Chromium Browser chalane ke liye upar "Connect Live Server" me apna live SarthiAI Server URL connect karein. Tab tak aap Profile Vault aur Bookmarks use kar sakte hain.',
        createdAt: new Date().toISOString(),
      },
    ],
    bookmarks: createDefaultBookmarks(),
    aiConfigured: false,
    liveBrowserAvailable: false,
  };
}

export function saveLocalFallbackProfile(profile: ProfileVault): void {
  try {
    const existing = loadLocalFallbackBootstrap();
    window.localStorage.setItem(
      LOCAL_WORKSPACE_STORAGE_KEY,
      JSON.stringify({ ...existing, profile })
    );
  } catch {
    // ignore
  }
}

export function saveLocalFallbackBookmarks(bookmarks: PortalBookmark[]): void {
  try {
    const existing = loadLocalFallbackBootstrap();
    window.localStorage.setItem(
      LOCAL_WORKSPACE_STORAGE_KEY,
      JSON.stringify({ ...existing, bookmarks })
    );
  } catch {
    // ignore
  }
}
