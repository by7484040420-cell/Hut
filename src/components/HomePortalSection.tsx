import React, { useMemo, useState } from 'react';
import {
  ArrowRight,
  Bot,
  CheckCircle2,
  Compass,
  FileText,
  IndianRupee,
  Loader2,
  Search,
  ShieldCheck,
  Sparkles,
  Upload,
  X,
} from 'lucide-react';
import type {
  EphemeralDocumentExtract,
  ServiceBrief,
  ServiceCatalogItem,
} from '../types';
import {
  ADMIT_AND_RESULT_ITEMS,
  ALL_SERVICES,
  LATEST_JOBS_ITEMS,
  POPULAR_SERVICE_TILES,
  PRIMARY_GRID_SERVICES,
  buildFallbackServiceBrief,
} from '../lib/serviceCatalog';
import { apiFetchJson } from '../lib/api';
import { runNativeOnDeviceOcr } from '../lib/nativeBrowserBridge';
import { INDIAN_STATES_AND_UTS } from '../lib/indianStates';
import { PWAInstallButton } from './PWAInstallButton';

interface HomePortalSectionProps {
  ephemeralDocs: EphemeralDocumentExtract[];
  zeroSave: boolean;
  onAddEphemeralDoc: (doc: EphemeralDocumentExtract) => void;
  onUpdateEphemeralDocField?: (docId: string, key: string, label: string, value: string) => void;
  onOpenDirectFormBrowser: (directUrl: string, goal: string) => void;
  onOpenAiChat: (prefillPrompt?: string) => void;
  onOpenFormStudio: () => void;
  onOpenDirectory?: () => void;
}

const TINT_CLASSES: Record<ServiceCatalogItem['tint'], string> = {
  blue: 'bg-sky-50 text-sky-700 border-sky-200',
  purple: 'bg-violet-50 text-violet-700 border-violet-200',
  rose: 'bg-rose-50 text-rose-700 border-rose-200',
  emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  indigo: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  amber: 'bg-amber-50 text-amber-700 border-amber-200',
  teal: 'bg-teal-50 text-teal-700 border-teal-200',
};

export const HomePortalSection: React.FC<HomePortalSectionProps> = ({
  ephemeralDocs,
  zeroSave,
  onAddEphemeralDoc,
  onUpdateEphemeralDocField,
  onOpenDirectFormBrowser,
  onOpenAiChat,
  onOpenDirectory,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [loadingBrief, setLoadingBrief] = useState(false);
  const [activeBrief, setActiveBrief] = useState<ServiceBrief | null>(null);
  const [extraNote, setExtraNote] = useState('');
  const [uploadingDocId, setUploadingDocId] = useState<string | null>(null);
  const [uploadedDocsMap, setUploadedDocsMap] = useState<Record<string, string>>({});
  const [sheetError, setSheetError] = useState<string | null>(null);

  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const pendingDocIdRef = React.useRef<string | null>(null);

  const filteredPrimary = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return PRIMARY_GRID_SERVICES;
    return ALL_SERVICES.filter(
      (s) =>
        s.title.toLowerCase().includes(q) ||
        s.subtitle.toLowerCase().includes(q) ||
        s.portalName.toLowerCase().includes(q)
    );
  }, [searchQuery]);

  const openServiceBrief = async (item?: ServiceCatalogItem, customQuery?: string) => {
    const query = customQuery?.trim() || item?.title || '';
    if (!query) return;

    setSheetOpen(true);
    setSheetError(null);
    setExtraNote('');
    setActiveBrief(buildFallbackServiceBrief(query, item || null));
    setLoadingBrief(true);

    try {
      const data = await apiFetchJson<{ brief: ServiceBrief }>('/api/service/brief', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serviceId: item?.id,
          query,
        }),
      });
      if (data.brief) {
        setActiveBrief(data.brief);
      }
    } catch {
      // Keep fallback brief smoothly
    } finally {
      setLoadingBrief(false);
    }
  };

  const handleUploadDoc = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const docId = pendingDocIdRef.current;
    e.target.value = '';
    if (!file || !docId) return;

    setUploadingDocId(docId);
    setSheetError(null);
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
      setUploadedDocsMap((prev) => ({
        ...prev,
        [docId]: `${extracted.documentType} (${extracted.fields.length} fields)`,
      }));
    } catch (err) {
      setSheetError(
        err instanceof Error ? err.message : 'Document OCR scan failed. Please try again.'
      );
    } finally {
      setUploadingDocId(null);
      pendingDocIdRef.current = null;
    }
  };

  const launchDirectFormPage = () => {
    if (!activeBrief) return;
    const goalParts = [activeBrief.directFormGoal];
    if (extraNote.trim()) {
      goalParts.push(`User Extra Details: ${extraNote.trim()}`);
    }
    goalParts.push(
      `Direct URL open karein: ${activeBrief.directFormUrl}. Homepage par mat ruko, seedha form fields fill karo aur CAPTCHA/OTP/Payment par ruko.`
    );
    setSheetOpen(false);
    onOpenDirectFormBrowser(activeBrief.directFormUrl, goalParts.join(' '));
  };

  const latestDoc = ephemeralDocs[0] || null;
  const latestStateVal =
    latestDoc?.fields.find(
      (f) => f.key.toLowerCase() === 'state' || f.label.toLowerCase() === 'state'
    )?.value || '';

  return (
    <div className="space-y-6">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,.pdf"
        onChange={handleUploadDoc}
        className="hidden"
      />

      {/* Search & Instant Direct-Form Trigger */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (searchQuery.trim()) {
            void openServiceBrief(undefined, searchQuery.trim());
          }
        }}
        className="bg-white border border-slate-200/90 rounded-2xl p-3 sm:p-4 shadow-xs flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5"
      >
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Job, SSC GD, PAN Card, Passport, IRCTC Train Ticket, Block Certificate khojein..."
            className="w-full min-h-[44px] pl-10 pr-4 rounded-xl bg-slate-50 border border-slate-200 focus:border-slate-900 focus:bg-white focus:outline-none text-sm text-slate-900 placeholder:text-slate-400"
          />
        </div>
        <button
          type="submit"
          disabled={!searchQuery.trim()}
          className="min-h-[44px] px-5 py-2.5 rounded-xl bg-[#0B1120] hover:bg-slate-800 disabled:opacity-50 text-white font-semibold text-sm inline-flex items-center justify-center gap-2 whitespace-nowrap shrink-0 transition-colors"
        >
          <Sparkles className="w-4 h-4 text-rose-400" />
          Fees &amp; Direct Form
        </button>
      </form>

      {/* Primary Service Grid */}
      <section className="space-y-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-lg font-bold text-slate-900 tracking-tight">
            Sabhi Services — Seedha Form Page Kholne Ke Liye Click Karein
          </h1>
          <div className="flex items-center gap-3 text-xs text-slate-500 shrink-0">
            {onOpenDirectory && (
              <button
                type="button"
                onClick={onOpenDirectory}
                className="font-semibold text-sky-700 hover:text-sky-900 hover:underline whitespace-nowrap"
              >
                85+ Portals Directory →
              </button>
            )}
            <span aria-hidden="true">·</span>
            <span className="whitespace-nowrap">
              Zero-Save {zeroSave ? 'ON' : 'OFF'}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
          {filteredPrimary.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => void openServiceBrief(item)}
              className="group text-left bg-white border border-slate-200/90 hover:border-slate-400 rounded-2xl p-4 shadow-xs transition-all flex flex-col justify-between gap-3.5 min-h-[132px]"
            >
              <span
                className={`w-9 h-9 rounded-xl border flex items-center justify-center font-display font-bold text-sm shrink-0 ${
                  TINT_CLASSES[item.tint]
                }`}
              >
                {item.iconLetter}
              </span>
              <div className="space-y-0.5">
                <div className="text-sm font-semibold text-slate-900 leading-snug line-clamp-1">
                  {item.title}
                </div>
                <div className="text-xs text-slate-500 line-clamp-1">{item.subtitle}</div>
              </div>
              <div className="text-xs font-semibold text-sky-700 group-hover:text-sky-900 whitespace-nowrap">
                {item.actionLabel}
              </div>
            </button>
          ))}
        </div>
      </section>

      {/* Quiet Important Updates Row */}
      <div className="bg-white border border-slate-200/90 rounded-xl px-4 py-2.5 flex items-center gap-3 overflow-x-auto text-xs text-slate-700 shadow-xs">
        <span className="font-bold text-rose-700 whitespace-nowrap shrink-0">
          Direct Apply:
        </span>
        <div className="flex items-center gap-3 whitespace-nowrap">
          {[...LATEST_JOBS_ITEMS.slice(0, 3), PRIMARY_GRID_SERVICES[2]].map((item, idx) => (
            <React.Fragment key={item.id}>
              {idx > 0 && <span className="text-slate-300">·</span>}
              <button
                type="button"
                onClick={() => void openServiceBrief(item)}
                className="hover:text-sky-700 font-medium underline-offset-2 hover:underline"
              >
                {item.title}
              </button>
            </React.Fragment>
          ))}
        </div>
      </div>

      {/* Latest Jobs, Admit Cards & Results Columns */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-stretch">
        <div className="bg-white border border-slate-200/90 rounded-2xl p-4 sm:p-5 space-y-3 shadow-xs">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h2 className="text-sm font-bold text-slate-900">
              Latest Jobs — Direct Application
            </h2>
            <button
              type="button"
              onClick={() =>
                onOpenAiChat(
                  'Mujhe abhi chal rahe sabhi latest sarkari jobs ki fee, last date aur direct apply link batao.'
                )
              }
              className="text-xs font-semibold text-rose-700 hover:underline whitespace-nowrap shrink-0"
            >
              AI se Search Karein →
            </button>
          </div>
          <div className="divide-y divide-slate-100">
            {LATEST_JOBS_ITEMS.map((job) => (
              <button
                key={job.id}
                type="button"
                onClick={() => void openServiceBrief(job)}
                className="w-full text-left py-2.5 min-h-[48px] flex items-center justify-between gap-3 hover:bg-slate-50 px-2 rounded-lg transition-colors"
              >
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-slate-900 truncate">{job.title}</div>
                  <div className="text-xs text-slate-500 truncate">{job.subtitle}</div>
                </div>
                <span className="text-xs font-semibold text-sky-700 whitespace-nowrap shrink-0">
                  Fees &amp; Fill →
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="bg-white border border-slate-200/90 rounded-2xl p-4 sm:p-5 space-y-3 shadow-xs">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h2 className="text-sm font-bold text-slate-900">
              Admit Card, Result &amp; Court Direct
            </h2>
            <button
              type="button"
              onClick={() =>
                onOpenAiChat(
                  'Mujhe Admit Card, Result ya Court case status dekhna hai, help karo.'
                )
              }
              className="text-xs font-semibold text-sky-700 hover:underline whitespace-nowrap shrink-0"
            >
              Ask AI →
            </button>
          </div>
          <div className="divide-y divide-slate-100">
            {ADMIT_AND_RESULT_ITEMS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => void openServiceBrief(item)}
                className="w-full text-left py-2.5 min-h-[48px] flex items-center justify-between gap-3 hover:bg-slate-50 px-2 rounded-lg transition-colors"
              >
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-slate-900 truncate">{item.title}</div>
                  <div className="text-xs text-slate-500 truncate">{item.subtitle}</div>
                </div>
                <span className="text-xs font-semibold text-sky-700 whitespace-nowrap shrink-0">
                  {item.actionLabel}
                </span>
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Dark Navy SarthiAI Assistant Spotlight Banner */}
      <section className="bg-[#0B1120] text-white rounded-2xl p-5 sm:p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-start gap-4">
          <div className="w-11 h-11 rounded-xl bg-rose-600 flex items-center justify-center shrink-0">
            <Bot className="w-6 h-6 text-white" />
          </div>
          <div>
            <h2 className="text-base font-bold text-white">
              SarthiAI Personal Sahayak · Seedha Form Fill Karein
            </h2>
            <p className="text-xs text-slate-300 mt-1 max-w-xl leading-relaxed">
              Kisi bhi service par click karein — AI pehle batayega kitna paisa aur kya document lagega, OCR se State, DOB aur Address nikalega, aur phir Desktop Browser me form auto-fill karega.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => onOpenAiChat()}
          className="min-h-[44px] px-5 py-2.5 rounded-xl bg-white hover:bg-slate-100 text-slate-900 font-bold text-sm inline-flex items-center justify-center gap-2 whitespace-nowrap shrink-0 transition-colors"
        >
          AI se Poochho
          <ArrowRight className="w-4 h-4" />
        </button>
      </section>

      {/* Popular Services Tile Grid */}
      <section className="space-y-3">
        <h2 className="text-base font-bold text-slate-900">
          Lokpriya Sewayein (Popular Direct Services)
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2.5">
          {POPULAR_SERVICE_TILES.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => void openServiceBrief(item)}
              className="min-h-[52px] px-3.5 py-2.5 rounded-xl bg-white border border-slate-200/90 hover:border-slate-400 text-left flex items-center gap-2.5 shadow-xs transition-colors"
            >
              <FileText className="w-4 h-4 text-slate-500 shrink-0" />
              <span className="text-xs font-semibold text-slate-800 line-clamp-2">
                {item.title}
              </span>
            </button>
          ))}
        </div>
      </section>

      {/* Trust Bar & Footer */}
      <footer className="space-y-3 pt-2">
        <div className="bg-[#0B1120] text-slate-200 rounded-xl px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-1.5 font-medium">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              Zero-Save RAM OCR
            </span>
            <span className="text-slate-600">·</span>
            <span>Desktop Chromium Browser (1366×820)</span>
            <span className="text-slate-600">·</span>
            <span>CAPTCHA / OTP / Payment Sirf Aapke Control Me</span>
          </div>
          <PWAInstallButton />
        </div>
        <div className="text-center text-xs text-slate-500 pb-2">
          2026 Sarthi Narad · Independent AI Form Assistant &amp; Direct Desktop Browser
        </div>
      </footer>

      {/* Pre-Flight AI Brief + OCR Upload + State Verification Modal */}
      {sheetOpen && activeBrief && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-white border border-slate-200 rounded-t-3xl sm:rounded-2xl w-full max-w-2xl max-h-[92vh] overflow-y-auto p-5 sm:p-6 space-y-4 text-slate-900 shadow-2xl">
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
              <div className="min-w-0">
                <div className="text-xs font-semibold text-sky-700">
                  {activeBrief.portalName} ·{' '}
                  {loadingBrief
                    ? 'Live AI Check Chal Raha Hai...'
                    : activeBrief.fromLiveAi
                    ? 'Live AI Verified'
                    : 'Verified Direct Guide'}
                </div>
                <h3 className="text-lg font-bold text-slate-900 mt-0.5">
                  {activeBrief.title}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setSheetOpen(false)}
                aria-label="Close"
                className="min-h-[40px] min-w-[40px] rounded-xl border border-slate-200 text-slate-500 hover:text-slate-900 flex items-center justify-center shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 space-y-1">
                <div className="text-xs font-bold text-amber-900 inline-flex items-center gap-1.5">
                  <IndianRupee className="w-3.5 h-3.5" />
                  Kitna Paisa Lagega (Official Fee)
                </div>
                <div className="text-xs text-amber-950 font-medium leading-relaxed">
                  {activeBrief.feeSummary}
                </div>
              </div>
              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-1">
                <div className="text-xs font-bold text-slate-900">Eligibility &amp; Time</div>
                <div className="text-xs text-slate-700 leading-relaxed">
                  {activeBrief.eligibilitySummary} · {activeBrief.processingTime}
                </div>
              </div>
            </div>

            <div className="px-3.5 py-2.5 rounded-xl bg-sky-50 border border-sky-200 text-xs text-sky-900">
              <span className="font-bold">Direct Form URL: </span>
              <span className="font-mono break-all text-[11px]">{activeBrief.directFormUrl}</span>
            </div>

            {/* Required Documents With Inline OCR Upload */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <h4 className="text-sm font-bold text-slate-900">
                  Documents Upload Karein (OCR Details Nikalega)
                </h4>
                {ephemeralDocs.length > 0 && (
                  <span className="text-xs font-semibold text-emerald-700">
                    {ephemeralDocs.length} RAM me scanned
                  </span>
                )}
              </div>

              <div className="space-y-2">
                {activeBrief.requiredDocuments.map((doc) => {
                  const uploadedInfo = uploadedDocsMap[doc.id];
                  const busy = uploadingDocId === doc.id;
                  return (
                    <div
                      key={doc.id}
                      className="p-3 rounded-xl bg-slate-50 border border-slate-200 flex flex-wrap items-center justify-between gap-3"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-bold text-slate-900">{doc.name}</div>
                        <div className="text-[11px] text-slate-600">{doc.reason}</div>
                        {uploadedInfo && (
                          <div className="text-[11px] font-semibold text-emerald-700 mt-0.5">
                            Scanned in RAM: {uploadedInfo}
                          </div>
                        )}
                      </div>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          pendingDocIdRef.current = doc.id;
                          fileInputRef.current?.click();
                        }}
                        className={`min-h-[38px] px-3.5 py-1.5 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
                          uploadedInfo
                            ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                            : 'bg-[#0B1120] hover:bg-slate-800 text-white'
                        }`}
                      >
                        {busy ? (
                          <>
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            Scanning...
                          </>
                        ) : uploadedInfo ? (
                          <>
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            Scanned
                          </>
                        ) : (
                          <>
                            <Upload className="w-3.5 h-3.5" />
                            Upload &amp; OCR
                          </>
                        )}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Live OCR Verification & State / Rajya Picker */}
            {latestDoc && (
              <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-xs font-bold text-emerald-900">
                    OCR Extracted Details ({latestDoc.documentType})
                  </div>
                  {onUpdateEphemeralDocField && (
                    <div className="flex items-center gap-2">
                      <label className="text-[11px] font-bold text-emerald-900 whitespace-nowrap">
                        Rajya / State:
                      </label>
                      <select
                        value={latestStateVal}
                        onChange={(e) =>
                          onUpdateEphemeralDocField(
                            latestDoc.id,
                            'state',
                            'State',
                            e.target.value
                          )
                        }
                        className="min-h-[34px] px-2.5 rounded-lg bg-white border border-emerald-300 text-xs font-semibold text-slate-900 focus:border-slate-900 focus:outline-none"
                      >
                        <option value="">-- Select State / Rajya --</option>
                        {INDIAN_STATES_AND_UTS.map((st) => (
                          <option key={st} value={st}>
                            {st}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[11px]">
                  {latestDoc.fields.slice(0, 9).map((f, idx) => (
                    <div
                      key={`${f.key}-${idx}`}
                      className="px-2.5 py-1.5 rounded-lg bg-white border border-emerald-200/80 min-w-0"
                    >
                      <div className="text-slate-500 truncate">{f.label}</div>
                      <div className="font-semibold text-slate-900 truncate">{f.value}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div>
              <label className="block text-xs font-bold text-slate-800 mb-1">
                Extra Detail (Agar Zarurat Ho — Jaise Gaon Station, Date, ya Post Name)
              </label>
              <input
                type="text"
                value={extraNote}
                onChange={(e) => setExtraNote(e.target.value)}
                placeholder="e.g. New Delhi se Patna 22 Nov Sleeper, ya SSC GD General Male..."
                className="w-full min-h-[42px] px-3.5 rounded-xl bg-slate-50 border border-slate-200 focus:border-slate-900 focus:bg-white focus:outline-none text-xs text-slate-900 placeholder:text-slate-400"
              />
            </div>

            <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-700 space-y-1">
              <div className="font-bold text-slate-900">Kaise Kaam Karega:</div>
              <ol className="list-decimal pl-4 space-y-0.5">
                {activeBrief.formSteps.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ol>
              <div className="pt-1 font-medium text-amber-800">
                Note: {activeBrief.humanCheckNotes}
              </div>
            </div>

            {sheetError && (
              <div className="px-3.5 py-2.5 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700">
                {sheetError}
              </div>
            )}

            <div className="flex flex-col sm:flex-row gap-2.5 pt-1">
              <button
                type="button"
                onClick={launchDirectFormPage}
                className="flex-1 min-h-[46px] px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm inline-flex items-center justify-center gap-2 whitespace-nowrap transition-colors"
              >
                <Compass className="w-4 h-4" />
                Desktop Browser Me Form Kholo
              </button>
              <button
                type="button"
                onClick={() => {
                  setSheetOpen(false);
                  onOpenAiChat(
                    `Mujhe "${activeBrief.title}" karwana hai. Official Fee: ${activeBrief.feeSummary}. Direct URL: ${activeBrief.directFormUrl}. Meri details check karke aage process karo.`
                  );
                }}
                className="min-h-[46px] px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-900 font-semibold text-xs inline-flex items-center justify-center gap-1.5 whitespace-nowrap"
              >
                <Bot className="w-4 h-4" />
                AI Chat
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
