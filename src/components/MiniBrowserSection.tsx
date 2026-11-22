import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Bookmark,
  Bot,
  Check,
  CheckCircle2,
  Clock,
  Compass,
  Copy,
  Eraser,
  ExternalLink,
  Eye,
  EyeOff,
  FileSearch,
  Keyboard,
  Loader2,
  Lock,
  Maximize2,
  Minimize2,
  Monitor,
  MoreVertical,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Square,
  Trash2,
  Upload,
  X,
  Zap,
} from 'lucide-react';
import type {
  ApplicationDraft,
  EphemeralDocumentExtract,
  FormPageAnalysis,
  LiveBrowserStatus,
  MissingFormField,
  PortalBookmark,
  ProfileVault,
} from '../types';
import { apiFetchJson, buildWsUrl } from '../lib/api';
import {
  buildAutoFillPayload,
  hasNativePortalBridge,
  launchNativeControlledPortal,
  runNativeOnDeviceOcr,
} from '../lib/nativeBrowserBridge';
import { INDIAN_STATES_AND_UTS } from '../lib/indianStates';

interface MiniBrowserSectionProps {
  initialUrl: string | null;
  initialGoal: string | null;
  onConsumeInitial: () => void;
  bookmarks: PortalBookmark[];
  profile: ProfileVault;
  ephemeralDocs: EphemeralDocumentExtract[];
  zeroSave: boolean;
  serverOfflineMode?: boolean;
  activeDraft: ApplicationDraft | null;
  onBookmarksChange: (bookmarks: PortalBookmark[]) => void;
  onAddEphemeralDoc: (doc: EphemeralDocumentExtract) => void;
  onUpdateEphemeralDocField?: (docId: string, key: string, label: string, value: string) => void;
  onWipeAllSession: () => void;
}

const DEFAULT_STATUS: LiveBrowserStatus = {
  active: false,
  url: 'about:blank',
  title: 'Sarthi Desktop Browser',
  loading: false,
  adBlockEnabled: true,
  blockedAdsCount: 0,
  viewportWidth: 1366,
  viewportHeight: 820,
  agentRunning: false,
  agentStatus: 'Idle',
  waitingForHuman: false,
  humanPrompt: null,
  requestedDocuments: [],
  missingFields: [],
  lastStepLogs: [],
};

const QUICK_MISSIONS = [
  {
    label: 'IRCTC Train',
    url: 'https://www.irctc.co.in/nget/train-search',
    goal: 'IRCTC Train Search direct page kholo aur ticket search fill karo. CAPTCHA/OTP main dalunga.',
  },
  {
    label: 'PAN 49A',
    url: 'https://onlineservices.proteantech.in/paam/endUserRegisterContact.html',
    goal: 'Protean NSDL PAN Form 49A kholo, Apply par click karo aur meri details fill karo. CAPTCHA main dalunga.',
  },
  {
    label: 'SSC OTR',
    url: 'https://ssc.gov.in/candidate-portal/one-time-registration/home-page',
    goal: 'SSC Candidate OTR / Apply form kholo aur meri details fill karo.',
  },
  {
    label: 'Driving Licence',
    url: 'https://sarathi.parivahan.gov.in/sarathiservice/stateSelection.do',
    goal: 'Parivahan Sarathi par mera State (Rajya) select karo aur Apply form khol kar fill karo.',
  },
  {
    label: 'Passport Seva',
    url: 'https://portal2.passportindia.gov.in/AppOnlineProject/user/RegistrationBaseAction',
    goal: 'Passport Registration form kholo aur details auto-fill karo.',
  },
];

const AI_INTENT_PRESETS = [
  {
    label: 'New Apply / Form Kholein',
    goal: 'Is portal par Apply Online / New Registration button par click karke form kholo aur meri sabhi details type karo.',
  },
  {
    label: 'Sirf Auto-Fill Karein',
    goal: 'Khule hue form me OCR aur Vault se sabhi details real typing se fill karo; CAPTCHA/OTP mere liye chhod do.',
  },
  {
    label: 'Correction / Update Form',
    goal: 'Correction ya Update section par click karo aur meri updated details form me bharo.',
  },
  {
    label: 'Admit Card / Status Check',
    goal: 'Status Check / Admit Card / Download link par click karo aur mera Registration Number / DOB fill karo.',
  },
];

export const MiniBrowserSection: React.FC<MiniBrowserSectionProps> = ({
  initialUrl,
  initialGoal,
  onConsumeInitial,
  bookmarks,
  profile,
  ephemeralDocs,
  zeroSave,
  serverOfflineMode = false,
  activeDraft,
  onBookmarksChange,
  onAddEphemeralDoc,
  onUpdateEphemeralDocField,
  onWipeAllSession,
}) => {
  const [status, setStatus] = useState<LiveBrowserStatus>(DEFAULT_STATUS);
  const [frameSrc, setFrameSrc] = useState<string | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [addressInput, setAddressInput] = useState(
    'https://onlineservices.proteantech.in/paam/endUserRegisterContact.html'
  );
  const [agentGoal, setAgentGoal] = useState('');
  const [typeBox, setTypeBox] = useState('');
  const [clickMarker, setClickMarker] = useState<{ xPct: number; yPct: number } | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [uploadingReqId, setUploadingReqId] = useState<string | null>(null);
  const [uploadedReqMap, setUploadedReqMap] = useState<Record<string, string>>({});
  const [nativePortalLogs, setNativePortalLogs] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [instantFilling, setInstantFilling] = useState(false);

  // Clean UI chrome & AI Popup states
  const [showToolsMenu, setShowToolsMenu] = useState(false);
  const [showPortalsList, setShowPortalsList] = useState(false);
  const [showCopilotDrawer, setShowCopilotDrawer] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [switchingViewport, setSwitchingViewport] = useState(false);
  const [dismissedBlockedBanner, setDismissedBlockedBanner] = useState(false);

  // AI Task ("Kya Karna Hai?") + Missing-Details AI Popup + Form Guide + Tatkal state
  const [missingPopupOpen, setMissingPopupOpen] = useState(false);
  const [intentModalOpen, setIntentModalOpen] = useState(false);
  const [missingValues, setMissingValues] = useState<Record<string, string>>({});
  const [showPwMap, setShowPwMap] = useState<Record<string, boolean>>({});
  const [submittingMissing, setSubmittingMissing] = useState(false);
  const [popupUploadingOcr, setPopupUploadingOcr] = useState(false);
  const [analyzingForm, setAnalyzingForm] = useState(false);
  const [formGuideOpen, setFormGuideOpen] = useState(false);
  const [localFormAnalysis, setLocalFormAnalysis] = useState<FormPageAnalysis | null>(null);
  const [prewarmingIrctc, setPrewarmingIrctc] = useState(false);
  const [showTatkalBar, setShowTatkalBar] = useState(false);
  const [tatkalSetupOpen, setTatkalSetupOpen] = useState(false);
  const [tatkalFrom, setTatkalFrom] = useState(() => profile.preferredDepartureCity || '');
  const [tatkalTo, setTatkalTo] = useState('');
  const [tatkalDate, setTatkalDate] = useState(() => {
    const tomorrow = new Date(Date.now() + 86400000);
    const dd = String(tomorrow.getDate()).padStart(2, '0');
    const mm = String(tomorrow.getMonth() + 1).padStart(2, '0');
    return `${dd}/${mm}/${tomorrow.getFullYear()}`;
  });
  const [tatkalClass, setTatkalClass] = useState(() => profile.preferredTrainClass || '3A');
  const [tatkalQuota, setTatkalQuota] = useState('TATKAL');
  const [tatkalTrain, setTatkalTrain] = useState('');
  const [tatkalPassengers, setTatkalPassengers] = useState<
    Array<{ name: string; age: string; gender: string; berth: string }>
  >([{ name: '', age: '', gender: '', berth: '' }]);
  const [tatkalMobile, setTatkalMobile] = useState('');
  const [sessionLoginId, setSessionLoginId] = useState('');
  const [sessionLoginPw, setSessionLoginPw] = useState('');
  const [humanQuickInput, setHumanQuickInput] = useState('');
  const [submittingHumanQuick, setSubmittingHumanQuick] = useState(false);
  const [istNow, setIstNow] = useState(() => new Date());
  const lastPopupSigRef = useRef<string>('');

  const nativeApkMode = hasNativePortalBridge();
  const isDesktopViewport = status.viewportWidth >= 768;

  const wipeRef = useRef(onWipeAllSession);
  wipeRef.current = onWipeAllSession;
  const latestRef = useRef({ profile, ephemeralDocs, zeroSave, goal: agentGoal });
  latestRef.current = { profile, ephemeralDocs, zeroSave, goal: agentGoal };

  const wsRef = useRef<WebSocket | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const docFileRef = useRef<HTMLInputElement | null>(null);
  const popupOcrRef = useRef<HTMLInputElement | null>(null);
  const pendingDocReqRef = useRef<string | null>(null);
  const lastWheelAtRef = useRef<number>(0);
  const portalLaunchedAtRef = useRef<number>(0);

  const missingFields = useMemo(() => status.missingFields || [], [status.missingFields]);
  const activeAnalysis = status.formAnalysis || localFormAnalysis;
  const isIrctcActive = /irctc/i.test(status.url || '') || /irctc/i.test(addressInput || '') || Boolean(status.tatkalMode) || showTatkalBar;

  // Live IST clock for 10:00 AM AC / 11:00 AM Non-AC Tatkal timing
  useEffect(() => {
    if (!isIrctcActive) return;
    const t = window.setInterval(() => setIstNow(new Date()), 1000);
    return () => window.clearInterval(t);
  }, [isIrctcActive]);

  const istInfo = useMemo(() => {
    try {
      const istStr = istNow.toLocaleTimeString('en-IN', {
        timeZone: 'Asia/Kolkata',
        hour12: true,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
      const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Kolkata',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      }).formatToParts(istNow);
      const getNum = (t: string) => Number(parts.find((p) => p.type === t)?.value || '0');
      const secNow = getNum('hour') * 3600 + getNum('minute') * 60 + getNum('second');
      const fmtCountdown = (targetSec: number) => {
        let diff = targetSec - secNow;
        if (diff <= 0 && diff > -1800) return 'LIVE NOW';
        if (diff <= -1800) diff += 86400;
        const h = Math.floor(diff / 3600);
        const m = Math.floor((diff % 3600) / 60);
        const s = diff % 60;
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
      };
      return {
        clock: istStr,
        acCountdown: fmtCountdown(10 * 3600),
        slCountdown: fmtCountdown(11 * 3600),
      };
    } catch {
      return { clock: '--:--:--', acCountdown: '--:--', slCountdown: '--:--' };
    }
  }, [istNow]);

  // Automatically pop open the AI Details Modal whenever a form has unfilled missing details
  useEffect(() => {
    if (missingFields.length === 0) {
      setMissingPopupOpen(false);
      lastPopupSigRef.current = '';
      return;
    }
    const sig = `${status.url}|${missingFields.map((f) => f.id).join(',')}`;
    if (sig !== lastPopupSigRef.current) {
      lastPopupSigRef.current = sig;
      setMissingValues((prev) => {
        const next: Record<string, string> = {};
        for (const f of missingFields) {
          next[f.id] = prev[f.id] || '';
        }
        return next;
      });
      setMissingPopupOpen(true);
    }
  }, [missingFields, status.url]);

  useEffect(() => {
    let closed = false;
    let reconnectTimer: number | null = null;

    const connect = () => {
      if (closed) return;
      const ws = new WebSocket(buildWsUrl('/ws/browser'));
      wsRef.current = ws;

      ws.onopen = () => {
        if (!closed) setWsConnected(true);
      };
      ws.onclose = () => {
        if (!closed) {
          setWsConnected(false);
          reconnectTimer = window.setTimeout(connect, 1800);
        }
      };
      ws.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data);
          if (msg.type === 'status' && msg.status) {
            setStatus(msg.status);
            if (msg.status.url && msg.status.url !== 'about:blank') {
              setAddressInput(msg.status.url);
            }
          } else if (msg.type === 'frame' && msg.image) {
            setFrameSrc(`data:image/jpeg;base64,${msg.image}`);
          }
        } catch {
          // ignore
        }
      };
    };

    connect();

    window.onSarthiNativeUnmatched = (eventJson: string) => {
      void (async () => {
        try {
          const parsed = JSON.parse(eventJson) as {
            fields?: unknown[];
            url?: string;
            title?: string;
          };
          if (!parsed.fields || parsed.fields.length === 0) return;
          const latest = latestRef.current;
          const data = buildAutoFillPayload({
            profile: latest.profile,
            ephemeralDocs: latest.ephemeralDocs,
            zeroSave: latest.zeroSave,
            goal: latest.goal,
          });
          const res = await apiFetchJson<{ mapping?: Record<string, string> }>('/api/ai/map-fields', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              fields: parsed.fields,
              data,
              url: parsed.url,
              title: parsed.title,
            }),
          });
          const mapping = res.mapping || {};
          if (Object.keys(mapping).length > 0) {
            window.SarthiNative?.applyAiFieldMap?.(JSON.stringify(mapping));
          } else {
            setNativePortalLogs((prev) => ['AI ko bache hue fields ke liye vault me data nahi mila - aap khud bharein', ...prev].slice(0, 30));
          }
        } catch {
          setNativePortalLogs((prev) => ['AI field mapping abhi available nahi (server connect karein)', ...prev].slice(0, 30));
        }
      })();
    };

    // AI page padhta hai: rules jo page nahi samjhe (custom JS widgets, naya layout) unke liye Gemini plan banata hai
    window.onSarthiNativeStuck = (eventJson: string) => {
      void (async () => {
        try {
          const ev = JSON.parse(eventJson) as {
            url?: string;
            title?: string;
            headings?: unknown[];
            fields?: unknown[];
            buttons?: unknown[];
            payload?: Record<string, string>;
          };
          const latest = latestRef.current;
          const base = buildAutoFillPayload({
            profile: latest.profile,
            ephemeralDocs: latest.ephemeralDocs,
            zeroSave: latest.zeroSave,
            goal: latest.goal,
          });
          const data = { ...base, ...(ev.payload || {}) };
          const res = await apiFetchJson<{ plan?: { fills?: Record<string, string>; click?: string } }>(
            '/api/ai/plan-page',
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                snapshot: {
                  url: ev.url,
                  title: ev.title,
                  headings: ev.headings,
                  fields: ev.fields,
                  buttons: ev.buttons,
                },
                data,
              }),
            }
          );
          const plan = res.plan;
          if (plan && (Object.keys(plan.fills || {}).length > 0 || plan.click)) {
            window.SarthiNative?.applyAiPlan?.(JSON.stringify(plan));
          } else {
            setNativePortalLogs((prev) => ['AI ne page padha, par bharne layak data nahi mila - aap dekh lo', ...prev].slice(0, 30));
          }
        } catch {
          setNativePortalLogs((prev) => ['AI page padh nahi paya (server connect karein)', ...prev].slice(0, 30));
        }
      })();
    };

    // Sabji banane se pehle saman: form ke liye poori details/documents ki list, user se pehle hi maango
    window.onSarthiNativeRecipe = (eventJson: string) => {
      void (async () => {
        try {
          const ev = JSON.parse(eventJson) as { url?: string; title?: string; payload?: Record<string, string> };
          const latest = latestRef.current;
          const base = buildAutoFillPayload({
            profile: latest.profile,
            ephemeralDocs: latest.ephemeralDocs,
            zeroSave: latest.zeroSave,
            goal: latest.goal,
          });
          const data: Record<string, string> = { ...base, ...(ev.payload || {}) };
          const res = await apiFetchJson<{
            recipe?: {
              name?: string;
              details?: Array<{ key: string; label: string; options?: string[] }>;
              documents?: Array<{ label: string }>;
            };
          }>('/api/ai/form-recipe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: ev.url, title: ev.title, goal: latest.goal }),
          });
          const recipe = res.recipe;
          if (!recipe) return;
          const missing = (recipe.details || []).filter((d) => !(data[d.key] || '').trim());
          const docs = (recipe.documents || []).map((d) => d.label).filter(Boolean);
          const note = docs.length
            ? `${recipe.name || 'Is form'} ke liye documents: ${docs.join(' | ')}`
            : '';
          if (missing.length > 0) {
            window.SarthiNative?.showAsks?.(
              JSON.stringify(
                missing.map((d) => ({
                  id: '',
                  key: d.key,
                  label: d.label,
                  type: d.options && d.options.length > 0 ? 'select' : 'text',
                  options: d.options || [],
                }))
              ),
              note
            );
          } else if (note) {
            setNativePortalLogs((prev) => [note, ...prev].slice(0, 30));
          }
        } catch {
          // recipe optional hai - engine ki apni list kaam karti rahegi
        }
      })();
    };

    // Form complete ya portal close/back -> chat + documents + RAM details sab turant saaf
    const wipeCurrentTaskSession = (logMsg: string) => {
      portalLaunchedAtRef.current = 0;
      setUploadedReqMap({});
      setMissingValues({});
      setAgentGoal('');
      setTypeBox('');
      window.SarthiNative?.wipePortalSession?.();
      if (!serverOfflineMode) {
        void apiFetchJson('/api/live-browser/wipe', { method: 'POST' }).catch(() => {});
      }
      wipeRef.current();
      setNativePortalLogs((prev) => [logMsg, ...prev].slice(0, 30));
    };

    window.onSarthiNativeFormDone = () => {
      wipeCurrentTaskSession('Form complete - sabhi details aur documents RAM se saaf kar diye');
    };

    window.onSarthiNativePortalEvent = (eventJson: string) => {
      try {
        const parsed = JSON.parse(eventJson) as {
          event?: string;
          type?: string;
          status?: string;
          message?: string;
          url?: string;
        };
        if (parsed.url) setAddressInput(parsed.url);
        const sig = `${parsed.event || ''} ${parsed.type || ''} ${parsed.status || ''} ${parsed.message || ''}`;
        if (/(close|closed|exit|back|dismiss|done|finished)/i.test(sig)) {
          wipeCurrentTaskSession('Portal band hua - sabhi details aur documents saaf kar diye');
          return;
        }
        if (parsed.message) {
          setNativePortalLogs((prev) => [parsed.message!, ...prev].slice(0, 30));
        }
      } catch {
        // ignore
      }
    };

    // Native APK portal screen (< BACK / CLOSE) se wapas aate hi RAM details aur docs wipe karo
    const handleReturnFromNativePortal = () => {
      if (document.visibilityState === 'hidden') return;
      const launchedAt = portalLaunchedAtRef.current;
      if (launchedAt > 0 && Date.now() - launchedAt > 1200) {
        wipeCurrentTaskSession('Portal wapas/band hone par sabhi details aur documents delete kar diye');
      }
    };
    document.addEventListener('visibilitychange', handleReturnFromNativePortal);
    window.addEventListener('focus', handleReturnFromNativePortal);

    return () => {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      wsRef.current?.close();
      document.removeEventListener('visibilitychange', handleReturnFromNativePortal);
      window.removeEventListener('focus', handleReturnFromNativePortal);
      delete window.onSarthiNativeUnmatched;
      delete window.onSarthiNativeFormDone;
      delete window.onSarthiNativeStuck;
      delete window.onSarthiNativeRecipe;
    };
  }, []);

  const navigateTo = async (url: string) => {
    setError(null);
    setDismissedBlockedBanner(false);
    setShowToolsMenu(false);
    setShowPortalsList(false);
    setAddressInput(url);
    if (nativeApkMode && serverOfflineMode) {
      portalLaunchedAtRef.current = Date.now();
      launchNativeControlledPortal({
        url,
        profile,
        ephemeralDocs,
        zeroSave,
        goal: agentGoal,
      });
      return;
    }
    try {
      const data = await apiFetchJson<{ status?: LiveBrowserStatus }>(
        '/api/live-browser/navigate',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url }),
        }
      );
      if (data.status) setStatus(data.status);
    } catch (err) {
      if (nativeApkMode) {
        portalLaunchedAtRef.current = Date.now();
        launchNativeControlledPortal({
          url,
          profile,
          ephemeralDocs,
          zeroSave,
          goal: agentGoal,
        });
        return;
      }
      setError(err instanceof Error ? err.message : 'Navigation failed');
    }
  };

  const startLiveAgent = async (
    goalOverride?: string,
    urlOverride?: string,
    docsOverride?: EphemeralDocumentExtract[]
  ) => {
    const goal =
      (goalOverride ?? agentGoal).trim() ||
      'Click Apply / Online Form / Registration button on this portal if visible, fill my details, and pause at CAPTCHA or OTP.';
    setError(null);
    setShowToolsMenu(false);
    const targetUrl = urlOverride || addressInput;
    if (nativeApkMode && serverOfflineMode) {
      portalLaunchedAtRef.current = Date.now();
      launchNativeControlledPortal({
        url: targetUrl,
        profile,
        ephemeralDocs: docsOverride ?? ephemeralDocs,
        zeroSave,
        goal,
      });
      return;
    }
    try {
      const data = await apiFetchJson<{ status?: LiveBrowserStatus }>(
        '/api/live-browser/agent/start',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            goal,
            startUrl: urlOverride || (status.active ? undefined : addressInput),
            zeroSave,
            ephemeralDocs: docsOverride ?? ephemeralDocs,
          }),
        }
      );
      if (data.status) setStatus(data.status);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start AI Copilot');
    }
  };

  const runInstantAutoFill = async (urlOverride?: string, docsOverride?: EphemeralDocumentExtract[]) => {
    setError(null);
    setShowToolsMenu(false);
    const activeDocs = docsOverride ?? ephemeralDocs;
    if (nativeApkMode && window.SarthiNative?.autoFillPortal) {
      const payload = buildAutoFillPayload({
        profile,
        ephemeralDocs: activeDocs,
        zeroSave,
        goal: agentGoal,
      });
      window.SarthiNative.autoFillPortal(JSON.stringify(payload));
      setNativePortalLogs((prev) => ['Instant Rule + AI Fill triggered in APK WebView', ...prev].slice(0, 30));
      return;
    }
    setInstantFilling(true);
    try {
      const data = await apiFetchJson<{ status?: LiveBrowserStatus }>(
        '/api/live-browser/autofill',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            goal: agentGoal,
            startUrl: urlOverride || (status.active ? undefined : addressInput),
            zeroSave,
            autoApply: true,
            ephemeralDocs: activeDocs,
          }),
        }
      );
      if (data.status) {
        setStatus(data.status);
        if ((data.status.missingFields?.length || 0) > 0) {
          lastPopupSigRef.current = '';
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Auto-Apply & Fill failed');
    } finally {
      setInstantFilling(false);
    }
  };

  const handleSubmitMissingDetails = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submittingMissing) return;

    const entries = missingFields
      .map((f) => ({
        id: f.id,
        key: f.key,
        label: f.label,
        value: (missingValues[f.id] || '').trim(),
      }))
      .filter((entry) => entry.value.length > 0);

    if (entries.length === 0) {
      setMissingPopupOpen(false);
      return;
    }

    setSubmittingMissing(true);
    setError(null);
    try {
      // Remember user answers inside RAM-only session extract so next pages reuse them
      onAddEphemeralDoc({
        id: `popup-${Date.now()}`,
        fileName: 'AI Popup Input',
        documentType: 'User Entered Details',
        summary: `${entries.length} form details entered via AI Popup`,
        fields: entries.map((en) => ({
          key: en.key || en.label.toLowerCase().replace(/[^a-z0-9]+/g, '_'),
          label: en.label,
          value: en.value,
        })),
        extractedAt: new Date().toISOString(),
      });

      const data = await apiFetchJson<{ status?: LiveBrowserStatus }>(
        '/api/live-browser/fill-missing',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ entries }),
        }
      );
      if (data.status) {
        setStatus(data.status);
      }
      setMissingPopupOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to apply entered details');
    } finally {
      setSubmittingMissing(false);
    }
  };

  const handlePopupOcrUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setPopupUploadingOcr(true);
    setError(null);
    try {
      let extracted: EphemeralDocumentExtract | null = null;
      try {
        const formData = new FormData();
        formData.append('document', file);
        const data = await apiFetchJson<{ extracted: EphemeralDocumentExtract }>(
          '/api/ocr/extract',
          { method: 'POST', body: formData }
        );
        extracted = data.extracted;
      } catch (serverErr) {
        const nativeExtracted = await runNativeOnDeviceOcr(file);
        if (!nativeExtracted) throw serverErr;
        extracted = nativeExtracted;
      }

      onAddEphemeralDoc(extracted);
      const nextDocs = [extracted, ...ephemeralDocs];
      setMissingPopupOpen(false);
      await runInstantAutoFill(undefined, nextDocs);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to scan document');
    } finally {
      setPopupUploadingOcr(false);
    }
  };

  const switchViewport = async (mode: 'desktop' | 'mobile') => {
    if (switchingViewport || serverOfflineMode) return;
    setSwitchingViewport(true);
    setShowToolsMenu(false);
    try {
      const data = await apiFetchJson<{ status?: LiveBrowserStatus }>(
        '/api/live-browser/viewport',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode }),
        }
      );
      if (data.status) setStatus(data.status);
    } catch {
      // ignore
    } finally {
      setSwitchingViewport(false);
    }
  };

  const handleInlineDocFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const reqId = pendingDocReqRef.current;
    e.target.value = '';
    if (!file || !reqId) return;

    setUploadingReqId(reqId);
    setError(null);
    try {
      let extracted: EphemeralDocumentExtract | null = null;
      try {
        const formData = new FormData();
        formData.append('document', file);
        const data = await apiFetchJson<{ extracted: EphemeralDocumentExtract }>(
          '/api/ocr/extract',
          {
            method: 'POST',
            body: formData,
          }
        );
        extracted = data.extracted;
      } catch (serverErr) {
        const nativeExtracted = await runNativeOnDeviceOcr(file);
        if (!nativeExtracted) throw serverErr;
        extracted = nativeExtracted;
      }
      onAddEphemeralDoc(extracted);
      setUploadedReqMap((prev) => ({ ...prev, [reqId]: extracted.fileName }));
      const nextDocs = [extracted, ...ephemeralDocs];
      if (!serverOfflineMode) {
        await runInstantAutoFill(undefined, nextDocs);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not scan document');
    } finally {
      setUploadingReqId(null);
      pendingDocReqRef.current = null;
    }
  };

  useEffect(() => {
    if (initialUrl || initialGoal) {
      if (initialUrl) setAddressInput(initialUrl);
      if (initialGoal) setAgentGoal(initialGoal);

      if (nativeApkMode && initialUrl) {
        portalLaunchedAtRef.current = Date.now();
        launchNativeControlledPortal({
          url: initialUrl,
          profile,
          ephemeralDocs,
          zeroSave,
          goal: initialGoal || undefined,
        });
      } else if (!serverOfflineMode) {
        if (initialUrl) {
          void navigateTo(initialUrl).then(() => runInstantAutoFill(initialUrl));
        } else if (initialGoal) {
          void startLiveAgent(initialGoal, undefined);
        }
      }
      onConsumeInitial();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialUrl, initialGoal, serverOfflineMode, nativeApkMode]);

  const stopLiveAgent = async () => {
    await apiFetchJson('/api/live-browser/agent/stop', { method: 'POST' }).catch(() => {});
  };

  const toggleAdBlock = async () => {
    try {
      const data = await apiFetchJson<{ status?: LiveBrowserStatus }>(
        '/api/live-browser/adblock',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: !status.adBlockEnabled }),
        }
      );
      if (data.status) setStatus(data.status);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not toggle ad-blocker');
    }
  };

  const toggleTatkalMode = async () => {
    try {
      const data = await apiFetchJson<{ status?: LiveBrowserStatus }>(
        '/api/live-browser/tatkal-mode',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: !status.tatkalMode }),
        }
      );
      if (data.status) setStatus(data.status);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not toggle Tatkal Turbo Mode');
    }
  };

  const handlePrewarmIrctc = async () => {
    if (prewarmingIrctc) return;
    setPrewarmingIrctc(true);
    setError(null);
    setAddressInput('https://www.irctc.co.in/nget/train-search');
    try {
      const data = await apiFetchJson<{ status?: LiveBrowserStatus }>(
        '/api/live-browser/tatkal-prewarm',
        { method: 'POST' }
      );
      if (data.status) setStatus(data.status);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'IRCTC pre-warm failed');
    } finally {
      setPrewarmingIrctc(false);
    }
  };

  const handleAnalyzeForm = async () => {
    if (analyzingForm) return;
    setAnalyzingForm(true);
    setError(null);
    try {
      const data = await apiFetchJson<{
        status?: LiveBrowserStatus;
        analysis?: FormPageAnalysis | null;
      }>('/api/live-browser/analyze-form', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ zeroSave, ephemeralDocs }),
      });
      if (data.status) setStatus(data.status);
      if (data.analysis) {
        setLocalFormAnalysis(data.analysis);
        setFormGuideOpen(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AI Form analysis failed');
    } finally {
      setAnalyzingForm(false);
    }
  };

  const buildTatkalEffectiveDocs = (): EphemeralDocumentExtract[] => {
    const fields: Array<{ key: string; label: string; value: string }> = [];
    if (tatkalFrom.trim()) fields.push({ key: 'fromStation', label: 'From Station', value: tatkalFrom.trim() });
    if (tatkalTo.trim()) fields.push({ key: 'toStation', label: 'To Station', value: tatkalTo.trim() });
    if (tatkalDate.trim()) fields.push({ key: 'journeyDate', label: 'Journey Date', value: tatkalDate.trim() });
    if (tatkalClass.trim()) fields.push({ key: 'trainClass', label: 'Train Class', value: tatkalClass.trim() });
    if (tatkalQuota.trim()) fields.push({ key: 'trainQuota', label: 'Train Quota', value: tatkalQuota.trim() });
    if (tatkalTrain.trim()) fields.push({ key: 'preferredTrain', label: 'Preferred Train', value: tatkalTrain.trim() });
    if (tatkalMobile.trim()) fields.push({ key: 'mobile', label: 'Mobile Number', value: tatkalMobile.trim() });
    if (sessionLoginId.trim()) fields.push({ key: 'loginUserId', label: 'IRCTC User ID', value: sessionLoginId.trim() });
    if (sessionLoginPw.trim()) fields.push({ key: 'loginPassword', label: 'IRCTC Password', value: sessionLoginPw.trim() });

    tatkalPassengers.slice(0, 4).forEach((pax, idx) => {
      const n = idx + 1;
      if (pax.name.trim()) {
        fields.push({ key: `passenger${n}Name`, label: `Passenger ${n} Name`, value: pax.name.trim() });
        if (n === 1) fields.push({ key: 'fullName', label: 'Passenger Name', value: pax.name.trim() });
      }
      if (pax.age.trim()) {
        fields.push({ key: `passenger${n}Age`, label: `Passenger ${n} Age`, value: pax.age.trim() });
        if (n === 1) fields.push({ key: 'age', label: 'Passenger Age', value: pax.age.trim() });
      }
      if (pax.gender.trim()) {
        fields.push({ key: `passenger${n}Gender`, label: `Passenger ${n} Gender`, value: pax.gender.trim() });
        if (n === 1) fields.push({ key: 'gender', label: 'Gender', value: pax.gender.trim() });
      }
      if (pax.berth.trim()) {
        fields.push({ key: `passenger${n}Berth`, label: `Passenger ${n} Berth`, value: pax.berth.trim() });
        if (n === 1) fields.push({ key: 'berthPreference', label: 'Berth Preference', value: pax.berth.trim() });
      }
    });

    if (fields.length === 0) return ephemeralDocs;
    const tatkalDoc: EphemeralDocumentExtract = {
      id: `tatkal-${Date.now()}`,
      fileName: 'Tatkal Express Session (RAM)',
      documentType: 'IRCTC Tatkal Session Details',
      summary: 'Temporary RAM-only Tatkal journey & passenger details',
      fields,
      extractedAt: new Date().toISOString(),
    };
    return [tatkalDoc, ...ephemeralDocs];
  };

  const startTatkalExpress = async () => {
    setError(null);
    const docs = buildTatkalEffectiveDocs();
    const targetUrl = isIrctcActive && status.active && /irctc/i.test(status.url || '')
      ? undefined
      : 'https://www.irctc.co.in/nget/train-search';
    const goal = `IRCTC Tatkal Express Auto-Book (${tatkalFrom || 'Source'} -> ${tatkalTo || 'Dest'}, ${tatkalClass}, ${tatkalQuota}). Login ID/Pass + Passenger + BHIM/UPI select karo; sirf CAPTCHA, OTP aur Payment mere liye roko.`;

    if (!status.tatkalMode && !serverOfflineMode) {
      await apiFetchJson('/api/live-browser/tatkal-mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: true }),
      }).catch(() => {});
    }

    if (nativeApkMode && serverOfflineMode) {
      portalLaunchedAtRef.current = Date.now();
      launchNativeControlledPortal({
        url: 'https://www.irctc.co.in/nget/train-search',
        profile,
        ephemeralDocs: docs,
        zeroSave,
        goal,
      });
      return;
    }

    await startLiveAgent(goal, targetUrl, docs);
  };

  const tatkalPhoneTargetUrl =
    status.url && /irctc/i.test(status.url) && !status.url.startsWith('chrome-error://')
      ? status.url
      : 'https://www.irctc.co.in/nget/train-search';

  const openTatkalInPhoneBridge = () => {
    const docs = buildTatkalEffectiveDocs();
    portalLaunchedAtRef.current = Date.now();
    launchNativeControlledPortal({
      url: tatkalPhoneTargetUrl,
      profile,
      ephemeralDocs: docs,
      zeroSave,
      goal: 'IRCTC Tatkal Fast-Track Booking (stop at CAPTCHA, OTP, Payment)',
    });
  };

  const handleSubmitHumanQuick = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submittingHumanQuick || status.tatkalStage === 'payment') return;
    setSubmittingHumanQuick(true);
    setError(null);
    try {
      const docs = buildTatkalEffectiveDocs();
      const data = await apiFetchJson<{ status?: LiveBrowserStatus }>(
        '/api/live-browser/tatkal-human-submit',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: humanQuickInput.trim(),
            clickAction: true,
            pressEnter: true,
            goal:
              agentGoal ||
              'Continue IRCTC Tatkal Fast-Track booking and stop at CAPTCHA, OTP, or Payment.',
            zeroSave,
            ephemeralDocs: docs,
          }),
        }
      );
      if (data.status) setStatus(data.status);
      setHumanQuickInput('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to submit CAPTCHA / OTP');
    } finally {
      setSubmittingHumanQuick(false);
    }
  };

  const applySessionCredentialsAndFill = async () => {
    const uid = sessionLoginId.trim();
    const pw = sessionLoginPw.trim();
    if (!uid && !pw) return;
    const fields: Array<{ key: string; label: string; value: string }> = [];
    if (uid) fields.push({ key: 'loginUserId', label: 'Portal User ID', value: uid });
    if (pw) fields.push({ key: 'loginPassword', label: 'Portal Password', value: pw });
    const credDoc: EphemeralDocumentExtract = {
      id: `cred-${Date.now()}`,
      fileName: 'Session Login (RAM)',
      documentType: 'Session Login Credentials',
      summary: 'Temporary session credentials (never persisted)',
      fields,
      extractedAt: new Date().toISOString(),
    };
    onAddEphemeralDoc(credDoc);
    const nextDocs = [credDoc, ...ephemeralDocs];
    await runInstantAutoFill(undefined, nextDocs);
  };

  const handleWipeBrowser = async () => {
    portalLaunchedAtRef.current = 0;
    setFrameSrc(null);
    setNativePortalLogs([]);
    setMissingPopupOpen(false);
    setMissingValues({});
    setShowPwMap({});
    setLocalFormAnalysis(null);
    setFormGuideOpen(false);
    setSessionLoginId('');
    setSessionLoginPw('');
    setUploadedReqMap({});
    setAgentGoal('');
    setTypeBox('');
    setShowToolsMenu(false);
    window.SarthiNative?.wipePortalSession?.();
    if (!serverOfflineMode) {
      try {
        const data = await apiFetchJson<{ status?: LiveBrowserStatus }>(
          '/api/live-browser/wipe',
          { method: 'POST' }
        );
        if (data.status) setStatus(data.status);
      } catch {
        // still wipe local session
      }
    }
    onWipeAllSession();
  };

  const sendWs = (payload: unknown) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(payload));
    }
  };

  const handleViewportClick = (e: React.MouseEvent<HTMLImageElement>) => {
    const img = imgRef.current;
    if (!img) return;
    const rect = img.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    // Account for object-contain letterboxing so clicks/taps hit exact page elements
    const natW = img.naturalWidth || status.viewportWidth || 1366;
    const natH = img.naturalHeight || status.viewportHeight || 820;
    const scale = Math.min(rect.width / natW, rect.height / natH);
    const renderedW = natW * scale;
    const renderedH = natH * scale;
    const offsetX = rect.left + (rect.width - renderedW) / 2;
    const offsetY = rect.top + (rect.height - renderedH) / 2;

    const xRatio = Math.max(0, Math.min(1, (e.clientX - offsetX) / renderedW));
    const yRatio = Math.max(0, Math.min(1, (e.clientY - offsetY) / renderedH));
    const x = Math.round(xRatio * status.viewportWidth);
    const y = Math.round(yRatio * status.viewportHeight);

    const markerXPct = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
    const markerYPct = Math.max(0, Math.min(100, ((e.clientY - rect.top) / rect.height) * 100));
    setClickMarker({ xPct: markerXPct, yPct: markerYPct });
    setTimeout(() => setClickMarker(null), 500);
    sendWs({ type: 'click', x, y });
  };

  const handleViewportWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (!frameSrc) return;
    const now = Date.now();
    if (now - lastWheelAtRef.current < 140) return;
    lastWheelAtRef.current = now;
    sendWs({ type: 'scroll', deltaY: Math.round(e.deltaY) });
  };

  const sendTypedText = (text: string) => {
    if (!text) return;
    sendWs({ type: 'type', text });
  };

  const handleTypeSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!typeBox) return;
    sendTypedText(typeBox);
    setTypeBox('');
  };

  const copyVal = async (key: string, val: string) => {
    try {
      await navigator.clipboard.writeText(val);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 1500);
    } catch {
      // ignore
    }
  };

  const deleteBookmark = async (id: string) => {
    try {
      const data = await apiFetchJson<{ bookmarks?: PortalBookmark[] }>(
        `/api/bookmarks/${id}`,
        { method: 'DELETE' }
      );
      if (Array.isArray(data.bookmarks)) {
        onBookmarksChange(data.bookmarks);
      }
    } catch {
      onBookmarksChange(bookmarks.filter((b) => b.id !== id));
    }
  };

  const quickFillEntries: { key: string; label: string; value: string; source: string }[] = [];
  for (const doc of ephemeralDocs) {
    for (const f of doc.fields) {
      quickFillEntries.push({
        key: `${doc.id}-${f.key}`,
        label: f.label,
        value: f.value,
        source: 'OCR',
      });
    }
  }
  if (!zeroSave) {
    const vaultPairs: [string, string][] = [
      ['Full Name', profile.fullName],
      ["Father's Name", profile.fatherName],
      ['DOB', profile.dob],
      ['Mobile', profile.mobile],
      ['Email', profile.email],
      ['Address', profile.addressLine],
      ['District', profile.district],
      ['State', profile.state],
      ['PIN Code', profile.pinCode],
      ['PAN', profile.panNumber],
    ];
    for (const [label, value] of vaultPairs) {
      if (value && value.trim()) {
        quickFillEntries.push({ key: `v-${label}`, label, value, source: 'Vault' });
      }
    }
  }

  const latestDoc = ephemeralDocs[0] || null;
  const currentStateField = latestDoc?.fields.find(
    (f) => f.key.toLowerCase() === 'state' || f.label.toLowerCase() === 'state'
  );

  const isStateField = (f: MissingFormField) =>
    f.key === 'state' || /\b(state|rajya|राज्य|province)\b/i.test(f.label);

  return (
    <div
      className={
        isFullscreen
          ? 'fixed inset-0 z-50 bg-[#F4F6FA] p-2 sm:p-4 flex flex-col'
          : 'flex-1 flex flex-col gap-3'
      }
    >
      <input
        ref={docFileRef}
        type="file"
        accept="image/*,.pdf"
        onChange={handleInlineDocFile}
        className="hidden"
      />
      <input
        ref={popupOcrRef}
        type="file"
        accept="image/*,.pdf"
        onChange={handlePopupOcrUpload}
        className="hidden"
      />

      <div className="flex-1 grid grid-cols-1 xl:grid-cols-12 gap-4 items-stretch">
        {/* Main Desktop Browser Window */}
        <div
          className={`${
            showCopilotDrawer ? 'xl:col-span-8' : 'xl:col-span-12'
          } bg-white border border-slate-200/90 rounded-2xl overflow-hidden shadow-xs flex flex-col flex-1`}
        >
          {/* Single Clean Slim Browser Omnibox Chrome */}
          <div className="px-2.5 sm:px-3.5 py-2 bg-[#0B1120] text-white flex flex-wrap items-center gap-2 border-b border-slate-800">
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={() => void apiFetchJson('/api/live-browser/back', { method: 'POST' }).catch(() => {})}
                aria-label="Back"
                className="min-h-[36px] min-w-[36px] rounded-lg bg-slate-800/90 hover:bg-slate-700 text-slate-200 flex items-center justify-center transition-colors"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => void apiFetchJson('/api/live-browser/reload', { method: 'POST' }).catch(() => {})}
                aria-label="Reload"
                className="min-h-[36px] min-w-[36px] rounded-lg bg-slate-800/90 hover:bg-slate-700 text-slate-200 flex items-center justify-center transition-colors"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${status.loading ? 'animate-spin text-sky-400' : ''}`} />
              </button>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                void navigateTo(addressInput);
              }}
              className="flex-1 min-w-[160px] flex items-center gap-1.5"
            >
              <div className="relative flex-1">
                <Lock className="w-3.5 h-3.5 text-emerald-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={addressInput}
                  onChange={(e) => setAddressInput(e.target.value)}
                  placeholder="Website URL ya Google jaisa kuch bhi search karein..."
                  className="w-full min-h-[36px] pl-8 pr-2.5 rounded-lg bg-slate-900 border border-slate-700/90 focus:border-sky-400 focus:outline-none text-xs font-mono text-slate-100 placeholder:text-slate-500"
                />
              </div>
              <button
                type="submit"
                className="min-h-[36px] px-3 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white font-semibold text-xs whitespace-nowrap shrink-0 transition-colors"
              >
                Go
              </button>
            </form>

            {/* Streamlined Action Buttons: Form Guide, Auto-Fill, AI Apply, AI Task & Tools Menu */}
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                disabled={analyzingForm || !status.active || status.url === 'about:blank'}
                onClick={() => void handleAnalyzeForm()}
                title="AI is form ko padh kar batayega: kaise bharna hai aur kya document + size lagega"
                className="min-h-[36px] px-2.5 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-45 text-white font-semibold text-xs inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors"
              >
                {analyzingForm ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <FileSearch className="w-3.5 h-3.5" />
                )}
                <span className="hidden md:inline">Form Guide</span>
              </button>

              <button
                type="button"
                disabled={instantFilling || status.agentRunning}
                onClick={() => void runInstantAutoFill()}
                title="Apply button click karke form fill karein (password aur missing details AI Popup me puchhega)"
                className="min-h-[36px] px-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold text-xs inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors"
              >
                {instantFilling ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Zap className="w-3.5 h-3.5" />
                )}
                <span>Auto-Fill</span>
              </button>

              {status.agentRunning ? (
                <button
                  type="button"
                  onClick={stopLiveAgent}
                  className="min-h-[36px] px-3 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-semibold text-xs inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
                >
                  <Square className="w-3.5 h-3.5" />
                  <span>Stop</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void startLiveAgent()}
                  title="AI khud Apply / Registration par click karega aur form bharega"
                  className="min-h-[36px] px-3 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-semibold text-xs inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>AI Apply</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => setIntentModalOpen(true)}
                title="AI ko batayein is form/website me aapko kya karna hai"
                className="min-h-[36px] px-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-100 font-semibold text-xs inline-flex items-center gap-1 whitespace-nowrap shrink-0 transition-colors"
              >
                <Bot className="w-3.5 h-3.5 text-amber-400" />
                <span className="hidden sm:inline">Kya Karna Hai?</span>
                <span className="sm:hidden">Task</span>
              </button>

              <div className="relative">
                <button
                  type="button"
                  onClick={() => {
                    setShowToolsMenu((v) => !v);
                    setShowPortalsList(false);
                  }}
                  aria-label="Browser tools and view options"
                  className="min-h-[36px] min-w-[36px] px-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 flex items-center justify-center transition-colors"
                >
                  <MoreVertical className="w-4 h-4" />
                </button>

                {showToolsMenu && (
                  <div className="absolute right-0 mt-2 w-64 bg-white text-slate-900 border border-slate-200 rounded-xl shadow-xl z-40 p-2 space-y-1">
                    <div className="px-2.5 py-1.5 flex items-center justify-between text-[11px] text-slate-500 border-b border-slate-100">
                      <span>{wsConnected ? 'Live Chromium' : 'Connecting'}</span>
                      <span className="font-mono tabular-nums">
                        {status.viewportWidth}×{status.viewportHeight}
                      </span>
                    </div>

                    <div className="p-1 bg-slate-100 rounded-lg grid grid-cols-2 gap-1">
                      <button
                        type="button"
                        disabled={switchingViewport}
                        onClick={() => void switchViewport('desktop')}
                        className={`min-h-[32px] rounded-md text-xs font-semibold inline-flex items-center justify-center gap-1.5 ${
                          isDesktopViewport
                            ? 'bg-[#0B1120] text-white'
                            : 'text-slate-700 hover:text-slate-900'
                        }`}
                      >
                        <Monitor className="w-3.5 h-3.5" />
                        Desktop
                      </button>
                      <button
                        type="button"
                        disabled={switchingViewport}
                        onClick={() => void switchViewport('mobile')}
                        className={`min-h-[32px] rounded-md text-xs font-semibold inline-flex items-center justify-center gap-1.5 ${
                          !isDesktopViewport
                            ? 'bg-[#0B1120] text-white'
                            : 'text-slate-700 hover:text-slate-900'
                        }`}
                      >
                        <Smartphone className="w-3.5 h-3.5" />
                        Mobile
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        setShowPortalsList((v) => !v);
                        setShowToolsMenu(false);
                      }}
                      className="w-full min-h-[36px] px-2.5 rounded-lg hover:bg-slate-50 text-xs font-medium text-slate-800 flex items-center justify-between"
                    >
                      <span className="inline-flex items-center gap-2">
                        <Bookmark className="w-3.5 h-3.5 text-sky-600" />
                        Saved Portals
                      </span>
                      <span className="text-[11px] text-slate-400">{bookmarks.length}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setShowCopilotDrawer((v) => !v);
                        setShowToolsMenu(false);
                      }}
                      className="w-full min-h-[36px] px-2.5 rounded-lg hover:bg-slate-50 text-xs font-medium text-slate-800 flex items-center justify-between"
                    >
                      <span className="inline-flex items-center gap-2">
                        {showCopilotDrawer ? (
                          <PanelRightClose className="w-3.5 h-3.5 text-rose-600" />
                        ) : (
                          <PanelRightOpen className="w-3.5 h-3.5 text-rose-600" />
                        )}
                        {showCopilotDrawer ? 'Hide AI Drawer' : 'Open AI Drawer'}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={toggleAdBlock}
                      className="w-full min-h-[36px] px-2.5 rounded-lg hover:bg-slate-50 text-xs font-medium text-slate-800 flex items-center justify-between"
                    >
                      <span className="inline-flex items-center gap-2">
                        <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                        Ad-Blocker ({status.adBlockEnabled ? 'ON' : 'OFF'})
                      </span>
                      <span className="text-[11px] font-mono text-slate-400">
                        {status.blockedAdsCount} blocked
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setShowTatkalBar((v) => !v);
                        setShowToolsMenu(false);
                      }}
                      className="w-full min-h-[36px] px-2.5 rounded-lg hover:bg-slate-50 text-xs font-medium text-slate-800 flex items-center justify-between"
                    >
                      <span className="inline-flex items-center gap-2">
                        <Clock className="w-3.5 h-3.5 text-amber-600" />
                        IRCTC Tatkal Bar
                      </span>
                      <span className="text-[11px] text-slate-400">
                        {status.tatkalMode ? 'Turbo' : 'Ready'}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setIsFullscreen((v) => !v);
                        setShowToolsMenu(false);
                      }}
                      className="w-full min-h-[36px] px-2.5 rounded-lg hover:bg-slate-50 text-xs font-medium text-slate-800 flex items-center justify-between"
                    >
                      <span className="inline-flex items-center gap-2">
                        {isFullscreen ? (
                          <Minimize2 className="w-3.5 h-3.5 text-slate-600" />
                        ) : (
                          <Maximize2 className="w-3.5 h-3.5 text-slate-600" />
                        )}
                        {isFullscreen ? 'Exit Fullscreen' : 'Fullscreen View'}
                      </span>
                    </button>

                    {status.url && status.url !== 'about:blank' && (
                      <a
                        href={status.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="w-full min-h-[36px] px-2.5 rounded-lg hover:bg-slate-50 text-xs font-medium text-slate-800 flex items-center gap-2"
                      >
                        <ExternalLink className="w-3.5 h-3.5 text-slate-600" />
                        Open in New Tab
                      </a>
                    )}

                    <div className="pt-1 border-t border-slate-100">
                      <button
                        type="button"
                        onClick={handleWipeBrowser}
                        className="w-full min-h-[36px] px-2.5 rounded-lg hover:bg-rose-50 text-xs font-semibold text-rose-700 flex items-center gap-2"
                      >
                        <Eraser className="w-3.5 h-3.5" />
                        Wipe Browser &amp; RAM
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Saved Portals Dropdown Drawer when toggled from Menu */}
          {showPortalsList && (
            <div className="p-3 bg-slate-50 border-b border-slate-200 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-800">Saved Portals</span>
                <button
                  type="button"
                  onClick={() => setShowPortalsList(false)}
                  className="text-xs text-slate-500 hover:text-slate-900"
                >
                  Close
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 max-h-56 overflow-y-auto">
                {bookmarks.map((bm) => (
                  <div
                    key={bm.id}
                    className="flex items-center justify-between gap-1.5 bg-white border border-slate-200 rounded-lg px-2.5 py-2"
                  >
                    <button
                      type="button"
                      onClick={() => void navigateTo(bm.url)}
                      className="flex-1 text-left min-w-0"
                    >
                      <div className="text-xs font-semibold text-slate-900 truncate">{bm.name}</div>
                      <div className="text-[10px] font-mono text-slate-500 truncate">{bm.url}</div>
                    </button>
                    <button
                      type="button"
                      onClick={() => void deleteBookmark(bm.id)}
                      aria-label={`Remove ${bm.name}`}
                      className="p-1 text-slate-400 hover:text-rose-600 shrink-0"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* IRCTC Tatkal 10:00 AM AC / 11:00 AM Non-AC Express Command Bar */}
          {isIrctcActive && (
            <div className="bg-[#0B1120] text-slate-100 border-b border-amber-500/30 text-xs">
              <div className="px-3.5 py-2 flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 font-bold text-amber-400 tabular-nums">
                    <Clock className="w-3.5 h-3.5" />
                    IST {istInfo.clock}
                  </span>
                  <span className="px-2 py-0.5 rounded bg-slate-900 border border-slate-700 font-mono text-[11px] tabular-nums">
                    AC 10:00: <strong className="text-amber-300">{istInfo.acCountdown}</strong>
                  </span>
                  <span className="px-2 py-0.5 rounded bg-slate-900 border border-slate-700 font-mono text-[11px] tabular-nums">
                    SL 11:00: <strong className="text-amber-300">{istInfo.slCountdown}</strong>
                  </span>
                  <span className="hidden lg:inline-flex items-center gap-1 text-[11px] text-slate-300 pl-1 border-l border-slate-700">
                    <span className={status.tatkalStage === 'search' || status.tatkalStage === 'train_list' ? 'text-emerald-400 font-semibold' : ''}>
                      1. Search
                    </span>
                    <span>→</span>
                    <span className={status.tatkalStage === 'login_captcha' ? 'text-amber-400 font-semibold' : ''}>
                      2. Login CAPTCHA
                    </span>
                    <span>→</span>
                    <span className={status.tatkalStage === 'passenger' ? 'text-emerald-400 font-semibold' : ''}>
                      3. Passenger+UPI
                    </span>
                    <span>→</span>
                    <span className={status.tatkalStage === 'review_captcha' || status.tatkalStage === 'otp' || status.tatkalStage === 'payment' ? 'text-amber-400 font-semibold' : ''}>
                      4. CAPTCHA/OTP/Pay
                    </span>
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setTatkalSetupOpen((v) => !v)}
                    className={`min-h-[30px] px-2.5 rounded-lg font-semibold text-[11px] border whitespace-nowrap shrink-0 transition-colors ${
                      tatkalSetupOpen
                        ? 'bg-amber-400 text-slate-950 border-amber-400'
                        : 'bg-slate-800 hover:bg-slate-700 text-slate-100 border-slate-700'
                    }`}
                  >
                    Tatkal Setup
                  </button>
                  <button
                    type="button"
                    onClick={() => void toggleTatkalMode()}
                    className={`min-h-[30px] px-2.5 rounded-lg font-semibold text-[11px] whitespace-nowrap shrink-0 transition-colors ${
                      status.tatkalMode
                        ? 'bg-emerald-500 text-slate-950'
                        : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700'
                    }`}
                  >
                    Turbo: {status.tatkalMode ? 'ON' : 'OFF'}
                  </button>
                  <button
                    type="button"
                    disabled={prewarmingIrctc}
                    onClick={() => void handlePrewarmIrctc()}
                    className="min-h-[30px] px-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white font-semibold text-[11px] inline-flex items-center gap-1 whitespace-nowrap shrink-0 disabled:opacity-60"
                  >
                    {prewarmingIrctc ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Zap className="w-3 h-3 text-amber-400" />
                    )}
                    Pre-Warm
                  </button>
                  <button
                    type="button"
                    disabled={status.agentRunning}
                    onClick={() => void startTatkalExpress()}
                    className="min-h-[30px] px-3 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-[11px] inline-flex items-center gap-1 whitespace-nowrap shrink-0 disabled:opacity-55"
                  >
                    <Sparkles className="w-3 h-3" />
                    Tatkal Auto-Book
                  </button>
                  {nativeApkMode ? (
                    <button
                      type="button"
                      onClick={openTatkalInPhoneBridge}
                      title="Agar Cloud IP par Akamai 403 block aaye to seedha Phone ke IP par kholein"
                      className="min-h-[30px] px-2.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-semibold text-[11px] inline-flex items-center gap-1 whitespace-nowrap shrink-0"
                    >
                      <Smartphone className="w-3 h-3" />
                      Phone IP
                    </button>
                  ) : (
                    <a
                      href={tatkalPhoneTargetUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="Agar Cloud IP par Akamai 403 block aaye to seedha Phone ke IP par kholein"
                      className="min-h-[30px] px-2.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-semibold text-[11px] inline-flex items-center gap-1 whitespace-nowrap shrink-0"
                    >
                      <Smartphone className="w-3 h-3" />
                      Phone IP
                    </a>
                  )}
                </div>
              </div>

              {tatkalSetupOpen && (
                <div className="px-3.5 py-2.5 bg-slate-900/95 border-t border-slate-800 space-y-2">
                  <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-1.5">
                    <input
                      type="text"
                      value={tatkalFrom}
                      onChange={(e) => setTatkalFrom(e.target.value.toUpperCase())}
                      placeholder="From (e.g. NDLS)"
                      className="min-h-[32px] px-2.5 rounded-lg bg-slate-950 border border-slate-700 focus:border-amber-400 focus:outline-none text-xs text-white placeholder:text-slate-500"
                    />
                    <input
                      type="text"
                      value={tatkalTo}
                      onChange={(e) => setTatkalTo(e.target.value.toUpperCase())}
                      placeholder="To (e.g. PNBE)"
                      className="min-h-[32px] px-2.5 rounded-lg bg-slate-950 border border-slate-700 focus:border-amber-400 focus:outline-none text-xs text-white placeholder:text-slate-500"
                    />
                    <input
                      type="text"
                      value={tatkalDate}
                      onChange={(e) => setTatkalDate(e.target.value)}
                      placeholder="DD/MM/YYYY"
                      className="min-h-[32px] px-2.5 rounded-lg bg-slate-950 border border-slate-700 focus:border-amber-400 focus:outline-none text-xs text-white font-mono placeholder:text-slate-500"
                    />
                    <select
                      value={tatkalClass}
                      onChange={(e) => setTatkalClass(e.target.value)}
                      className="min-h-[32px] px-2 rounded-lg bg-slate-950 border border-slate-700 focus:border-amber-400 focus:outline-none text-xs text-white"
                    >
                      <option value="SL">SL (Sleeper)</option>
                      <option value="3A">3A (AC 3 Tier)</option>
                      <option value="3E">3E (AC Economy)</option>
                      <option value="2A">2A (AC 2 Tier)</option>
                      <option value="1A">1A (First AC)</option>
                      <option value="CC">CC (Chair Car)</option>
                      <option value="2S">2S (2nd Sitting)</option>
                    </select>
                    <select
                      value={tatkalQuota}
                      onChange={(e) => setTatkalQuota(e.target.value)}
                      className="min-h-[32px] px-2 rounded-lg bg-slate-950 border border-slate-700 focus:border-amber-400 focus:outline-none text-xs text-white"
                    >
                      <option value="TATKAL">TATKAL</option>
                      <option value="PREMIUM TATKAL">PREMIUM TATKAL</option>
                      <option value="GENERAL">GENERAL</option>
                      <option value="LADIES">LADIES</option>
                    </select>
                    <input
                      type="text"
                      value={tatkalTrain}
                      onChange={(e) => setTatkalTrain(e.target.value)}
                      placeholder="Train No (Opt)"
                      className="min-h-[32px] px-2.5 rounded-lg bg-slate-950 border border-slate-700 focus:border-amber-400 focus:outline-none text-xs text-white placeholder:text-slate-500"
                    />
                    <input
                      type="text"
                      value={sessionLoginId}
                      onChange={(e) => setSessionLoginId(e.target.value)}
                      placeholder="IRCTC User ID"
                      className="min-h-[32px] px-2.5 rounded-lg bg-slate-950 border border-slate-700 focus:border-amber-400 focus:outline-none text-xs text-white placeholder:text-slate-500"
                    />
                    <input
                      type="password"
                      value={sessionLoginPw}
                      onChange={(e) => setSessionLoginPw(e.target.value)}
                      placeholder="IRCTC Password"
                      className="min-h-[32px] px-2.5 rounded-lg bg-slate-950 border border-slate-700 focus:border-amber-400 focus:outline-none text-xs text-white placeholder:text-slate-500"
                    />
                  </div>
                  <div className="space-y-1.5">
                    {tatkalPassengers.map((pax, idx) => (
                      <div key={idx} className="grid grid-cols-2 sm:grid-cols-12 gap-1.5 items-center">
                        <input
                          type="text"
                          value={pax.name}
                          onChange={(e) => {
                            const val = e.target.value;
                            setTatkalPassengers((prev) =>
                              prev.map((row, i) => (i === idx ? { ...row, name: val } : row))
                            );
                          }}
                          placeholder={
                            idx === 0 && !zeroSave && profile.fullName
                              ? `Passenger 1: ${profile.fullName}`
                              : `Passenger ${idx + 1} Name (RAM)`
                          }
                          className="sm:col-span-4 min-h-[32px] px-2.5 rounded-lg bg-slate-950 border border-slate-700 focus:border-amber-400 focus:outline-none text-xs text-white placeholder:text-slate-400"
                        />
                        <input
                          type="text"
                          value={pax.age}
                          onChange={(e) => {
                            const val = e.target.value.replace(/\D/g, '').slice(0, 3);
                            setTatkalPassengers((prev) =>
                              prev.map((row, i) => (i === idx ? { ...row, age: val } : row))
                            );
                          }}
                          placeholder="Age (e.g. 26)"
                          className="sm:col-span-2 min-h-[32px] px-2.5 rounded-lg bg-slate-950 border border-slate-700 focus:border-amber-400 focus:outline-none text-xs text-white placeholder:text-slate-400"
                        />
                        <select
                          value={pax.gender}
                          onChange={(e) => {
                            const val = e.target.value;
                            setTatkalPassengers((prev) =>
                              prev.map((row, i) => (i === idx ? { ...row, gender: val } : row))
                            );
                          }}
                          className="sm:col-span-2 min-h-[32px] px-2 rounded-lg bg-slate-950 border border-slate-700 focus:border-amber-400 focus:outline-none text-xs text-white"
                        >
                          <option value="">
                            Gender ({idx === 0 && !zeroSave && profile.gender ? profile.gender : 'Select'})
                          </option>
                          <option value="Male">Male</option>
                          <option value="Female">Female</option>
                          <option value="Transgender">Other</option>
                        </select>
                        <select
                          value={pax.berth}
                          onChange={(e) => {
                            const val = e.target.value;
                            setTatkalPassengers((prev) =>
                              prev.map((row, i) => (i === idx ? { ...row, berth: val } : row))
                            );
                          }}
                          className="sm:col-span-3 min-h-[32px] px-2 rounded-lg bg-slate-950 border border-slate-700 focus:border-amber-400 focus:outline-none text-xs text-white"
                        >
                          <option value="">Berth (No Pref)</option>
                          <option value="LOWER">Lower</option>
                          <option value="MIDDLE">Middle</option>
                          <option value="UPPER">Upper</option>
                          <option value="SIDE LOWER">Side Lower</option>
                          <option value="SIDE UPPER">Side Upper</option>
                          <option value="WINDOW SIDE">Window Side</option>
                        </select>
                        <div className="sm:col-span-1 flex justify-end">
                          {idx > 0 ? (
                            <button
                              type="button"
                              aria-label={`Remove passenger ${idx + 1}`}
                              onClick={() =>
                                setTatkalPassengers((prev) => prev.filter((_, i) => i !== idx))
                              }
                              className="min-h-[32px] w-full sm:w-8 rounded-lg bg-slate-800 hover:bg-rose-900/70 text-rose-300 flex items-center justify-center"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          ) : (
                            <button
                              type="button"
                              disabled={tatkalPassengers.length >= 4}
                              onClick={() =>
                                setTatkalPassengers((prev) =>
                                  prev.length < 4
                                    ? [...prev, { name: '', age: '', gender: '', berth: '' }]
                                    : prev
                                )
                              }
                              title="Add another passenger (Tatkal max 4)"
                              className="min-h-[32px] w-full sm:w-8 rounded-lg bg-amber-500/20 hover:bg-amber-500/35 border border-amber-400/40 text-amber-200 disabled:opacity-40 flex items-center justify-center"
                            >
                              <Plus className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                    <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
                      <div className="flex items-center gap-2">
                        <input
                          type="tel"
                          value={tatkalMobile}
                          onChange={(e) => setTatkalMobile(e.target.value.replace(/\D/g, '').slice(0, 10))}
                          placeholder={(!zeroSave && profile.mobile) ? `Mobile: ${profile.mobile}` : 'Ticket SMS Mobile (10-digit)'}
                          className="min-h-[30px] w-48 px-2.5 rounded-lg bg-slate-950 border border-slate-700 focus:border-amber-400 focus:outline-none text-[11px] font-mono text-white placeholder:text-slate-400"
                        />
                        {tatkalPassengers.length < 4 && (
                          <button
                            type="button"
                            onClick={() =>
                              setTatkalPassengers((prev) => [
                                ...prev,
                                { name: '', age: '', gender: '', berth: '' },
                              ])
                            }
                            className="min-h-[30px] px-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-amber-300 text-[11px] font-semibold inline-flex items-center gap-1 whitespace-nowrap"
                          >
                            <Plus className="w-3 h-3" />
                            Add Passenger ({tatkalPassengers.length}/4)
                          </button>
                        )}
                      </div>
                      <span className="text-[11px] text-slate-300">
                        RAM-only · BHIM/UPI &amp; Insurance auto · Stops only at CAPTCHA/OTP/Pay
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Ultra-Intelligent AI Form Guide & Document Inspector Panel */}
          {formGuideOpen && activeAnalysis && (
            <div className="p-4 bg-violet-50/95 border-b border-violet-200 space-y-3 text-slate-900 max-h-[340px] overflow-y-auto">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-[11px] font-bold text-violet-700 inline-flex items-center gap-1.5">
                    <FileSearch className="w-3.5 h-3.5" />
                    AI Form Guide · Live Screen Analyzed
                  </div>
                  <h3 className="text-sm font-bold text-slate-900 mt-0.5">
                    {activeAnalysis.formTitle}
                  </h3>
                  <p className="text-xs text-slate-700 mt-0.5">{activeAnalysis.summary}</p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    disabled={instantFilling}
                    onClick={() => void runInstantAutoFill()}
                    className="min-h-[32px] px-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold inline-flex items-center gap-1 whitespace-nowrap"
                  >
                    <Zap className="w-3.5 h-3.5" />
                    Auto-Fill Now
                  </button>
                  <button
                    type="button"
                    onClick={() => setFormGuideOpen(false)}
                    aria-label="Close AI Form Guide"
                    className="min-h-[32px] min-w-[32px] rounded-lg bg-white border border-violet-200 text-slate-600 hover:text-slate-900 flex items-center justify-center"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 text-xs">
                <div className="p-3 rounded-xl bg-white border border-violet-200/80 space-y-1.5">
                  <div className="font-bold text-slate-900">
                    Kaise Bharna Hai (Step-by-Step Guide)
                  </div>
                  <ol className="list-decimal pl-4 space-y-1 text-slate-700">
                    {activeAnalysis.howToFillSteps.map((step, idx) => (
                      <li key={idx}>{step}</li>
                    ))}
                  </ol>
                  <div className="pt-1.5 border-t border-slate-100 text-[11px] text-amber-900 font-medium">
                    Fee &amp; Timing: {activeAnalysis.feeAndDeadline}
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-white border border-violet-200/80 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-slate-900">
                      Kya Document &amp; Size Lagega
                    </span>
                    <button
                      type="button"
                      disabled={popupUploadingOcr}
                      onClick={() => popupOcrRef.current?.click()}
                      className="px-2.5 py-1 rounded-lg bg-[#0B1120] text-white text-[11px] font-semibold inline-flex items-center gap-1"
                    >
                      <Upload className="w-3 h-3" />
                      Scan Doc (OCR)
                    </button>
                  </div>
                  {activeAnalysis.requiredDocuments.length > 0 ? (
                    <div className="space-y-1.5">
                      {activeAnalysis.requiredDocuments.map((doc, idx) => (
                        <div
                          key={idx}
                          className="p-2 rounded-lg bg-slate-50 border border-slate-200/80"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-semibold text-slate-900">{doc.name}</span>
                            <span className="text-[10px] font-mono text-violet-700 bg-violet-100 px-1.5 py-0.5 rounded">
                              {doc.spec}
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-600 mt-0.5">{doc.whyNeeded}</div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[11px] text-slate-500">
                      Is screen par abhi koi file upload document list nahi dikha.
                    </p>
                  )}

                  {(activeAnalysis.missingFromUser.length > 0 || activeAnalysis.humanOnlySteps.length > 0) && (
                    <div className="pt-1 border-t border-slate-100 space-y-1 text-[11px]">
                      {activeAnalysis.missingFromUser.length > 0 && (
                        <div className="text-rose-700">
                          <strong>Missing Details:</strong> {activeAnalysis.missingFromUser.join(', ')}
                        </div>
                      )}
                      {activeAnalysis.humanOnlySteps.length > 0 && (
                        <div className="text-amber-800">
                          <strong>Aapko Khud Karna Hoga:</strong> {activeAnalysis.humanOnlySteps.join(', ')}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Missing Details Re-Open Strip (if user skipped modal earlier) */}
          {missingFields.length > 0 && !missingPopupOpen && (
            <div className="px-4 py-2 bg-sky-50 border-b border-sky-200 flex items-center justify-between gap-2 text-xs">
              <span className="text-sky-950 font-medium">
                {missingFields.length} form detail(s) abhi khaali hain — AI ko batayein.
              </span>
              <button
                type="button"
                onClick={() => setMissingPopupOpen(true)}
                className="min-h-[30px] px-3 rounded-lg bg-[#0B1120] hover:bg-slate-800 text-white font-semibold text-xs whitespace-nowrap shrink-0"
              >
                Enter Missing Details
              </button>
            </div>
          )}

          {/* Contextual Alert: Human CAPTCHA/OTP/Payment or Requested Documents */}
          {status.waitingForHuman && status.humanPrompt && missingFields.length === 0 && (
            <div className="px-4 py-2.5 bg-amber-50 border-b border-amber-200 text-xs text-amber-950 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <ShieldAlert className="w-4 h-4 text-amber-700 shrink-0" />
                  <span className="font-semibold">{status.humanPrompt}</span>
                </div>
                {latestDoc && onUpdateEphemeralDocField && !isIrctcActive && (
                  <div className="flex items-center gap-1.5 shrink-0">
                    <label className="text-[11px] font-semibold text-amber-900">State:</label>
                    <select
                      value={currentStateField?.value || ''}
                      onChange={(e) =>
                        onUpdateEphemeralDocField(latestDoc.id, 'state', 'State', e.target.value)
                      }
                      className="min-h-[30px] px-2 rounded-lg bg-white border border-amber-300 text-xs text-slate-900"
                    >
                      <option value="">Select State</option>
                      {INDIAN_STATES_AND_UTS.map((st) => (
                        <option key={st} value={st}>
                          {st}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              {status.tatkalStage !== 'payment' &&
                (!status.requestedDocuments || status.requestedDocuments.length === 0) && (
                  <form onSubmit={handleSubmitHumanQuick} className="flex flex-wrap items-center gap-2">
                    <input
                      type="text"
                      value={humanQuickInput}
                      onChange={(e) => setHumanQuickInput(e.target.value)}
                      placeholder="Screen par dikha CAPTCHA ya OTP yahan type karein..."
                      className="flex-1 min-w-[180px] min-h-[34px] px-3 rounded-lg bg-white border border-amber-300 focus:border-slate-900 focus:outline-none text-xs font-mono text-slate-900 placeholder:text-slate-400"
                    />
                    <button
                      type="submit"
                      disabled={submittingHumanQuick}
                      className="min-h-[34px] px-3.5 rounded-lg bg-[#0B1120] hover:bg-slate-800 disabled:opacity-50 text-white font-semibold text-xs inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
                    >
                      {submittingHumanQuick ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Zap className="w-3.5 h-3.5 text-emerald-400" />
                      )}
                      {humanQuickInput.trim() ? 'Send CAPTCHA/OTP & Resume AI' : 'Resume Fast AI'}
                    </button>
                  </form>
                )}

              {status.requestedDocuments && status.requestedDocuments.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {status.requestedDocuments.map((docReq) => {
                    const done = uploadedReqMap[docReq.id];
                    const busy = uploadingReqId === docReq.id;
                    return (
                      <div
                        key={docReq.id}
                        className="p-2 rounded-lg bg-white border border-amber-200 flex items-center justify-between gap-2"
                      >
                        <div className="min-w-0">
                          <div className="text-xs font-bold text-slate-900 truncate">{docReq.name}</div>
                          <div className="text-[11px] text-slate-600 truncate">{docReq.reason}</div>
                        </div>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            pendingDocReqRef.current = docReq.id;
                            docFileRef.current?.click();
                          }}
                          className="min-h-[32px] px-3 rounded-lg bg-[#0B1120] hover:bg-slate-800 text-white font-semibold text-xs inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
                        >
                          {busy ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : done ? (
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                          ) : (
                            <Upload className="w-3.5 h-3.5" />
                          )}
                          {busy ? 'Scanning' : done ? 'Scanned' : 'Upload'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {error && (
            <div className="px-4 py-2 bg-rose-50 border-b border-rose-200 text-xs text-rose-700">
              {error}
            </div>
          )}

          {/* Live Browser Viewport — Expands to fill available space cleanly */}
          <div
            onWheel={handleViewportWheel}
            className={`relative flex-1 bg-slate-950 w-full flex items-center justify-center select-none overflow-hidden ${
              frameSrc ? 'min-h-[240px] sm:min-h-[440px]' : 'min-h-[360px] sm:min-h-[460px]'
            }`}
          >
            {frameSrc ? (
              <div
                className={`relative w-full flex items-center justify-center ${
                  isDesktopViewport
                    ? 'aspect-[1366/820] max-h-[76vh]'
                    : 'max-w-[420px] mx-auto aspect-[412/820] border-x border-slate-800'
                }`}
              >
                <img
                  ref={imgRef}
                  src={frameSrc}
                  alt={status.title || 'Live Browser View'}
                  onClick={handleViewportClick}
                  draggable={false}
                  className="w-full h-full object-contain cursor-pointer touch-manipulation"
                />
                {clickMarker && (
                  <span
                    className="pointer-events-none absolute w-6 h-6 -ml-3 -mt-3 rounded-full border-2 border-emerald-400 bg-emerald-400/30 animate-ping"
                    style={{ left: `${clickMarker.xPct}%`, top: `${clickMarker.yPct}%` }}
                  />
                )}
              </div>
            ) : (
              <div className="w-full px-5 py-10 flex flex-col items-center justify-center text-center space-y-4 text-white">
                <div className="w-12 h-12 rounded-2xl bg-slate-800 border border-slate-700 flex items-center justify-center">
                  <Monitor className="w-6 h-6 text-sky-400" />
                </div>
                <div className="max-w-lg space-y-1.5">
                  <h2 className="text-base font-bold font-display text-white">
                    Desktop Direct Browser (1366×820)
                  </h2>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    {serverOfflineMode
                      ? 'Standalone mode me seedha device browser me kholein, ya server connect karke AI Auto-Apply chalayein.'
                      : 'Website kholte hi AI khud Apply button click karke form kholega, details auto-fill karega, aur bachi hui details Popup me puchhega.'}
                  </p>
                </div>

                <div className="flex flex-wrap items-center justify-center gap-2 max-w-xl">
                  {QUICK_MISSIONS.map((m) => (
                    <button
                      key={m.label}
                      type="button"
                      onClick={() => {
                        setAddressInput(m.url);
                        setAgentGoal(m.goal);
                        void navigateTo(m.url).then(() => runInstantAutoFill(m.url));
                      }}
                      className="min-h-[34px] px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-xs font-medium text-slate-200 whitespace-nowrap transition-colors"
                    >
                      {m.label}
                    </button>
                  ))}
                </div>

                <div className="flex flex-wrap items-center justify-center gap-2.5 pt-1">
                  {nativeApkMode && (
                    <button
                      type="button"
                      onClick={() =>
                        launchNativeControlledPortal({
                          url: addressInput,
                          profile,
                          ephemeralDocs,
                          zeroSave,
                          goal: agentGoal,
                        })
                      }
                      className="min-h-[42px] px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
                    >
                      <Bot className="w-4 h-4" />
                      Open APK AI WebView
                    </button>
                  )}
                  {!serverOfflineMode && (
                    <button
                      type="button"
                      onClick={() => void navigateTo(addressInput).then(() => runInstantAutoFill(addressInput))}
                      className="min-h-[42px] px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors"
                    >
                      <Compass className="w-4 h-4" />
                      Open Website &amp; Auto-Fill
                    </button>
                  )}
                  <a
                    href={addressInput}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="min-h-[42px] px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white font-semibold text-xs inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors"
                  >
                    <ExternalLink className="w-4 h-4" />
                    Device Tab
                  </a>
                </div>
              </div>
            )}

            {/* Cloud-IP Blocked / Unreachable Website Fallback Overlay */}
            {status.blockedReason && !dismissedBlockedBanner && (
              <div className="absolute inset-0 z-20 bg-slate-950/85 backdrop-blur-xs flex items-center justify-center p-4">
                <div className="bg-white border border-slate-200 rounded-2xl max-w-md w-full p-5 space-y-3.5 text-left shadow-2xl">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 text-amber-700">
                      <ShieldAlert className="w-5 h-5 shrink-0" />
                      <h3 className="text-sm font-bold text-slate-900">
                        Cloud Server Par Yeh Website Block Hai
                      </h3>
                    </div>
                    <button
                      type="button"
                      onClick={() => setDismissedBlockedBanner(true)}
                      aria-label="Close blocked alert"
                      className="p-1 text-slate-400 hover:text-slate-800"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  <p className="text-xs text-slate-700 leading-relaxed">
                    {status.blockedReason}
                  </p>
                  <p className="text-[11px] text-slate-500 leading-relaxed">
                    Kuch govt/ticket portals (jaise IRCTC, Protean PAN, Army) Cloud IP block karte hain lekin aapke Phone ke Native App / Device Browser me seedha khul jaate hain.
                  </p>

                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    {nativeApkMode && (
                      <button
                        type="button"
                        onClick={() =>
                          launchNativeControlledPortal({
                            url:
                              status.url && !status.url.startsWith('chrome-error://') && status.url !== 'about:blank'
                                ? status.url
                                : addressInput,
                            profile,
                            ephemeralDocs,
                            zeroSave,
                            goal: agentGoal,
                          })
                        }
                        className="min-h-[40px] px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs inline-flex items-center gap-1.5 whitespace-nowrap"
                      >
                        <Bot className="w-4 h-4" />
                        Open in Phone AI WebView
                      </button>
                    )}

                    <a
                      href={
                        status.url && !status.url.startsWith('chrome-error://') && status.url !== 'about:blank'
                          ? status.url
                          : addressInput
                      }
                      target="_blank"
                      rel="noopener noreferrer"
                      className="min-h-[40px] px-4 rounded-xl bg-[#0B1120] hover:bg-slate-800 text-white font-semibold text-xs inline-flex items-center gap-1.5 whitespace-nowrap"
                    >
                      <ExternalLink className="w-4 h-4" />
                      Open in Phone Browser
                    </a>

                    {/pan|nsdl|protean/i.test(addressInput) && (
                      <button
                        type="button"
                        onClick={() => {
                          const alt = 'https://eportal.incometax.gov.in/iec/foservices/#/pre-login/instant-e-pan';
                          setDismissedBlockedBanner(true);
                          void navigateTo(alt);
                        }}
                        className="min-h-[40px] px-3.5 rounded-xl bg-sky-50 border border-sky-200 hover:border-sky-400 text-sky-900 font-semibold text-xs whitespace-nowrap"
                      >
                        Try Instant e-PAN
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}

            {(status.agentRunning || instantFilling) && (
              <div className="absolute top-3 left-3 px-3 py-1.5 rounded-lg bg-slate-950/90 border border-emerald-500/40 text-xs text-emerald-300 inline-flex items-center gap-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                {status.agentStatus || 'Scanning & clicking Apply...'}
              </div>
            )}
          </div>

          {/* Slim Bottom Keyboard & Scroll Bar */}
          <div className="px-2.5 sm:px-3 py-2 border-t border-slate-200 bg-slate-50 flex flex-wrap items-center gap-2">
            <form onSubmit={handleTypeSubmit} className="flex-1 min-w-[180px] flex items-center gap-1.5">
              <div className="relative flex-1">
                <Keyboard className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={typeBox}
                  onChange={(e) => setTypeBox(e.target.value)}
                  placeholder="Screen box click karke CAPTCHA / OTP / text type karein..."
                  className="w-full min-h-[36px] pl-9 pr-3 rounded-lg bg-white border border-slate-200 focus:border-slate-900 focus:outline-none text-xs text-slate-900 placeholder:text-slate-400"
                />
              </div>
              <button
                type="submit"
                disabled={!typeBox}
                className="min-h-[36px] px-3.5 rounded-lg bg-[#0B1120] hover:bg-slate-800 disabled:opacity-40 text-white font-semibold text-xs whitespace-nowrap shrink-0"
              >
                Type
              </button>
            </form>

            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={() => sendWs({ type: 'key', key: 'Enter' })}
                className="min-h-[36px] px-2.5 rounded-lg bg-white border border-slate-200 text-xs font-semibold text-slate-700 hover:border-slate-400 whitespace-nowrap"
              >
                Enter
              </button>
              <button
                type="button"
                onClick={() => sendWs({ type: 'key', key: 'Tab' })}
                className="min-h-[36px] px-2.5 rounded-lg bg-white border border-slate-200 text-xs font-semibold text-slate-700 hover:border-slate-400 whitespace-nowrap"
              >
                Tab
              </button>
              <button
                type="button"
                onClick={() => sendWs({ type: 'scroll', deltaY: -420 })}
                aria-label="Scroll up"
                className="min-h-[36px] min-w-[36px] rounded-lg bg-white border border-slate-200 text-slate-700 hover:border-slate-400 flex items-center justify-center"
              >
                <ArrowUp className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => sendWs({ type: 'scroll', deltaY: 420 })}
                aria-label="Scroll down"
                className="min-h-[36px] min-w-[36px] rounded-lg bg-white border border-slate-200 text-slate-700 hover:border-slate-400 flex items-center justify-center"
              >
                <ArrowDown className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* Collapsible Side Drawer: AI Copilot Controls + 1-Tap Fill + Step Logs */}
        {showCopilotDrawer && (
          <aside className="xl:col-span-4 space-y-3">
            <div className="bg-white border border-slate-200/90 rounded-2xl p-4 space-y-3 shadow-xs">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Bot className="w-4 h-4 text-rose-600" />
                  <h3 className="text-sm font-bold text-slate-900">AI Form Copilot</h3>
                </div>
                <span className="text-[11px] text-slate-500 truncate max-w-[160px]">
                  {status.agentStatus}
                </span>
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void startLiveAgent();
                }}
                className="space-y-2"
              >
                <textarea
                  rows={2}
                  value={agentGoal}
                  onChange={(e) => setAgentGoal(e.target.value)}
                  placeholder="AI ko task bolein: e.g. 'Apply click karke State select karo aur form bharo'"
                  className="w-full p-2.5 rounded-xl bg-slate-50 border border-slate-200 focus:border-slate-900 focus:bg-white focus:outline-none text-xs text-slate-900 placeholder:text-slate-400 resize-none"
                />
                <button
                  type="submit"
                  disabled={status.agentRunning}
                  className="w-full min-h-[38px] px-3.5 rounded-lg bg-[#0B1120] hover:bg-slate-800 disabled:opacity-50 text-white font-semibold text-xs inline-flex items-center justify-center gap-1.5 whitespace-nowrap"
                >
                  <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
                  {status.waitingForHuman ? 'Resume AI' : 'Run AI Apply & Fill'}
                </button>
              </form>

              {/* Quick RAM-Only Session Login ID & Password so AI fills passwords automatically */}
              <div className="pt-2 border-t border-slate-100 space-y-1.5">
                <div className="text-[11px] font-bold text-slate-800">
                  Session Login Credentials (RAM-Only · Auto-Fill Password)
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  <input
                    type="text"
                    value={sessionLoginId}
                    onChange={(e) => setSessionLoginId(e.target.value)}
                    placeholder="User ID / Username"
                    className="min-h-[34px] px-2.5 rounded-lg bg-slate-50 border border-slate-200 focus:border-slate-900 focus:bg-white focus:outline-none text-xs text-slate-900"
                  />
                  <input
                    type="password"
                    value={sessionLoginPw}
                    onChange={(e) => setSessionLoginPw(e.target.value)}
                    placeholder="Password"
                    className="min-h-[34px] px-2.5 rounded-lg bg-slate-50 border border-slate-200 focus:border-slate-900 focus:bg-white focus:outline-none text-xs text-slate-900"
                  />
                </div>
                {(sessionLoginId.trim() || sessionLoginPw.trim()) && (
                  <button
                    type="button"
                    onClick={() => void applySessionCredentialsAndFill()}
                    className="w-full min-h-[32px] px-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold"
                  >
                    Type Login ID &amp; Password into Page
                  </button>
                )}
              </div>
            </div>

            {/* 1-Tap Quick Fill Values */}
            <div className="bg-white border border-slate-200/90 rounded-2xl p-4 space-y-2.5 max-h-[320px] overflow-y-auto shadow-xs">
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  1-Tap Type / Copy ({zeroSave ? 'RAM Only' : 'OCR + Vault'})
                </h3>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Website box click karke &ldquo;Type&rdquo; dabayein.
                </p>
              </div>

              {activeDraft && activeDraft.fields.some((f) => f.value.trim()) && (
                <div className="space-y-1.5 pb-2 border-b border-slate-200">
                  <div className="text-[11px] font-bold text-emerald-700 truncate">
                    Draft: {activeDraft.title}
                  </div>
                  {activeDraft.fields
                    .filter((f) => f.value.trim())
                    .slice(0, 6)
                    .map((f) => (
                      <div
                        key={f.key}
                        className="p-2 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-between gap-2"
                      >
                        <div className="min-w-0">
                          <div className="text-[10px] text-slate-500 truncate">{f.label}</div>
                          <div className="text-xs font-medium text-slate-900 truncate">{f.value}</div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => sendTypedText(f.value)}
                            className="px-2 py-1 rounded-md bg-emerald-50 border border-emerald-300 text-[11px] font-semibold text-emerald-800 hover:bg-emerald-100"
                          >
                            Type
                          </button>
                          <button
                            type="button"
                            onClick={() => copyVal(`d-${f.key}`, f.value)}
                            className="p-1.5 text-slate-500 hover:text-slate-900"
                          >
                            {copiedKey === `d-${f.key}` ? (
                              <Check className="w-3.5 h-3.5 text-emerald-600" />
                            ) : (
                              <Copy className="w-3.5 h-3.5" />
                            )}
                          </button>
                        </div>
                      </div>
                    ))}
                </div>
              )}

              {quickFillEntries.length === 0 ? (
                <p className="text-xs text-slate-500 py-1">
                  Document scan karne par sabhi OCR fields yahan 1-tap Type ke liye milenge.
                </p>
              ) : (
                <div className="space-y-1.5">
                  {quickFillEntries.map((item) => (
                    <div
                      key={item.key}
                      className="p-2 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-between gap-2"
                    >
                      <div className="min-w-0">
                        <div className="text-[10px] text-slate-500 truncate">
                          {item.label} · {item.source}
                        </div>
                        <div className="text-xs font-medium text-slate-900 truncate">{item.value}</div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => sendTypedText(item.value)}
                          className="px-2 py-1 rounded-md bg-sky-50 border border-sky-200 text-[11px] font-semibold text-sky-900 hover:bg-sky-100"
                        >
                          Type
                        </button>
                        <button
                          type="button"
                          onClick={() => copyVal(item.key, item.value)}
                          className="p-1.5 text-slate-500 hover:text-slate-900"
                        >
                          {copiedKey === item.key ? (
                            <Check className="w-3.5 h-3.5 text-emerald-600" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {(nativePortalLogs.length > 0 || status.lastStepLogs.length > 0) && (
              <div className="bg-white border border-slate-200/90 rounded-2xl p-4 space-y-2 shadow-xs">
                <h3 className="text-xs font-bold text-slate-900">AI Step Log</h3>
                <div className="space-y-1 max-h-[160px] overflow-y-auto font-mono text-[11px]">
                  {[...nativePortalLogs, ...status.lastStepLogs].map((log, i) => (
                    <div
                      key={i}
                      className="p-2 rounded-lg bg-slate-50 border border-slate-200 text-slate-700"
                    >
                      {log}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </aside>
        )}
      </div>

      {/* AI Task ("Kya Karna Hai?") Modal */}
      {intentModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/65 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-white border border-slate-200 rounded-t-3xl sm:rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl">
            <div className="px-5 py-4 bg-[#0B1120] text-white flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 text-xs font-semibold text-amber-400">
                  <Bot className="w-3.5 h-3.5" />
                  Sarthi AI Interactive Guide
                </div>
                <h3 className="text-base font-bold font-display text-white mt-0.5">
                  Is Website / Form Par Aapko Kya Karna Hai?
                </h3>
                <p className="text-[11px] text-slate-300 mt-0.5">
                  Apna task chunein ya likhein — AI button touch karke OCR se details type karega aur baaki popup me puchhega.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIntentModalOpen(false)}
                aria-label="Close task modal"
                className="min-h-[36px] min-w-[36px] rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 flex items-center justify-center shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {AI_INTENT_PRESETS.map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => setAgentGoal(preset.goal)}
                    className={`p-3 rounded-xl border text-left transition-colors ${
                      agentGoal === preset.goal
                        ? 'border-sky-600 bg-sky-50 text-sky-950'
                        : 'border-slate-200 bg-slate-50 hover:border-slate-400 text-slate-800'
                    }`}
                  >
                    <div className="text-xs font-bold">{preset.label}</div>
                    <div className="text-[11px] text-slate-500 mt-0.5 line-clamp-2">
                      {preset.goal}
                    </div>
                  </button>
                ))}
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-slate-800">
                  Custom Nirdesh (Hindi / English):
                </label>
                <textarea
                  rows={2}
                  value={agentGoal}
                  onChange={(e) => setAgentGoal(e.target.value)}
                  placeholder="Jaise: 'New Registration par click karke Bihar state aur mera Aadhar name fill karo'"
                  className="w-full p-3 rounded-xl bg-slate-50 border border-slate-200 focus:border-slate-900 focus:bg-white focus:outline-none text-xs text-slate-900 placeholder:text-slate-400 resize-none"
                />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <button
                  type="button"
                  disabled={popupUploadingOcr}
                  onClick={() => popupOcrRef.current?.click()}
                  className="min-h-[40px] px-3.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-900 text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap"
                >
                  {popupUploadingOcr ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Upload className="w-3.5 h-3.5" />
                  )}
                  Scan Aadhaar/PAN (OCR)
                </button>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setIntentModalOpen(false);
                      void runInstantAutoFill();
                    }}
                    className="min-h-[40px] px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap"
                  >
                    <Zap className="w-3.5 h-3.5" />
                    Auto-Fill Now
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIntentModalOpen(false);
                      void startLiveAgent();
                    }}
                    className="min-h-[40px] px-4 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    Start AI Agent
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Automatic AI Missing Details + Task Helper Popup Modal */}
      {missingPopupOpen && missingFields.length > 0 && (
        <div className="fixed inset-0 z-50 bg-slate-950/65 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4">
          <form
            onSubmit={handleSubmitMissingDetails}
            className="bg-white border border-slate-200 rounded-t-3xl sm:rounded-2xl w-full max-w-xl max-h-[88vh] flex flex-col overflow-hidden shadow-2xl"
          >
            <div className="px-5 py-4 bg-[#0B1120] text-white flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-xs font-semibold text-emerald-400">
                  <Sparkles className="w-3.5 h-3.5" />
                  AI Form Helper · {missingFields.length} Details Needed
                </div>
                <h3 className="text-base font-bold font-display text-white mt-0.5">
                  Kuch Details Nahi Mili — Yahan Batayein
                </h3>
                <p className="text-[11px] text-slate-300 mt-0.5">
                  Jo details OCR/Vault me nahi mili hain woh niche bharein — AI turant real website me type kar dega.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setMissingPopupOpen(false)}
                aria-label="Close popup"
                className="min-h-[36px] min-w-[36px] rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 flex items-center justify-center shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Interactive "Kya Karna Hai?" + Quick OCR Scan */}
            <div className="px-5 py-3 bg-slate-50 border-b border-slate-200 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[11px] font-semibold text-slate-700">
                  Is form me kya karna hai? (Optional instruction):
                </span>
                <button
                  type="button"
                  disabled={popupUploadingOcr}
                  onClick={() => popupOcrRef.current?.click()}
                  className="min-h-[32px] px-3 rounded-lg bg-white border border-slate-300 hover:border-slate-900 text-xs font-semibold text-slate-900 inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
                >
                  {popupUploadingOcr ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Upload className="w-3.5 h-3.5" />
                  )}
                  {popupUploadingOcr ? 'Scanning...' : 'Scan Doc (OCR)'}
                </button>
              </div>
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  value={agentGoal}
                  onChange={(e) => setAgentGoal(e.target.value)}
                  placeholder="Jaise: New Apply karo / Correction form bharo / Next click karo..."
                  className="flex-1 min-h-[34px] px-3 rounded-lg bg-white border border-slate-200 focus:border-slate-900 focus:outline-none text-xs text-slate-900 placeholder:text-slate-400"
                />
                {agentGoal.trim() && (
                  <button
                    type="button"
                    onClick={() => {
                      setMissingPopupOpen(false);
                      void startLiveAgent();
                    }}
                    className="min-h-[34px] px-3 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold whitespace-nowrap shrink-0"
                  >
                    AI Task Chalao
                  </button>
                )}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-3.5">
              {missingFields.map((field) => {
                const useSelect =
                  (field.options && field.options.length > 0) || isStateField(field);
                const selectOpts =
                  field.options && field.options.length > 0
                    ? field.options
                    : INDIAN_STATES_AND_UTS;
                return (
                  <div key={field.id} className="space-y-1">
                    <label className="block text-xs font-semibold text-slate-800">
                      {field.label}
                    </label>
                    {useSelect ? (
                      <select
                        value={missingValues[field.id] || ''}
                        onChange={(e) =>
                          setMissingValues((prev) => ({ ...prev, [field.id]: e.target.value }))
                        }
                        className="w-full min-h-[42px] px-3 rounded-xl bg-slate-50 border border-slate-200 focus:border-slate-900 focus:bg-white focus:outline-none text-sm text-slate-900"
                      >
                        <option value="">-- Select {field.label} --</option>
                        {selectOpts.map((opt, idx) => (
                          <option key={`${opt}-${idx}`} value={opt}>
                            {opt}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <div className="relative">
                        <input
                          type={
                            field.type === 'password' || field.key === 'loginPassword'
                              ? showPwMap[field.id]
                                ? 'text'
                                : 'password'
                              : field.type === 'email'
                              ? 'email'
                              : field.type === 'tel'
                              ? 'tel'
                              : 'text'
                          }
                          value={missingValues[field.id] || ''}
                          onChange={(e) =>
                            setMissingValues((prev) => ({ ...prev, [field.id]: e.target.value }))
                          }
                          placeholder={
                            field.key === 'dob' || field.type === 'date'
                              ? 'DD/MM/YYYY'
                              : field.placeholder || `Enter ${field.label}`
                          }
                          className="w-full min-h-[42px] px-3.5 pr-10 rounded-xl bg-slate-50 border border-slate-200 focus:border-slate-900 focus:bg-white focus:outline-none text-sm text-slate-900 placeholder:text-slate-400"
                        />
                        {(field.type === 'password' || field.key === 'loginPassword') && (
                          <button
                            type="button"
                            onClick={() =>
                              setShowPwMap((prev) => ({ ...prev, [field.id]: !prev[field.id] }))
                            }
                            aria-label={showPwMap[field.id] ? 'Hide password' : 'Show password'}
                            className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-500 hover:text-slate-900"
                          >
                            {showPwMap[field.id] ? (
                              <EyeOff className="w-4 h-4" />
                            ) : (
                              <Eye className="w-4 h-4" />
                            )}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setMissingPopupOpen(false)}
                className="min-h-[42px] px-4 rounded-xl bg-white border border-slate-300 hover:border-slate-500 text-xs font-semibold text-slate-700 whitespace-nowrap"
              >
                Skip for Now
              </button>
              <button
                type="submit"
                disabled={submittingMissing}
                className="min-h-[42px] px-5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold text-xs inline-flex items-center gap-1.5 whitespace-nowrap"
              >
                {submittingMissing ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="w-4 h-4" />
                )}
                Fill Details into Form
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
