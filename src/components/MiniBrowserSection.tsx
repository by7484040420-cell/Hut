import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Bot,
  Check,
  CheckCircle2,
  Copy,
  Eraser,
  ExternalLink,
  Globe,
  Keyboard,
  Loader2,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Square,
  Trash2,
  Upload,
} from 'lucide-react';
import type {
  ApplicationDraft,
  EphemeralDocumentExtract,
  LiveBrowserStatus,
  PortalBookmark,
  ProfileVault,
} from '../types';
import { apiFetchJson, buildWsUrl } from '../lib/api';

interface MiniBrowserSectionProps {
  initialUrl: string | null;
  initialGoal: string | null;
  onConsumeInitial: () => void;
  bookmarks: PortalBookmark[];
  profile: ProfileVault;
  ephemeralDocs: EphemeralDocumentExtract[];
  zeroSave: boolean;
  activeDraft: ApplicationDraft | null;
  onBookmarksChange: (bookmarks: PortalBookmark[]) => void;
  onAddEphemeralDoc: (doc: EphemeralDocumentExtract) => void;
  onWipeAllSession: () => void;
}

const DEFAULT_STATUS: LiveBrowserStatus = {
  active: false,
  url: 'about:blank',
  title: 'SarthiAI Live Chromium Browser',
  loading: false,
  adBlockEnabled: true,
  blockedAdsCount: 0,
  viewportWidth: 1280,
  viewportHeight: 720,
  agentRunning: false,
  agentStatus: 'Idle',
  waitingForHuman: false,
  humanPrompt: null,
  requestedDocuments: [],
  lastStepLogs: [],
};

const QUICK_MISSIONS = [
  {
    label: 'IRCTC Train Search (Direct)',
    url: 'https://www.irctc.co.in/nget/train-search',
    goal: 'IRCTC Train Search direct page kholo aur mere gaon ke liye train search / ticket fill karo. CAPTCHA aur OTP main dalunga.',
  },
  {
    label: 'PAN Form 49A (Direct)',
    url: 'https://www.onlineservices.nsdl.com/paam/endUserRegisterContact.html',
    goal: 'NSDL PAN Card Form 49A direct page par meri details (Name, DOB, Email, Mobile) fill karo aur CAPTCHA ke liye ruko.',
  },
  {
    label: 'SSC Candidate OTR (Direct)',
    url: 'https://ssc.gov.in/candidate-portal/one-time-registration/home-page',
    goal: 'SSC Candidate One-Time Registration direct form kholo aur meri details fill karo.',
  },
  {
    label: 'Passport Registration (Direct)',
    url: 'https://portal2.passportindia.gov.in/AppOnlineProject/user/RegistrationBaseAction',
    goal: 'Passport Seva User Registration direct form kholo aur details auto-fill karo.',
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
  activeDraft,
  onBookmarksChange,
  onAddEphemeralDoc,
  onWipeAllSession,
}) => {
  const [status, setStatus] = useState<LiveBrowserStatus>(DEFAULT_STATUS);
  const [frameSrc, setFrameSrc] = useState<string | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [addressInput, setAddressInput] = useState(
    'https://www.onlineservices.nsdl.com/paam/endUserRegisterContact.html'
  );
  const [agentGoal, setAgentGoal] = useState('');
  const [typeBox, setTypeBox] = useState('');
  const [clickMarker, setClickMarker] = useState<{ xPct: number; yPct: number } | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [uploadingReqId, setUploadingReqId] = useState<string | null>(null);
  const [uploadedReqMap, setUploadedReqMap] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const docFileRef = useRef<HTMLInputElement | null>(null);
  const pendingDocReqRef = useRef<string | null>(null);

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
    return () => {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      wsRef.current?.close();
    };
  }, []);

  const navigateTo = async (url: string) => {
    setError(null);
    setAddressInput(url);
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
      setError(err instanceof Error ? err.message : 'Navigation failed');
    }
  };

  const startLiveAgent = async (
    goalOverride?: string,
    urlOverride?: string,
    docsOverride?: EphemeralDocumentExtract[]
  ) => {
    const goal = (goalOverride ?? agentGoal).trim();
    if (!goal) return;
    setError(null);
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

  const handleInlineDocFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const reqId = pendingDocReqRef.current;
    e.target.value = '';
    if (!file || !reqId) return;

    setUploadingReqId(reqId);
    setError(null);
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
      const extracted = data.extracted;
      onAddEphemeralDoc(extracted);
      setUploadedReqMap((prev) => ({ ...prev, [reqId]: extracted.fileName }));
      const nextDocs = [extracted, ...ephemeralDocs];
      if (agentGoal.trim()) {
        await startLiveAgent(agentGoal, undefined, nextDocs);
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
      if (initialGoal) {
        setAgentGoal(initialGoal);
        void startLiveAgent(initialGoal, initialUrl || undefined);
      } else if (initialUrl) {
        void navigateTo(initialUrl);
      }
      onConsumeInitial();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialUrl, initialGoal]);

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

  const handleWipeBrowser = async () => {
    setFrameSrc(null);
    try {
      const data = await apiFetchJson<{ status?: LiveBrowserStatus }>(
        '/api/live-browser/wipe',
        { method: 'POST' }
      );
      if (data.status) setStatus(data.status);
    } catch {
      // still wipe local session
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

    const xRatio = (e.clientX - rect.left) / rect.width;
    const yRatio = (e.clientY - rect.top) / rect.height;
    const x = Math.round(xRatio * status.viewportWidth);
    const y = Math.round(yRatio * status.viewportHeight);

    setClickMarker({ xPct: xRatio * 100, yPct: yRatio * 100 });
    setTimeout(() => setClickMarker(null), 600);
    sendWs({ type: 'click', x, y });
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

  return (
    <div className="space-y-4">
      {/* Status & Bookmarks Strip */}
      <div className="bg-white border border-slate-200 rounded-2xl p-3.5 space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs text-slate-600">
            <span className="font-bold text-slate-900">Real Chromium Direct Browser</span> ·{' '}
            <span className={wsConnected ? 'text-emerald-700 font-semibold' : 'text-amber-700 font-semibold'}>
              {wsConnected ? 'Stream Connected' : 'Server Needed / Connecting'}
            </span>{' '}
            · Ad-Blocker{' '}
            <span className="text-emerald-700 font-mono font-semibold tabular-nums">
              {status.adBlockEnabled ? `ON (${status.blockedAdsCount} blocked)` : 'OFF'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={toggleAdBlock}
              className={`min-h-[34px] px-3 rounded-lg border text-xs font-semibold inline-flex items-center gap-1.5 ${
                status.adBlockEnabled
                  ? 'bg-emerald-50 border-emerald-300 text-emerald-800'
                  : 'bg-slate-50 border-slate-300 text-slate-700'
              }`}
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              Ad-Block {status.adBlockEnabled ? 'ON' : 'OFF'}
            </button>
            <button
              type="button"
              onClick={handleWipeBrowser}
              className="min-h-[34px] px-3 rounded-lg bg-rose-50 border border-rose-200 hover:bg-rose-100 text-xs font-semibold text-rose-800 inline-flex items-center gap-1.5"
            >
              <Eraser className="w-3.5 h-3.5" />
              Wipe Session
            </button>
          </div>
        </div>

        <div className="flex gap-2 overflow-x-auto pb-1">
          {bookmarks.map((bm) => (
            <div
              key={bm.id}
              className="shrink-0 flex items-center gap-1 rounded-xl bg-slate-50 border border-slate-200 hover:border-slate-400"
            >
              <button
                type="button"
                onClick={() => navigateTo(bm.url)}
                className="min-h-[36px] px-3 py-1 text-xs font-semibold text-slate-800 hover:text-sky-700 inline-flex items-center gap-1.5"
              >
                <Globe className="w-3.5 h-3.5 text-sky-700" />
                {bm.name}
              </button>
              <button
                type="button"
                onClick={() => deleteBookmark(bm.id)}
                aria-label={`Remove ${bm.name}`}
                className="pr-2 py-1 text-slate-400 hover:text-rose-600"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Live AI + OCR Autopilot Mission Bar */}
      <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Bot className="w-4 h-4 text-rose-600" />
            <span className="text-sm font-bold text-slate-900">
              Live OCR + AI Direct Form Autopilot
            </span>
          </div>
          <span className="text-xs text-slate-600 font-medium">{status.agentStatus}</span>
        </div>

        <div className="flex flex-wrap gap-2">
          {QUICK_MISSIONS.map((m) => (
            <button
              key={m.label}
              type="button"
              disabled={status.agentRunning}
              onClick={() => {
                setAgentGoal(m.goal);
                void startLiveAgent(m.goal, m.url);
              }}
              className="min-h-[36px] px-3 py-1.5 rounded-xl bg-slate-50 border border-slate-200 hover:border-slate-400 text-xs font-semibold text-slate-800 inline-flex items-center gap-1.5 disabled:opacity-50"
            >
              <Sparkles className="w-3.5 h-3.5 text-rose-600" />
              {m.label}
            </button>
          ))}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void startLiveAgent();
          }}
          className="flex flex-wrap gap-2"
        >
          <input
            type="text"
            value={agentGoal}
            onChange={(e) => setAgentGoal(e.target.value)}
            placeholder="AI ko bolein: e.g. 'Direct form fields fill karo, CAPTCHA aur OTP par rukna'..."
            className="flex-1 min-w-[240px] min-h-[42px] px-3.5 rounded-xl bg-slate-50 border border-slate-200 focus:border-slate-900 focus:bg-white focus:outline-none text-xs text-slate-900 placeholder:text-slate-400"
          />
          {status.agentRunning ? (
            <button
              type="button"
              onClick={stopLiveAgent}
              className="min-h-[42px] px-4 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-semibold text-xs inline-flex items-center gap-1.5"
            >
              <Square className="w-3.5 h-3.5" />
              Stop AI
            </button>
          ) : (
            <button
              type="submit"
              disabled={!agentGoal.trim()}
              className="min-h-[42px] px-4 rounded-xl bg-[#0F172A] hover:bg-slate-800 disabled:opacity-50 text-white font-semibold text-xs inline-flex items-center gap-1.5"
            >
              <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
              {status.waitingForHuman ? 'Resume AI' : 'Run Live AI'}
            </button>
          )}
        </form>

        <input
          ref={docFileRef}
          type="file"
          accept="image/*,.pdf"
          onChange={handleInlineDocFile}
          className="hidden"
        />

        {status.waitingForHuman && status.humanPrompt && (
          <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-300 text-xs text-amber-950 space-y-2.5">
            <div className="flex items-start gap-2.5">
              <ShieldAlert className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
              <div>
                <div className="font-bold text-amber-900">
                  {status.requestedDocuments && status.requestedDocuments.length > 0
                    ? 'Is Form Ke Liye Required Documents Upload Karein:'
                    : 'Aapki Baari (CAPTCHA / OTP / Confirmation):'}
                </div>
                <p className="mt-0.5 leading-relaxed">{status.humanPrompt}</p>
              </div>
            </div>

            {status.requestedDocuments && status.requestedDocuments.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                {status.requestedDocuments.map((docReq) => {
                  const done = uploadedReqMap[docReq.id];
                  const busy = uploadingReqId === docReq.id;
                  return (
                    <div
                      key={docReq.id}
                      className="p-2.5 rounded-xl bg-white border border-amber-200 flex items-center justify-between gap-2"
                    >
                      <div className="min-w-0">
                        <div className="text-xs font-bold text-slate-900 truncate">
                          {docReq.name}
                        </div>
                        <div className="text-[11px] text-slate-600 truncate">
                          {docReq.reason}
                        </div>
                      </div>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          pendingDocReqRef.current = docReq.id;
                          docFileRef.current?.click();
                        }}
                        className="min-h-[34px] px-3 rounded-lg bg-[#0F172A] hover:bg-slate-800 text-white font-semibold text-xs inline-flex items-center gap-1.5 shrink-0"
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
          <div className="px-3.5 py-2 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700">
            {error}
          </div>
        )}
      </div>

      {/* Main Live Browser Screen + Side Helper */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        <div className="xl:col-span-8 bg-white border border-slate-200 rounded-2xl overflow-hidden flex flex-col">
          {/* Address Bar */}
          <div className="p-3 border-b border-slate-200 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void apiFetchJson('/api/live-browser/back', { method: 'POST' }).catch(() => {})}
              aria-label="Back"
              className="min-h-[40px] min-w-[40px] rounded-xl bg-slate-50 border border-slate-200 text-slate-700 hover:text-slate-900 flex items-center justify-center"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => void apiFetchJson('/api/live-browser/reload', { method: 'POST' }).catch(() => {})}
              aria-label="Reload"
              className="min-h-[40px] min-w-[40px] rounded-xl bg-slate-50 border border-slate-200 text-slate-700 hover:text-slate-900 flex items-center justify-center"
            >
              <RefreshCw className={`w-4 h-4 ${status.loading ? 'animate-spin text-sky-700' : ''}`} />
            </button>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                void navigateTo(addressInput);
              }}
              className="flex-1 min-w-[180px] flex items-center gap-2"
            >
              <input
                type="text"
                value={addressInput}
                onChange={(e) => setAddressInput(e.target.value)}
                placeholder="https://... direct form URL"
                className="w-full min-h-[40px] px-3.5 rounded-xl bg-slate-50 border border-slate-200 focus:border-slate-900 focus:bg-white focus:outline-none text-xs font-mono text-slate-900"
              />
              <button
                type="submit"
                className="min-h-[40px] px-3.5 rounded-xl bg-[#0F172A] hover:bg-slate-800 text-white font-semibold text-xs shrink-0"
              >
                Open
              </button>
            </form>

            {status.url && status.url !== 'about:blank' && (
              <a
                href={status.url}
                target="_blank"
                rel="noopener noreferrer"
                className="min-h-[40px] px-3 rounded-xl bg-slate-50 border border-slate-200 text-xs font-semibold text-slate-700 hover:text-slate-900 inline-flex items-center gap-1.5"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                External
              </a>
            )}
          </div>

          {/* Live Chromium Stream Viewport */}
          <div className="relative bg-[#0F172A] aspect-video w-full flex items-center justify-center overflow-hidden select-none">
            {frameSrc ? (
              <>
                <img
                  ref={imgRef}
                  src={frameSrc}
                  alt={status.title || 'Live Browser View'}
                  onClick={handleViewportClick}
                  draggable={false}
                  className="w-full h-full object-contain cursor-crosshair"
                />
                {clickMarker && (
                  <span
                    className="pointer-events-none absolute w-6 h-6 -ml-3 -mt-3 rounded-full border-2 border-emerald-400 bg-emerald-400/30 animate-ping"
                    style={{ left: `${clickMarker.xPct}%`, top: `${clickMarker.yPct}%` }}
                  />
                )}
              </>
            ) : (
              <div className="p-8 text-center space-y-3 text-white">
                <Globe className="w-8 h-8 text-sky-400 mx-auto" />
                <p className="text-sm font-semibold">
                  Real Ad-Blocked Chromium Direct Browser Ready
                </p>
                <p className="text-xs text-slate-300 max-w-md mx-auto leading-relaxed">
                  Home page se kisi bhi job/PAN/ticket par click karein ya yahan &ldquo;Launch&rdquo; dabayein — seedha form page live dikhega.
                </p>
                <button
                  type="button"
                  onClick={() => navigateTo(addressInput)}
                  className="min-h-[40px] px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs inline-flex items-center gap-1.5"
                >
                  Launch {addressInput}
                </button>
              </div>
            )}

            {status.agentRunning && (
              <div className="absolute top-3 left-3 px-3 py-1.5 rounded-lg bg-slate-950/90 border border-emerald-500/40 text-xs text-emerald-300 inline-flex items-center gap-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                {status.agentStatus}
              </div>
            )}
          </div>

          {/* Direct Keyboard / CAPTCHA / OTP / Scroll Controls */}
          <div className="p-3 border-t border-slate-200 bg-slate-50 flex flex-wrap items-center gap-2">
            <form onSubmit={handleTypeSubmit} className="flex-1 min-w-[200px] flex items-center gap-2">
              <div className="relative flex-1">
                <Keyboard className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={typeBox}
                  onChange={(e) => setTypeBox(e.target.value)}
                  placeholder="Screen par box click karke yahan CAPTCHA / OTP / text type karein..."
                  className="w-full min-h-[38px] pl-9 pr-3 rounded-xl bg-white border border-slate-200 focus:border-slate-900 focus:outline-none text-xs text-slate-900 placeholder:text-slate-400"
                />
              </div>
              <button
                type="submit"
                disabled={!typeBox}
                className="min-h-[38px] px-3.5 rounded-xl bg-[#0F172A] hover:bg-slate-800 disabled:opacity-40 text-white font-semibold text-xs"
              >
                Type
              </button>
            </form>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => sendWs({ type: 'key', key: 'Enter' })}
                className="min-h-[38px] px-2.5 rounded-lg bg-white border border-slate-200 text-xs font-semibold text-slate-700 hover:border-slate-400"
              >
                Enter
              </button>
              <button
                type="button"
                onClick={() => sendWs({ type: 'key', key: 'Tab' })}
                className="min-h-[38px] px-2.5 rounded-lg bg-white border border-slate-200 text-xs font-semibold text-slate-700 hover:border-slate-400"
              >
                Tab
              </button>
              <button
                type="button"
                onClick={() => sendWs({ type: 'scroll', deltaY: -400 })}
                aria-label="Scroll up"
                className="min-h-[38px] min-w-[38px] rounded-lg bg-white border border-slate-200 text-slate-700 flex items-center justify-center"
              >
                <ArrowUp className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => sendWs({ type: 'scroll', deltaY: 400 })}
                aria-label="Scroll down"
                className="min-h-[38px] min-w-[38px] rounded-lg bg-white border border-slate-200 text-slate-700 flex items-center justify-center"
              >
                <ArrowDown className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* Side Column: Live AI Step Logs + 1-Tap Type into Focused Field */}
        <aside className="xl:col-span-4 space-y-4">
          <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-2.5">
            <h3 className="text-sm font-bold text-slate-900">Live AI Execution Log</h3>
            {status.lastStepLogs.length === 0 ? (
              <p className="text-xs text-slate-500">
                AI autopilot jab chalega tab har step (direct form fill, CAPTCHA pause) yahan dikhega.
              </p>
            ) : (
              <div className="space-y-1.5 max-h-[200px] overflow-y-auto font-mono text-[11px]">
                {status.lastStepLogs.map((log, i) => (
                  <div
                    key={i}
                    className="p-2 rounded-lg bg-slate-50 border border-slate-200 text-slate-700"
                  >
                    {log}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-2.5 max-h-[400px] overflow-y-auto">
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                1-Tap Fill / Copy ({zeroSave ? 'RAM Only' : 'OCR + Vault'})
              </h3>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Live page par input box click karein aur &ldquo;Type&rdquo; dabakar turant fill karein.
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
                      className="p-2 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between gap-2"
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
              <p className="text-xs text-slate-500 py-2">
                {zeroSave
                  ? 'Home screen ya AI Agent me apna document scan karein — details yahan 1-tap Type ke liye ready milengi.'
                  : 'Profile Vault khaali hai ya koi document scan nahi kiya gaya.'}
              </p>
            ) : (
              <div className="space-y-1.5">
                {quickFillEntries.map((item) => (
                  <div
                    key={item.key}
                    className="p-2 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between gap-2"
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
        </aside>
      </div>
    </div>
  );
};
