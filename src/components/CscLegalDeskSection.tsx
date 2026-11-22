import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Briefcase,
  Building2,
  CalendarCheck,
  Check,
  Compass,
  Copy,
  Download,
  ExternalLink,
  FileText,
  Image as ImageIcon,
  Landmark,
  Loader2,
  Printer,
  Scale,
  ShieldAlert,
  Sparkles,
  Upload,
} from 'lucide-react';
import type {
  CscDeskMode,
  CscLegalLandResponse,
  EphemeralDocumentExtract,
  ProfileVault,
} from '../types';
import {
  APPOINTMENT_TYPES,
  COURT_AND_LEGAL_PORTALS,
  COURT_CASE_TYPES,
  LAND_ISSUE_TYPES,
  LAND_REVENUE_PORTALS,
} from '../lib/cscCatalog';
import { INDIAN_STATES_AND_UTS } from '../lib/indianStates';
import { apiFetchJson } from '../lib/api';
import { runNativeOnDeviceOcr } from '../lib/nativeBrowserBridge';

interface CscLegalDeskSectionProps {
  profile: ProfileVault;
  ephemeralDocs: EphemeralDocumentExtract[];
  zeroSave: boolean;
  initialMode?: CscDeskMode | null;
  onConsumeInitialMode?: () => void;
  onAddEphemeralDoc: (doc: EphemeralDocumentExtract) => void;
  onOpenBrowser: (url: string, goal?: string) => void;
}

interface ResizerPreset {
  id: string;
  label: string;
  width: number;
  height: number;
  maxKb: number;
}

const RESIZER_PRESETS: ResizerPreset[] = [
  { id: 'ssc-photo', label: 'Exam / SSC Photo (20–45 KB)', width: 200, height: 230, maxKb: 45 },
  { id: 'ssc-sign', label: 'Signature (10–18 KB)', width: 200, height: 80, maxKb: 18 },
  { id: 'pan-photo', label: 'PAN Photo (213×213px · <28 KB)', width: 213, height: 213, maxKb: 28 },
  { id: 'pan-sign', label: 'PAN Sign (400×200px · <50 KB)', width: 400, height: 200, maxKb: 50 },
  { id: 'passport', label: 'Passport Photo (<95 KB)', width: 413, height: 531, maxKb: 95 },
  { id: 'doc-scan', label: 'Form Document Scan (<190 KB)', width: 1000, height: 1400, maxKb: 190 },
];

function findDocVal(docs: EphemeralDocumentExtract[], keys: string[]): string {
  for (const doc of docs) {
    for (const f of doc.fields || []) {
      const fk = `${f.key} ${f.label}`.toLowerCase();
      if (keys.some((k) => fk.includes(k.toLowerCase())) && f.value?.trim()) {
        return f.value.trim();
      }
    }
  }
  return '';
}

export const CscLegalDeskSection: React.FC<CscLegalDeskSectionProps> = ({
  profile,
  ephemeralDocs,
  zeroSave,
  initialMode,
  onConsumeInitialMode,
  onAddEphemeralDoc,
  onOpenBrowser,
}) => {
  const [mode, setMode] = useState<CscDeskMode>(initialMode || 'land');

  useEffect(() => {
    if (initialMode) {
      setMode(initialMode);
      onConsumeInitialMode?.();
    }
  }, [initialMode, onConsumeInitialMode]);

  // Shared intake state for Land / Court Case / Wakil Appointment
  const [landSubType, setLandSubType] = useState(LAND_ISSUE_TYPES[0].label);
  const [courtSubType, setCourtSubType] = useState(COURT_CASE_TYPES[0].label);
  const [apptSubType, setApptSubType] = useState(APPOINTMENT_TYPES[0].label);

  const [stateVal, setStateVal] = useState(() => (!zeroSave ? profile.state || 'Bihar' : 'Bihar'));
  const [districtVal, setDistrictVal] = useState(() => (!zeroSave ? profile.district || '' : ''));
  const [blockOrCourt, setBlockOrCourt] = useState(() =>
    !zeroSave ? profile.blockOrTehsil || '' : ''
  );
  const [psOrMauza, setPsOrMauza] = useState(() =>
    !zeroSave ? profile.policeStation || profile.villageOrWard || '' : ''
  );
  const [referenceNo, setReferenceNo] = useState('');
  const [applicantName, setApplicantName] = useState(() =>
    !zeroSave ? profile.fullName || '' : ''
  );
  const [oppositeParty, setOppositeParty] = useState('');
  const [factsText, setFactsText] = useState('');
  const [language, setLanguage] = useState<'hindi' | 'hinglish' | 'english'>('hindi');

  const [ocrBusy, setOcrBusy] = useState(false);
  const [ocrMessage, setOcrMessage] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [packet, setPacket] = useState<CscLegalLandResponse | null>(null);
  const [editablePrimaryDraft, setEditablePrimaryDraft] = useState('');
  const [editableSecondaryDraft, setEditableSecondaryDraft] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const ocrInputRef = useRef<HTMLInputElement | null>(null);

  // Sync newly extracted OCR fields cleanly into blank intake fields
  useEffect(() => {
    if (ephemeralDocs.length === 0) return;
    const extState = findDocVal(ephemeralDocs, ['state']);
    const extDist = findDocVal(ephemeralDocs, ['district']);
    const extBlock = findDocVal(ephemeralDocs, ['block', 'tehsil', 'courtname', 'court']);
    const extMauzaPs = findDocVal(ephemeralDocs, ['mauza', 'policestation', 'police', 'village']);
    const extName = findDocVal(ephemeralDocs, ['fullname', 'name']);
    const extRef = findDocVal(ephemeralDocs, [
      'cnrnumber',
      'casenumber',
      'firnumber',
      'khatanumber',
      'khesranumber',
      'jamabandi',
    ]);
    if (extState && !stateVal) setStateVal(extState);
    if (extDist && !districtVal) setDistrictVal(extDist);
    if (extBlock && !blockOrCourt) setBlockOrCourt(extBlock);
    if (extMauzaPs && !psOrMauza) setPsOrMauza(extMauzaPs);
    if (extName && !applicantName) setApplicantName(extName);
    if (extRef && !referenceNo) setReferenceNo(extRef);
  }, [ephemeralDocs, stateVal, districtVal, blockOrCourt, psOrMauza, applicantName, referenceNo]);

  const activeSubType =
    mode === 'land'
      ? landSubType
      : mode === 'court_case'
      ? courtSubType
      : apptSubType;

  const selectedApptPortal = useMemo(() => {
    const found = APPOINTMENT_TYPES.find((a) => a.label === apptSubType);
    if (!found) return COURT_AND_LEGAL_PORTALS[0];
    return (
      COURT_AND_LEGAL_PORTALS.find((p) => p.id === found.portalId) ||
      COURT_AND_LEGAL_PORTALS[0]
    );
  }, [apptSubType]);

  const handleOcrUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setOcrBusy(true);
    setError(null);
    setOcrMessage(null);
    try {
      let extracted: EphemeralDocumentExtract | null = null;
      try {
        const fd = new FormData();
        fd.append('document', file);
        const res = await apiFetchJson<{ extracted: EphemeralDocumentExtract }>('/api/ocr/extract', {
          method: 'POST',
          body: fd,
        });
        extracted = res.extracted;
      } catch (serverErr) {
        const nativeExt = await runNativeOnDeviceOcr(file);
        if (!nativeExt) throw serverErr;
        extracted = nativeExt;
      }
      onAddEphemeralDoc(extracted);
      setOcrMessage(
        `${extracted.documentType} scanned in RAM (${extracted.fields.length} details extracted).`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Document OCR scan failed.');
    } finally {
      setOcrBusy(false);
    }
  };

  const handleGeneratePacket = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === 'resizer' || generating) return;
    setGenerating(true);
    setError(null);
    try {
      const apiMode: 'land' | 'court_case' | 'lawyer_appointment' =
        mode === 'court_case'
          ? 'court_case'
          : mode === 'lawyer_appointment'
          ? 'lawyer_appointment'
          : 'land';
      const data = await apiFetchJson<{ packet: CscLegalLandResponse }>(
        '/api/csc/legal-land-assist',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mode: apiMode,
            subType: activeSubType,
            state: stateVal,
            district: districtVal,
            blockOrCourt,
            policeStationOrMauza: psOrMauza,
            referenceNumber: referenceNo,
            applicantName,
            oppositePartyOrAdvocate: oppositeParty,
            factsOrProblem: factsText,
            language,
            zeroSave,
            ephemeralDocs,
          }),
        }
      );
      setPacket(data.packet);
      setEditablePrimaryDraft(data.packet.primaryDraftText || '');
      setEditableSecondaryDraft(data.packet.secondaryDraftText || '');
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Unable to generate CSC / Legal document packet.'
      );
    } finally {
      setGenerating(false);
    }
  };

  const copyText = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1600);
    } catch {
      // ignore
    }
  };

  const downloadDraftFile = (filename: string, content: string) => {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ---- Cyber Photo / Signature KB Resizer State ----
  const [resizerPresetId, setResizerPresetId] = useState<string>(RESIZER_PRESETS[0].id);
  const [customWidth, setCustomWidth] = useState(200);
  const [customHeight, setCustomHeight] = useState(230);
  const [customMaxKb, setCustomMaxKb] = useState(45);
  const [origFileMeta, setOrigFileMeta] = useState<{
    name: string;
    kb: number;
    width: number;
    height: number;
    dataUrl: string;
  } | null>(null);
  const [resizedOutput, setResizedOutput] = useState<{
    kb: number;
    width: number;
    height: number;
    quality: number;
    dataUrl: string;
  } | null>(null);
  const [resizing, setResizing] = useState(false);
  const photoInputRef = useRef<HTMLInputElement | null>(null);

  const selectPreset = (preset: ResizerPreset) => {
    setResizerPresetId(preset.id);
    setCustomWidth(preset.width);
    setCustomHeight(preset.height);
    setCustomMaxKb(preset.maxKb);
  };

  const compressCanvasToTargetKb = async (
    imgDataUrl: string,
    targetW: number,
    targetH: number,
    maxKb: number
  ) => {
    setResizing(true);
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error('Invalid image file'));
        el.src = imgDataUrl;
      });
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(40, Math.round(targetW));
      canvas.height = Math.max(40, Math.round(targetH));
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas unavailable');
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Cover-fit centered crop so photo/sign fills target box cleanly without distortion
      const scale = Math.max(canvas.width / img.naturalWidth, canvas.height / img.naturalHeight);
      const drawW = img.naturalWidth * scale;
      const drawH = img.naturalHeight * scale;
      const offsetX = (canvas.width - drawW) / 2;
      const offsetY = (canvas.height - drawH) / 2;
      ctx.drawImage(img, offsetX, offsetY, drawW, drawH);

      const toJpegBlob = (q: number) =>
        new Promise<Blob>((resolve, reject) => {
          canvas.toBlob(
            (b) => (b ? resolve(b) : reject(new Error('Blob encode failed'))),
            'image/jpeg',
            q
          );
        });

      let low = 0.12;
      let high = 0.96;
      let bestBlob = await toJpegBlob(0.85);
      let bestQ = 0.85;
      const targetBytes = Math.max(5, maxKb) * 1024;

      if (bestBlob.size > targetBytes) {
        for (let i = 0; i < 9; i++) {
          const mid = (low + high) / 2;
          const candidate = await toJpegBlob(mid);
          if (candidate.size <= targetBytes) {
            bestBlob = candidate;
            bestQ = mid;
            low = mid;
          } else {
            high = mid;
            if (candidate.size < bestBlob.size) {
              bestBlob = candidate;
              bestQ = mid;
            }
          }
        }
      }

      const outDataUrl = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.readAsDataURL(bestBlob);
      });

      setResizedOutput({
        kb: Math.round((bestBlob.size / 1024) * 10) / 10,
        width: canvas.width,
        height: canvas.height,
        quality: Math.round(bestQ * 100),
        dataUrl: outDataUrl,
      });
    } finally {
      setResizing(false);
    }
  };

  const handlePhotoFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('File read failed'));
      reader.readAsDataURL(file);
    });
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Invalid image'));
      el.src = dataUrl;
    });
    setOrigFileMeta({
      name: file.name,
      kb: Math.round((file.size / 1024) * 10) / 10,
      width: img.naturalWidth,
      height: img.naturalHeight,
      dataUrl,
    });
    await compressCanvasToTargetKb(dataUrl, customWidth, customHeight, customMaxKb);
  };

  useEffect(() => {
    if (origFileMeta?.dataUrl) {
      void compressCanvasToTargetKb(origFileMeta.dataUrl, customWidth, customHeight, customMaxKb);
    }
  }, [customWidth, customHeight, customMaxKb, origFileMeta?.dataUrl]);

  const portalList = mode === 'land' ? LAND_REVENUE_PORTALS : COURT_AND_LEGAL_PORTALS;

  return (
    <div className="space-y-5">
      <input
        ref={ocrInputRef}
        type="file"
        accept="image/*,.pdf"
        onChange={handleOcrUpload}
        className="hidden"
      />
      <input
        ref={photoInputRef}
        type="file"
        accept="image/*"
        onChange={(e) => void handlePhotoFileChange(e)}
        className="hidden"
      />

      {/* Header & Interactive Mode Switcher */}
      <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1 max-w-2xl">
            <h1 className="text-lg sm:text-xl font-bold font-display text-slate-900">
              CSC, Jamin &amp; Court Legal Desk
            </h1>
            <p className="text-xs sm:text-sm text-slate-600">
              Jamin (Bhumi / Parimarjan / Mutation), Court Case Documents, Wakil / Tele-Law Appointment, aur Cyber Photo/Signature KB Resizer ek hi desk par.
            </p>
          </div>
          <div className="text-xs text-slate-500 flex items-center gap-2 whitespace-nowrap shrink-0">
            <span>Zero-Save {zeroSave ? 'ON' : 'OFF'}</span>
            <span aria-hidden="true">·</span>
            <span>RAM OCR Docs: {ephemeralDocs.length}</span>
          </div>
        </div>

        {/* Segmented Sub-Desk Control */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 p-1.5 bg-slate-100 rounded-xl border border-slate-200">
          <button
            type="button"
            onClick={() => {
              setMode('land');
              setPacket(null);
            }}
            className={`min-h-[42px] px-3 py-2 rounded-lg text-xs font-semibold inline-flex items-center justify-center gap-2 whitespace-nowrap transition-colors ${
              mode === 'land'
                ? 'bg-[#0B1120] text-white'
                : 'text-slate-700 hover:bg-white'
            }`}
          >
            <Landmark className="w-4 h-4 shrink-0" />
            <span>Jamin / Land Samasya</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('court_case');
              setPacket(null);
            }}
            className={`min-h-[42px] px-3 py-2 rounded-lg text-xs font-semibold inline-flex items-center justify-center gap-2 whitespace-nowrap transition-colors ${
              mode === 'court_case'
                ? 'bg-[#0B1120] text-white'
                : 'text-slate-700 hover:bg-white'
            }`}
          >
            <Scale className="w-4 h-4 shrink-0" />
            <span>Court Case Documents</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('lawyer_appointment');
              setPacket(null);
            }}
            className={`min-h-[42px] px-3 py-2 rounded-lg text-xs font-semibold inline-flex items-center justify-center gap-2 whitespace-nowrap transition-colors ${
              mode === 'lawyer_appointment'
                ? 'bg-[#0B1120] text-white'
                : 'text-slate-700 hover:bg-white'
            }`}
          >
            <CalendarCheck className="w-4 h-4 shrink-0" />
            <span>Wakil / Court Booking</span>
          </button>
          <button
            type="button"
            onClick={() => setMode('resizer')}
            className={`min-h-[42px] px-3 py-2 rounded-lg text-xs font-semibold inline-flex items-center justify-center gap-2 whitespace-nowrap transition-colors ${
              mode === 'resizer'
                ? 'bg-[#0B1120] text-white'
                : 'text-slate-700 hover:bg-white'
            }`}
          >
            <ImageIcon className="w-4 h-4 shrink-0" />
            <span>Photo / Sign KB Resizer</span>
          </button>
        </div>
      </div>

      {/* DESK 4: CYBER PHOTO & SIGNATURE KB RESIZER */}
      {mode === 'resizer' ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          <div className="lg:col-span-5 bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
            <div>
              <h2 className="text-base font-bold text-slate-900">
                Cyber Cafe Photo &amp; Signature KB Tool
              </h2>
              <p className="text-xs text-slate-600 mt-0.5">
                SSC, PAN, Passport, Army aur Court forms ke exact pixel aur KB limit me photo resize karein (100% browser RAM me — server par save nahi hota).
              </p>
            </div>

            <div className="space-y-2">
              <label className="block text-xs font-semibold text-slate-700">
                Preset Size Chuno
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {RESIZER_PRESETS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => selectPreset(p)}
                    className={`min-h-[38px] px-3 py-2 rounded-xl border text-left text-xs font-semibold transition-colors ${
                      resizerPresetId === p.id
                        ? 'bg-[#0B1120] text-white border-[#0B1120]'
                        : 'bg-slate-50 text-slate-800 border-slate-200 hover:border-slate-400'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2.5">
              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                  Width (px)
                </label>
                <input
                  type="number"
                  min={40}
                  max={2500}
                  value={customWidth}
                  onChange={(e) => {
                    setResizerPresetId('custom');
                    setCustomWidth(Number(e.target.value) || 200);
                  }}
                  className="w-full min-h-[40px] px-3 rounded-xl bg-slate-50 border border-slate-200 text-xs font-mono tabular-nums text-slate-900"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                  Height (px)
                </label>
                <input
                  type="number"
                  min={40}
                  max={2500}
                  value={customHeight}
                  onChange={(e) => {
                    setResizerPresetId('custom');
                    setCustomHeight(Number(e.target.value) || 230);
                  }}
                  className="w-full min-h-[40px] px-3 rounded-xl bg-slate-50 border border-slate-200 text-xs font-mono tabular-nums text-slate-900"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                  Max KB
                </label>
                <input
                  type="number"
                  min={5}
                  max={1000}
                  value={customMaxKb}
                  onChange={(e) => {
                    setResizerPresetId('custom');
                    setCustomMaxKb(Number(e.target.value) || 45);
                  }}
                  className="w-full min-h-[40px] px-3 rounded-xl bg-slate-50 border border-slate-200 text-xs font-mono tabular-nums text-slate-900"
                />
              </div>
            </div>

            <button
              type="button"
              onClick={() => photoInputRef.current?.click()}
              className="w-full min-h-[44px] px-4 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-semibold text-sm inline-flex items-center justify-center gap-2 whitespace-nowrap transition-colors"
            >
              <Upload className="w-4 h-4" />
              Photo / Signature Upload Karein
            </button>
          </div>

          <div className="lg:col-span-7 bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
              <h2 className="text-base font-bold text-slate-900">Live Resized Output</h2>
              {resizedOutput && (
                <div className="text-xs font-mono tabular-nums text-emerald-700 font-semibold">
                  {resizedOutput.width}×{resizedOutput.height} px · {resizedOutput.kb} KB · JPG {resizedOutput.quality}%
                </div>
              )}
            </div>

            {!origFileMeta ? (
              <div className="py-12 px-4 text-center space-y-3 border border-dashed border-slate-200 rounded-xl bg-slate-50">
                <p className="text-sm font-semibold text-slate-800">
                  Abhi koi photo upload nahi hui hai
                </p>
                <p className="text-xs text-slate-600 max-w-md mx-auto">
                  Passport photo, signature ya scanned paper upload karein — tool turant target KB size (jaise 20–45 KB) me crop aur compress karke dega.
                </p>
                <button
                  type="button"
                  onClick={() => photoInputRef.current?.click()}
                  className="min-h-[40px] px-4 rounded-xl bg-[#0B1120] text-white text-xs font-semibold inline-flex items-center gap-2 whitespace-nowrap"
                >
                  <Upload className="w-3.5 h-3.5" />
                  Select Image
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                    <div className="flex items-center justify-between text-xs text-slate-600">
                      <span className="font-semibold text-slate-900">Original</span>
                      <span className="font-mono tabular-nums">
                        {origFileMeta.width}×{origFileMeta.height} · {origFileMeta.kb} KB
                      </span>
                    </div>
                    <img
                      src={origFileMeta.dataUrl}
                      alt="Original upload"
                      className="w-full max-h-56 object-contain rounded-lg bg-white border border-slate-200"
                    />
                  </div>
                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                    <div className="flex items-center justify-between text-xs text-slate-600">
                      <span className="font-semibold text-emerald-800">Form Ready JPG</span>
                      {resizing ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        resizedOutput && (
                          <span className="font-mono tabular-nums text-emerald-700 font-semibold">
                            {resizedOutput.width}×{resizedOutput.height} · {resizedOutput.kb} KB
                          </span>
                        )
                      )}
                    </div>
                    {resizedOutput && (
                      <img
                        src={resizedOutput.dataUrl}
                        alt="Compressed form output"
                        className="w-full max-h-56 object-contain rounded-lg bg-white border border-slate-200"
                      />
                    )}
                  </div>
                </div>

                {resizedOutput && (
                  <div className="flex flex-wrap gap-2.5">
                    <a
                      href={resizedOutput.dataUrl}
                      download={`csc-${resizerPresetId}-${Math.round(resizedOutput.kb)}kb.jpg`}
                      className="min-h-[42px] px-4 rounded-xl bg-[#0B1120] hover:bg-slate-800 text-white text-xs font-semibold inline-flex items-center gap-2 whitespace-nowrap"
                    >
                      <Download className="w-4 h-4" />
                      Download JPG ({resizedOutput.kb} KB)
                    </a>
                    <button
                      type="button"
                      onClick={() => window.print()}
                      className="min-h-[42px] px-4 rounded-xl bg-white border border-slate-300 hover:border-slate-500 text-slate-800 text-xs font-semibold inline-flex items-center gap-2 whitespace-nowrap"
                    >
                      <Printer className="w-4 h-4" />
                      Print Sheet
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      ) : (
        /* DESK 1, 2, 3: LAND / COURT CASE DOCS / WAKIL & COURT APPOINTMENT */
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          {/* Left Column: Intake & Official Portals */}
          <div className="lg:col-span-5 space-y-4">
            <form
              onSubmit={handleGeneratePacket}
              className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 space-y-3.5"
            >
              <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-3">
                <div>
                  <h2 className="text-base font-bold text-slate-900">
                    {mode === 'land'
                      ? 'Jamin / Bhumi Samasya Intake'
                      : mode === 'court_case'
                      ? 'Court & Case Document Builder'
                      : 'Wakil & Court Appointment Prep'}
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {mode === 'land'
                      ? 'Khatiyan/Rasid scan karein ya details bhar kar petition + portal kholein'
                      : mode === 'court_case'
                      ? 'FIR/Notice scan karein — Haziri, Bail & Case checklist packet banega'
                      : 'Case brief tayyar karein aur Tele-Law / eCourts / NALSA portal par book karein'}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={ocrBusy}
                  onClick={() => ocrInputRef.current?.click()}
                  className="min-h-[38px] px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
                >
                  {ocrBusy ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Upload className="w-3.5 h-3.5" />
                  )}
                  Scan Paper (OCR)
                </button>
              </div>

              {ocrMessage && (
                <div className="px-3 py-2 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-900">
                  {ocrMessage}
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  {mode === 'land'
                    ? 'Jamin Ka Mamla (Problem Type)'
                    : mode === 'court_case'
                    ? 'Mukadma / Case Category'
                    : 'Appointment / Service Type'}
                </label>
                {mode === 'land' && (
                  <select
                    value={landSubType}
                    onChange={(e) => setLandSubType(e.target.value)}
                    className="w-full min-h-[42px] px-3 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-900 focus:border-slate-900 focus:bg-white focus:outline-none"
                  >
                    {LAND_ISSUE_TYPES.map((t) => (
                      <option key={t.id} value={t.label}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                )}
                {mode === 'court_case' && (
                  <select
                    value={courtSubType}
                    onChange={(e) => setCourtSubType(e.target.value)}
                    className="w-full min-h-[42px] px-3 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-900 focus:border-slate-900 focus:bg-white focus:outline-none"
                  >
                    {COURT_CASE_TYPES.map((t) => (
                      <option key={t.id} value={t.label}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                )}
                {mode === 'lawyer_appointment' && (
                  <select
                    value={apptSubType}
                    onChange={(e) => setApptSubType(e.target.value)}
                    className="w-full min-h-[42px] px-3 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-900 focus:border-slate-900 focus:bg-white focus:outline-none"
                  >
                    {APPOINTMENT_TYPES.map((t) => (
                      <option key={t.id} value={t.label}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                    State / Rajya
                  </label>
                  <select
                    value={stateVal}
                    onChange={(e) => setStateVal(e.target.value)}
                    className="w-full min-h-[40px] px-3 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-900 focus:border-slate-900 focus:bg-white focus:outline-none"
                  >
                    <option value="">Select State</option>
                    {INDIAN_STATES_AND_UTS.map((st) => (
                      <option key={st} value={st}>
                        {st}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                    District / Zila
                  </label>
                  <input
                    type="text"
                    value={districtVal}
                    onChange={(e) => setDistrictVal(e.target.value)}
                    placeholder="jaise Patna, Siwan, Varanasi"
                    className="w-full min-h-[40px] px-3 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-900 focus:border-slate-900 focus:bg-white focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                    {mode === 'land' ? 'Block / Anchal / Tehsil' : 'Court / Bench Name'}
                  </label>
                  <input
                    type="text"
                    value={blockOrCourt}
                    onChange={(e) => setBlockOrCourt(e.target.value)}
                    placeholder={
                      mode === 'land' ? 'Anchal / CO / SDM Office' : 'CJM / District / SDM Court'
                    }
                    className="w-full min-h-[40px] px-3 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-900 focus:border-slate-900 focus:bg-white focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                    {mode === 'land' ? 'Mauza / Gram / Thana No' : 'Police Station / Thana'}
                  </label>
                  <input
                    type="text"
                    value={psOrMauza}
                    onChange={(e) => setPsOrMauza(e.target.value)}
                    placeholder={mode === 'land' ? 'Mauza / Halka' : 'Thana name'}
                    className="w-full min-h-[40px] px-3 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-900 focus:border-slate-900 focus:bg-white focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                    {mode === 'land'
                      ? 'Khata / Khesra / Jamabandi No'
                      : 'CNR / FIR / Case / Challan No'}
                  </label>
                  <input
                    type="text"
                    value={referenceNo}
                    onChange={(e) => setReferenceNo(e.target.value)}
                    placeholder={
                      mode === 'land'
                        ? 'Khata 42, Khesra 108'
                        : 'FIR 124/2025 ya 16-digit CNR'
                    }
                    className="w-full min-h-[40px] px-3 rounded-xl bg-slate-50 border border-slate-200 text-xs font-mono text-slate-900 focus:border-slate-900 focus:bg-white focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                    Applicant / Client Name
                  </label>
                  <input
                    type="text"
                    value={applicantName}
                    onChange={(e) => setApplicantName(e.target.value)}
                    placeholder="Poora naam"
                    className="w-full min-h-[40px] px-3 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-900 focus:border-slate-900 focus:bg-white focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                  {mode === 'land'
                    ? 'Opposite Party / Remarks (Optional)'
                    : mode === 'court_case'
                    ? 'Dhara / Sections ya Opposite Party (Optional)'
                    : 'Preferred Language / Date Slot (Optional)'}
                </label>
                <input
                  type="text"
                  value={oppositeParty}
                  onChange={(e) => setOppositeParty(e.target.value)}
                  placeholder={
                    mode === 'land'
                      ? 'Samne wale paksh ka naam ya rakba galti'
                      : mode === 'court_case'
                      ? 'jaise BNS 115 / IPC 323, 504 ya Complainant name'
                      : 'jaise Hindi/Hinglish · Subah 11 AM video slot'
                  }
                  className="w-full min-h-[40px] px-3 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-900 focus:border-slate-900 focus:bg-white focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                  Poori Baat / Problem Detail (Hindi, Hinglish ya English me likhein)
                </label>
                <textarea
                  rows={3}
                  value={factsText}
                  onChange={(e) => setFactsText(e.target.value)}
                  placeholder={
                    mode === 'land'
                      ? 'Batayein jamin me kya samasya hai (jaise online jamabandi me naam galat hai, ya dakhil-kharij ruka hua hai, ya kabza hatwana hai)...'
                      : mode === 'court_case'
                      ? 'Batayein kya case ya notice aaya hai, tarikh kab hai, aur aapko kya document tayyar karna hai...'
                      : 'Apna legal issue short me likhein taaki AI Tele-Law / Wakil consultation brief bana de...'
                  }
                  className="w-full p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-900 focus:border-slate-900 focus:bg-white focus:outline-none"
                />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <div className="flex items-center gap-1 bg-slate-100 border border-slate-200 rounded-xl p-1">
                  {(['hindi', 'hinglish', 'english'] as const).map((lang) => (
                    <button
                      key={lang}
                      type="button"
                      onClick={() => setLanguage(lang)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-semibold capitalize whitespace-nowrap transition-colors ${
                        language === lang
                          ? 'bg-[#0B1120] text-white'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {lang}
                    </button>
                  ))}
                </div>

                <button
                  type="submit"
                  disabled={generating}
                  className="min-h-[42px] px-4 rounded-xl bg-[#0B1120] hover:bg-slate-800 disabled:opacity-50 text-white text-xs font-semibold inline-flex items-center gap-2 whitespace-nowrap shrink-0"
                >
                  {generating ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Sparkles className="w-4 h-4 text-rose-400" />
                  )}
                  {mode === 'land'
                    ? 'Draft Land Petition & Portal'
                    : mode === 'court_case'
                    ? 'Build Case Docs Packet'
                    : 'Prepare Brief & Booking'}
                </button>
              </div>

              {mode === 'lawyer_appointment' && (
                <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2">
                  <div className="text-[11px] text-slate-600 min-w-0">
                    Direct Booking Portal:{' '}
                    <span className="font-semibold text-slate-900">
                      {selectedApptPortal.name}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      onOpenBrowser(selectedApptPortal.url, selectedApptPortal.aiGoal)
                    }
                    className="min-h-[36px] px-3 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
                  >
                    <Compass className="w-3.5 h-3.5" />
                    Direct Portal Kholein
                  </button>
                </div>
              )}

              {error && (
                <div className="px-3.5 py-2.5 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700">
                  {error}
                </div>
              )}
            </form>

            {/* Verified Official Portals Card */}
            <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3">
              <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
                <h3 className="text-sm font-bold text-slate-900">
                  {mode === 'land'
                    ? 'Official State Land & Bhumi Portals'
                    : 'Official Court, Wakil & e-Filing Portals'}
                </h3>
                <span className="text-[11px] text-slate-500 whitespace-nowrap">Ad-Free Launch</span>
              </div>
              <div className="divide-y divide-slate-100">
                {portalList.map((portal) => (
                  <div
                    key={portal.id}
                    className="py-2.5 flex items-center justify-between gap-2.5"
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-slate-900 truncate">
                        {portal.name}
                      </div>
                      <div className="text-[11px] text-slate-500 truncate">
                        {portal.stateOrScope} · {portal.purpose}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => onOpenBrowser(portal.url, portal.aiGoal)}
                        className="min-h-[34px] px-2.5 rounded-lg bg-[#0B1120] hover:bg-slate-800 text-white text-[11px] font-semibold inline-flex items-center gap-1 whitespace-nowrap"
                      >
                        <Compass className="w-3 h-3 text-emerald-400" />
                        Open AI
                      </button>
                      <a
                        href={portal.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Open in New Tab"
                        className="min-h-[34px] min-w-[34px] rounded-lg border border-slate-200 text-slate-600 hover:text-slate-900 flex items-center justify-center"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Right Column: Generated Action Packet, Petitions, Checklists */}
          <div className="lg:col-span-7 space-y-4">
            {!packet ? (
              <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center shrink-0">
                    {mode === 'land' ? (
                      <Building2 className="w-5 h-5 text-amber-700" />
                    ) : mode === 'court_case' ? (
                      <Briefcase className="w-5 h-5 text-rose-700" />
                    ) : (
                      <CalendarCheck className="w-5 h-5 text-sky-700" />
                    )}
                  </div>
                  <div className="space-y-1">
                    <h3 className="text-base font-bold text-slate-900">
                      {mode === 'land'
                        ? 'Jamin / Revenue Petition & Online Filing Ready'
                        : mode === 'court_case'
                        ? 'Complete Case Defense & Court Document Kit'
                        : 'CSC Tele-Law & Court Appointment Desk'}
                    </h3>
                    <p className="text-xs text-slate-600 leading-relaxed">
                      Baayi taraf details bharein ya apna paper scan karein aur button dabayein. AI aapke liye:
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-1">
                    <div className="font-bold text-slate-900">1. Print-Ready Formal Application</div>
                    <p className="text-slate-600">
                      Hindi ya English me CO/SDM petition, Court Haziri / Bail Memo, ya Advocate Case Brief tayyar milega.
                    </p>
                  </div>
                  <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-1">
                    <div className="font-bold text-slate-900">2. Document &amp; Size Checklist</div>
                    <p className="text-slate-600">
                      Kya-kya kagaz lagenge (Affidavit, Khatiyan, Bail Surety, ID) aur kis PDF/JPG size me scan karna hai.
                    </p>
                  </div>
                  <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-1">
                    <div className="font-bold text-slate-900">3. Official Portal Auto-Fill Launch</div>
                    <p className="text-slate-600">
                      Bhumi, eCourts, Tele-Law ya e-Filing ko seedha Ad-Free AI Browser me kholkar details fill kar sakte hain.
                    </p>
                  </div>
                  <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-1">
                    <div className="font-bold text-slate-900">4. Copy, Edit &amp; Print</div>
                    <p className="text-slate-600">
                      Har draft ko edit karke `.txt` download karein ya CSC counter par seedha print nikaal lein.
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-5">
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 pb-4">
                  <div className="space-y-1 min-w-0">
                    <div className="text-xs text-slate-600">
                      {packet.portalName} ·{' '}
                      <span className="font-mono tabular-nums text-amber-800 font-semibold">
                        {packet.feeAndTimeline}
                      </span>
                    </div>
                    <h2 className="text-lg font-bold font-display text-slate-900">
                      {packet.title}
                    </h2>
                    <p className="text-xs text-slate-600 leading-relaxed">{packet.summary}</p>
                  </div>
                  <div className="flex flex-wrap gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => onOpenBrowser(packet.portalUrl, packet.browserGoal)}
                      className="min-h-[38px] px-3.5 rounded-xl bg-[#0B1120] hover:bg-slate-800 text-white text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap"
                    >
                      <Compass className="w-3.5 h-3.5 text-emerald-400" />
                      Open Portal in AI Browser
                    </button>
                    <button
                      type="button"
                      onClick={() => window.print()}
                      className="min-h-[38px] px-3 rounded-xl bg-slate-50 border border-slate-200 hover:border-slate-400 text-xs font-semibold text-slate-800 inline-flex items-center gap-1.5 whitespace-nowrap"
                    >
                      <Printer className="w-3.5 h-3.5" />
                      Print
                    </button>
                  </div>
                </div>

                {/* Step-by-Step Action Plan & Required Documents */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                    <h3 className="text-xs font-bold text-slate-900">
                      Step-by-Step Kaise Karein
                    </h3>
                    <ol className="space-y-1.5 text-xs text-slate-700 list-decimal pl-4">
                      {packet.actionPlan.map((step, i) => (
                        <li key={i}>{step}</li>
                      ))}
                    </ol>
                  </div>

                  <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                    <h3 className="text-xs font-bold text-slate-900">
                      Kya Documents Lagenge (Checklist)
                    </h3>
                    <div className="space-y-2">
                      {packet.requiredDocuments.map((doc, i) => (
                        <div key={i} className="text-xs border-b border-slate-200/70 last:border-0 pb-1.5 last:pb-0">
                          <div className="font-semibold text-slate-900">
                            {doc.name}{' '}
                            <span className="font-mono text-[11px] font-normal text-sky-700">
                              ({doc.spec})
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-600">{doc.purpose}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Primary Editable Formal Application / Petition */}
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-bold text-slate-900 inline-flex items-center gap-1.5">
                      <FileText className="w-4 h-4 text-emerald-700" />
                      {packet.primaryDraftTitle}
                    </h3>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => copyText('primary', editablePrimaryDraft)}
                        className="min-h-[34px] px-3 rounded-lg bg-slate-50 border border-slate-200 text-xs font-semibold text-slate-800 inline-flex items-center gap-1.5 whitespace-nowrap"
                      >
                        {copiedId === 'primary' ? (
                          <Check className="w-3.5 h-3.5 text-emerald-600" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                        Copy
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          downloadDraftFile(
                            `${packet.mode}-primary-draft.txt`,
                            editablePrimaryDraft
                          )
                        }
                        className="min-h-[34px] px-3 rounded-lg bg-slate-50 border border-slate-200 text-xs font-semibold text-slate-800 inline-flex items-center gap-1.5 whitespace-nowrap"
                      >
                        <Download className="w-3.5 h-3.5" />
                        .TXT
                      </button>
                    </div>
                  </div>
                  <textarea
                    rows={10}
                    value={editablePrimaryDraft}
                    onChange={(e) => setEditablePrimaryDraft(e.target.value)}
                    className="w-full p-3.5 rounded-xl bg-slate-50 border border-slate-200 focus:border-slate-900 focus:bg-white focus:outline-none text-xs leading-relaxed text-slate-900"
                  />
                </div>

                {/* Secondary Supporting Draft */}
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-bold text-slate-900 inline-flex items-center gap-1.5">
                      <FileText className="w-4 h-4 text-sky-700" />
                      {packet.secondaryDraftTitle}
                    </h3>
                    <button
                      type="button"
                      onClick={() => copyText('secondary', editableSecondaryDraft)}
                      className="min-h-[34px] px-3 rounded-lg bg-slate-50 border border-slate-200 text-xs font-semibold text-slate-800 inline-flex items-center gap-1.5 whitespace-nowrap"
                    >
                      {copiedId === 'secondary' ? (
                        <Check className="w-3.5 h-3.5 text-emerald-600" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                      Copy
                    </button>
                  </div>
                  <textarea
                    rows={6}
                    value={editableSecondaryDraft}
                    onChange={(e) => setEditableSecondaryDraft(e.target.value)}
                    className="w-full p-3.5 rounded-xl bg-slate-50 border border-slate-200 focus:border-slate-900 focus:bg-white focus:outline-none text-xs leading-relaxed text-slate-900"
                  />
                </div>

                {/* Caution & Legal Verification Notice */}
                <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 flex items-start gap-2.5 text-xs text-amber-950">
                  <ShieldAlert className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold">Important Verification Notice: </span>
                    {packet.cautionNote}
                  </div>
                </div>

                {/* Recommended Official Portals */}
                {packet.recommendedPortals.length > 0 && (
                  <div className="pt-2 border-t border-slate-200 space-y-2">
                    <div className="text-xs font-bold text-slate-900">
                      Recommended Portals to Launch Now
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      {packet.recommendedPortals.map((rp, idx) => (
                        <div
                          key={`${rp.url}-${idx}`}
                          className="p-3 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between gap-2"
                        >
                          <div className="min-w-0">
                            <div className="text-xs font-semibold text-slate-900 truncate">
                              {rp.name}
                            </div>
                            <div className="text-[11px] text-slate-600 truncate">
                              {rp.purpose}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => onOpenBrowser(rp.url, packet.browserGoal)}
                            className="min-h-[34px] px-2.5 rounded-lg bg-[#0B1120] text-white text-[11px] font-semibold whitespace-nowrap shrink-0"
                          >
                            Open →
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
