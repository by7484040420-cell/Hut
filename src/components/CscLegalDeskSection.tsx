import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Briefcase,
  Building2,
  Calculator,
  CalendarCheck,
  Check,
  Compass,
  Copy,
  Download,
  ExternalLink,
  FilePlus2,
  FileText,
  Grid,
  Image as ImageIcon,
  Landmark,
  Loader2,
  Printer,
  Scale,
  Search,
  ShieldAlert,
  Sparkles,
  Upload,
  X,
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
import {
  BNS_IPC_QUICK_REF,
  buildPassportPhotoSheetDataUrl,
  convertImagesToUnderKbPdf,
  convertLandArea,
  downloadWordDoc,
  LAND_UNIT_LABELS,
  type LandUnitId,
} from '../lib/cscTools';

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

  // ---- Cyber Photo / Signature KB Resizer, PDF Maker & Photo Sheet State ----
  const [resizerTool, setResizerTool] = useState<'jpg' | 'pdf' | 'sheet'>('jpg');
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

  // Image -> Under-KB PDF Converter State
  const [pdfPages, setPdfPages] = useState<Array<{ name: string; dataUrl: string }>>([]);
  const [pdfMaxKb, setPdfMaxKb] = useState<number>(190);
  const [pdfBuilding, setPdfBuilding] = useState(false);
  const [pdfResult, setPdfResult] = useState<{
    url: string;
    kb: number;
    pageCount: number;
    quality: number;
  } | null>(null);
  const pdfPagesInputRef = useRef<HTMLInputElement | null>(null);

  // 6 / 8 Passport Photo Sheet State
  const [sheetCount, setSheetCount] = useState<6 | 8>(6);
  const [sheetDataUrl, setSheetDataUrl] = useState<string | null>(null);
  const [sheetBuilding, setSheetBuilding] = useState(false);

  // Jamin Rakba Area Converter & BNS <-> IPC Quick Finder State
  const [showLandCalc, setShowLandCalc] = useState(false);
  const [landAreaVal, setLandAreaVal] = useState('10');
  const [landAreaUnit, setLandAreaUnit] = useState<LandUnitId>('dismil');
  const [laggiHath, setLaggiHath] = useState(5.5);

  const [showBnsLookup, setShowBnsLookup] = useState(false);
  const [bnsQuery, setBnsQuery] = useState('');

  const landConverted = useMemo(
    () => convertLandArea(parseFloat(landAreaVal) || 0, landAreaUnit, laggiHath),
    [landAreaVal, landAreaUnit, laggiHath]
  );

  const filteredBnsList = useMemo(() => {
    const q = bnsQuery.trim().toLowerCase();
    if (!q) return BNS_IPC_QUICK_REF.slice(0, 6);
    return BNS_IPC_QUICK_REF.filter((item) =>
      `${item.bnsOrBnss} ${item.oldIpcOrCrpc} ${item.title} ${item.hindiMeaning}`
        .toLowerCase()
        .includes(q)
    );
  }, [bnsQuery]);

  useEffect(() => {
    return () => {
      if (pdfResult?.url) URL.revokeObjectURL(pdfResult.url);
    };
  }, [pdfResult?.url]);

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

  useEffect(() => {
    if (resizerTool !== 'sheet' || !origFileMeta?.dataUrl) return;
    let cancelled = false;
    setSheetBuilding(true);
    void buildPassportPhotoSheetDataUrl(origFileMeta.dataUrl, sheetCount)
      .then((url) => {
        if (!cancelled) setSheetDataUrl(url);
      })
      .finally(() => {
        if (!cancelled) setSheetBuilding(false);
      });
    return () => {
      cancelled = true;
    };
  }, [resizerTool, origFileMeta?.dataUrl, sheetCount]);

  const handleAddPdfPages = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []).slice(0, 6);
    e.target.value = '';
    if (files.length === 0) return;
    const loaded = await Promise.all(
      files.map(
        (file) =>
          new Promise<{ name: string; dataUrl: string }>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve({ name: file.name, dataUrl: String(reader.result || '') });
            reader.onerror = () => reject(new Error('File read failed'));
            reader.readAsDataURL(file);
          })
      )
    );
    setPdfPages((prev) => [...prev, ...loaded].slice(0, 6));
  };

  const handleBuildPdf = async () => {
    const sources =
      pdfPages.length > 0
        ? pdfPages.map((p) => p.dataUrl)
        : origFileMeta?.dataUrl
        ? [origFileMeta.dataUrl]
        : [];
    if (sources.length === 0 || pdfBuilding) return;
    setPdfBuilding(true);
    setError(null);
    try {
      const res = await convertImagesToUnderKbPdf(sources, pdfMaxKb);
      if (pdfResult?.url) URL.revokeObjectURL(pdfResult.url);
      const url = URL.createObjectURL(res.blob);
      setPdfResult({ url, kb: res.kb, pageCount: res.pageCount, quality: res.quality });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'PDF conversion failed.');
    } finally {
      setPdfBuilding(false);
    }
  };

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
      <input
        ref={pdfPagesInputRef}
        type="file"
        accept="image/*"
        multiple
        onChange={(e) => void handleAddPdfPages(e)}
        className="hidden"
      />

      {/* Header & Interactive Mode Switcher */}
      <div className="no-print bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 space-y-4">
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
            <span>Photo, PDF &amp; Sheet</span>
          </button>
        </div>
      </div>

      {/* DESK 4: CYBER PHOTO, PDF & PRINT SHEET TOOL */}
      {mode === 'resizer' ? (
        <div className="no-print grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          <div className="lg:col-span-5 bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
            <div className="space-y-2">
              <h2 className="text-base font-bold text-slate-900">
                Cyber Cafe Photo, PDF &amp; Sheet Tool
              </h2>
              <div className="grid grid-cols-3 gap-1 p-1 bg-slate-100 border border-slate-200 rounded-xl">
                <button
                  type="button"
                  onClick={() => setResizerTool('jpg')}
                  className={`min-h-[34px] px-2 rounded-lg text-[11px] font-semibold inline-flex items-center justify-center gap-1 whitespace-nowrap ${
                    resizerTool === 'jpg'
                      ? 'bg-[#0B1120] text-white'
                      : 'text-slate-700 hover:bg-white'
                  }`}
                >
                  <ImageIcon className="w-3.5 h-3.5 shrink-0" />
                  Photo JPG
                </button>
                <button
                  type="button"
                  onClick={() => setResizerTool('pdf')}
                  className={`min-h-[34px] px-2 rounded-lg text-[11px] font-semibold inline-flex items-center justify-center gap-1 whitespace-nowrap ${
                    resizerTool === 'pdf'
                      ? 'bg-[#0B1120] text-white'
                      : 'text-slate-700 hover:bg-white'
                  }`}
                >
                  <FilePlus2 className="w-3.5 h-3.5 shrink-0" />
                  Under-KB PDF
                </button>
                <button
                  type="button"
                  onClick={() => setResizerTool('sheet')}
                  className={`min-h-[34px] px-2 rounded-lg text-[11px] font-semibold inline-flex items-center justify-center gap-1 whitespace-nowrap ${
                    resizerTool === 'sheet'
                      ? 'bg-[#0B1120] text-white'
                      : 'text-slate-700 hover:bg-white'
                  }`}
                >
                  <Grid className="w-3.5 h-3.5 shrink-0" />
                  6/8 Photo Sheet
                </button>
              </div>
            </div>

            {resizerTool === 'jpg' && (
              <>
                <p className="text-xs text-slate-600">
                  SSC, PAN, Passport, Army aur Court forms ke exact pixel aur KB limit me photo resize karein (100% browser RAM me).
                </p>

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
              </>
            )}

            {resizerTool === 'pdf' && (
              <div className="space-y-3.5">
                <p className="text-xs text-slate-600">
                  Parimarjan, Dakhil-Kharij, eCourts ya Sarkari portal ke liye 1 se 6 photo/scan ko jodkar exact KB limit ke andar real <span className="font-mono font-semibold">.PDF</span> banayein.
                </p>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Target PDF Size Limit
                  </label>
                  <div className="grid grid-cols-4 gap-1.5">
                    {[95, 190, 400, 950].map((kb) => (
                      <button
                        key={kb}
                        type="button"
                        onClick={() => setPdfMaxKb(kb)}
                        className={`min-h-[36px] rounded-xl border text-xs font-mono font-semibold tabular-nums ${
                          pdfMaxKb === kb
                            ? 'bg-[#0B1120] text-white border-[#0B1120]'
                            : 'bg-slate-50 text-slate-800 border-slate-200'
                        }`}
                      >
                        &lt;{kb} KB
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-[11px] font-semibold text-slate-700 shrink-0">
                    Custom KB:
                  </label>
                  <input
                    type="number"
                    min={40}
                    max={5000}
                    value={pdfMaxKb}
                    onChange={(e) => setPdfMaxKb(Number(e.target.value) || 190)}
                    className="w-28 min-h-[36px] px-2.5 rounded-xl bg-slate-50 border border-slate-200 text-xs font-mono tabular-nums text-slate-900"
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => pdfPagesInputRef.current?.click()}
                    className="flex-1 min-h-[42px] px-3.5 rounded-xl bg-slate-100 hover:bg-slate-200 border border-slate-300 text-slate-900 font-semibold text-xs inline-flex items-center justify-center gap-1.5 whitespace-nowrap"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    Add Scan Pages ({pdfPages.length}/6)
                  </button>
                  <button
                    type="button"
                    disabled={pdfBuilding || (pdfPages.length === 0 && !origFileMeta?.dataUrl)}
                    onClick={() => void handleBuildPdf()}
                    className="flex-1 min-h-[42px] px-3.5 rounded-xl bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white font-semibold text-xs inline-flex items-center justify-center gap-1.5 whitespace-nowrap"
                  >
                    {pdfBuilding ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <FilePlus2 className="w-3.5 h-3.5" />
                    )}
                    Build Compressed PDF
                  </button>
                </div>
              </div>
            )}

            {resizerTool === 'sheet' && (
              <div className="space-y-3.5">
                <p className="text-xs text-slate-600">
                  4×6 ya A4 paper par ek click me 6 ya 8 Passport Photos cut-lines ke sath print sheet banayein — cyber cafe counter ke liye ready.
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setSheetCount(6)}
                    className={`min-h-[40px] rounded-xl border text-xs font-semibold ${
                      sheetCount === 6
                        ? 'bg-[#0B1120] text-white border-[#0B1120]'
                        : 'bg-slate-50 text-slate-800 border-slate-200'
                    }`}
                  >
                    6 Photos Sheet (2×3)
                  </button>
                  <button
                    type="button"
                    onClick={() => setSheetCount(8)}
                    className={`min-h-[40px] rounded-xl border text-xs font-semibold ${
                      sheetCount === 8
                        ? 'bg-[#0B1120] text-white border-[#0B1120]'
                        : 'bg-slate-50 text-slate-800 border-slate-200'
                    }`}
                  >
                    8 Photos Sheet (2×4)
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => photoInputRef.current?.click()}
                  className="w-full min-h-[44px] px-4 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-semibold text-sm inline-flex items-center justify-center gap-2 whitespace-nowrap transition-colors"
                >
                  <Upload className="w-4 h-4" />
                  {origFileMeta ? 'Change Passport Photo' : 'Passport Photo Upload Karein'}
                </button>
              </div>
            )}
          </div>

          <div className="lg:col-span-7 bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
              <h2 className="text-base font-bold text-slate-900">
                {resizerTool === 'pdf'
                  ? 'Multi-Page Compressed PDF Output'
                  : resizerTool === 'sheet'
                  ? `${sheetCount}-Copy Passport Print Sheet`
                  : 'Live Resized Output'}
              </h2>
              {resizerTool === 'jpg' && resizedOutput && (
                <div className="text-xs font-mono tabular-nums text-emerald-700 font-semibold">
                  {resizedOutput.width}×{resizedOutput.height} px · {resizedOutput.kb} KB · JPG {resizedOutput.quality}%
                </div>
              )}
              {resizerTool === 'pdf' && pdfResult && (
                <div className="text-xs font-mono tabular-nums text-emerald-700 font-semibold">
                  {pdfResult.pageCount} Page(s) · {pdfResult.kb} KB · JPG {pdfResult.quality}%
                </div>
              )}
            </div>

            {resizerTool === 'pdf' ? (
              <div className="space-y-4">
                {pdfPages.length === 0 && !origFileMeta ? (
                  <div className="py-12 px-4 text-center space-y-3 border border-dashed border-slate-200 rounded-xl bg-slate-50">
                    <p className="text-sm font-semibold text-slate-800">
                      Khatiyan, Aadhaar ya Court paper scans add karein
                    </p>
                    <p className="text-xs text-slate-600 max-w-md mx-auto">
                      1 se 6 photos select karein — AI-free local binary PDF builder bina server upload ke under-{pdfMaxKb} KB real .PDF file banayega.
                    </p>
                    <button
                      type="button"
                      onClick={() => pdfPagesInputRef.current?.click()}
                      className="min-h-[40px] px-4 rounded-xl bg-[#0B1120] text-white text-xs font-semibold inline-flex items-center gap-2 whitespace-nowrap"
                    >
                      <Upload className="w-3.5 h-3.5" />
                      Select Images for PDF
                    </button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                      {(pdfPages.length > 0
                        ? pdfPages
                        : [{ name: origFileMeta!.name, dataUrl: origFileMeta!.dataUrl }]
                      ).map((pg, i) => (
                        <div
                          key={`${pg.name}-${i}`}
                          className="relative p-2 rounded-xl bg-slate-50 border border-slate-200 space-y-1"
                        >
                          <div className="flex items-center justify-between gap-1 text-[11px] text-slate-600">
                            <span className="font-mono font-semibold">Page {i + 1}</span>
                            {pdfPages.length > 0 && (
                              <button
                                type="button"
                                aria-label={`Remove page ${i + 1}`}
                                onClick={() =>
                                  setPdfPages((prev) => prev.filter((_, idx) => idx !== i))
                                }
                                className="text-slate-400 hover:text-rose-600"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                          <img
                            src={pg.dataUrl}
                            alt={`PDF Page ${i + 1}`}
                            className="w-full h-28 object-contain rounded-lg bg-white border border-slate-200"
                          />
                        </div>
                      ))}
                    </div>
                    {pdfResult && (
                      <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 flex flex-wrap items-center justify-between gap-3">
                        <div className="text-xs text-emerald-950">
                          <div className="font-bold">
                            PDF Ready ({pdfResult.kb} KB · {pdfResult.pageCount} page)
                          </div>
                          <div className="text-[11px] text-emerald-800">
                            Target limit &lt;{pdfMaxKb} KB ke andar valid %PDF-1.4 file tayyar hai.
                          </div>
                        </div>
                        <a
                          href={pdfResult.url}
                          download={`csc-scan-${Math.round(pdfResult.kb)}kb.pdf`}
                          className="min-h-[40px] px-4 rounded-xl bg-[#0B1120] hover:bg-slate-800 text-white text-xs font-semibold inline-flex items-center gap-2 whitespace-nowrap"
                        >
                          <Download className="w-4 h-4" />
                          Download PDF ({pdfResult.kb} KB)
                        </a>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : resizerTool === 'sheet' ? (
              !origFileMeta ? (
                <div className="py-12 px-4 text-center space-y-3 border border-dashed border-slate-200 rounded-xl bg-slate-50">
                  <p className="text-sm font-semibold text-slate-800">
                    Passport Sheet banane ke liye pehle photo upload karein
                  </p>
                  <button
                    type="button"
                    onClick={() => photoInputRef.current?.click()}
                    className="min-h-[40px] px-4 rounded-xl bg-[#0B1120] text-white text-xs font-semibold inline-flex items-center gap-2 whitespace-nowrap"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    Select Photo
                  </button>
                </div>
              ) : (
                <div className="space-y-4">
                  {sheetBuilding ? (
                    <div className="py-12 flex items-center justify-center gap-2 text-xs text-slate-600">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Building {sheetCount}-photo print layout...
                    </div>
                  ) : (
                    sheetDataUrl && (
                      <>
                        <img
                          src={sheetDataUrl}
                          alt={`${sheetCount} passport photo sheet`}
                          className="w-full max-h-80 object-contain rounded-xl bg-slate-100 border border-slate-200 p-2"
                        />
                        <div className="flex flex-wrap gap-2.5">
                          <a
                            href={sheetDataUrl}
                            download={`passport-sheet-${sheetCount}x.jpg`}
                            className="min-h-[42px] px-4 rounded-xl bg-[#0B1120] hover:bg-slate-800 text-white text-xs font-semibold inline-flex items-center gap-2 whitespace-nowrap"
                          >
                            <Download className="w-4 h-4" />
                            Download {sheetCount}-Photo JPG
                          </a>
                          <button
                            type="button"
                            onClick={() => window.print()}
                            className="min-h-[42px] px-4 rounded-xl bg-white border border-slate-300 hover:border-slate-500 text-slate-800 text-xs font-semibold inline-flex items-center gap-2 whitespace-nowrap"
                          >
                            <Printer className="w-4 h-4" />
                            Print 4×6 / A4 Sheet
                          </button>
                        </div>
                      </>
                    )
                  )}
                </div>
              )
            ) : !origFileMeta ? (
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
        <div className="no-print grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
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

            {/* Quick CSC / Legal Utility Drawer: Jamin Rakba Converter OR BNS<->IPC + eCourts CNR */}
            {mode === 'land' ? (
              <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3">
                <button
                  type="button"
                  onClick={() => setShowLandCalc((v) => !v)}
                  className="w-full flex items-center justify-between gap-2 text-left"
                >
                  <div className="flex items-center gap-2">
                    <Calculator className="w-4 h-4 text-amber-700 shrink-0" />
                    <div>
                      <div className="text-xs font-bold text-slate-900">
                        Jamin Rakba (Area) Converter
                      </div>
                      <div className="text-[11px] text-slate-500">
                        Bigha · Kattha · Dhur · Dismil · Acre · Sq Ft (Laggi preset)
                      </div>
                    </div>
                  </div>
                  <span className="text-[11px] font-semibold text-sky-700">
                    {showLandCalc ? 'Hide' : 'Open'}
                  </span>
                </button>

                {showLandCalc && (
                  <div className="pt-2 border-t border-slate-100 space-y-2.5">
                    <div className="grid grid-cols-3 gap-2">
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={landAreaVal}
                        onChange={(e) => setLandAreaVal(e.target.value)}
                        className="min-h-[36px] px-2.5 rounded-xl bg-slate-50 border border-slate-200 text-xs font-mono tabular-nums text-slate-900"
                      />
                      <select
                        value={landAreaUnit}
                        onChange={(e) => setLandAreaUnit(e.target.value as LandUnitId)}
                        className="min-h-[36px] px-2 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-900"
                      >
                        {LAND_UNIT_LABELS.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.label}
                          </option>
                        ))}
                      </select>
                      <select
                        value={laggiHath}
                        onChange={(e) => setLaggiHath(Number(e.target.value))}
                        className="min-h-[36px] px-2 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-900"
                      >
                        <option value={4.5}>4.5 Hath Laggi</option>
                        <option value={5}>5 Hath Laggi</option>
                        <option value={5.5}>5.5 Hath (Std)</option>
                        <option value={6}>6 Hath Laggi</option>
                        <option value={6.5}>6.5 Hath Laggi</option>
                      </select>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 text-xs font-mono tabular-nums">
                      <div className="p-2 rounded-lg bg-slate-50 border border-slate-200">
                        <span className="text-[10px] text-slate-500 block">Dismil</span>
                        <span className="font-bold text-slate-900">{landConverted.dismil}</span>
                      </div>
                      <div className="p-2 rounded-lg bg-slate-50 border border-slate-200">
                        <span className="text-[10px] text-slate-500 block">Kattha</span>
                        <span className="font-bold text-slate-900">{landConverted.kattha}</span>
                      </div>
                      <div className="p-2 rounded-lg bg-slate-50 border border-slate-200">
                        <span className="text-[10px] text-slate-500 block">Bigha</span>
                        <span className="font-bold text-slate-900">{landConverted.bigha}</span>
                      </div>
                      <div className="p-2 rounded-lg bg-slate-50 border border-slate-200">
                        <span className="text-[10px] text-slate-500 block">Dhur</span>
                        <span className="font-bold text-slate-900">{landConverted.dhur}</span>
                      </div>
                      <div className="p-2 rounded-lg bg-slate-50 border border-slate-200">
                        <span className="text-[10px] text-slate-500 block">Sq Ft</span>
                        <span className="font-bold text-slate-900">{landConverted.sqft}</span>
                      </div>
                      <div className="p-2 rounded-lg bg-slate-50 border border-slate-200">
                        <span className="text-[10px] text-slate-500 block">Acre</span>
                        <span className="font-bold text-slate-900">{landConverted.acre}</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        const summary = `Kul Rakba: ${landConverted.bigha} Bigha / ${landConverted.kattha} Kattha / ${landConverted.dismil} Dismil (${landConverted.sqft} Sq Ft, ${laggiHath} Hath Laggi).`;
                        setFactsText((prev) => (prev.trim() ? `${prev.trim()}\n${summary}` : summary));
                      }}
                      className="w-full min-h-[34px] rounded-xl bg-amber-50 hover:bg-amber-100 border border-amber-200 text-amber-950 text-xs font-semibold"
                    >
                      + Converted Rakba Problem Box me Jodein
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => setShowBnsLookup((v) => !v)}
                    className="flex items-center gap-2 text-left"
                  >
                    <Scale className="w-4 h-4 text-rose-700 shrink-0" />
                    <div>
                      <div className="text-xs font-bold text-slate-900">
                        BNS ↔ IPC &amp; BNSS ↔ CrPC Section Finder
                      </div>
                      <div className="text-[11px] text-slate-500">
                        Purani IPC/CrPC dhara daalkar nayi BNS/BNSS dhara &amp; jamanat dekhein
                      </div>
                    </div>
                  </button>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() =>
                        onOpenBrowser(
                          'https://services.ecourts.gov.in/ecourtindia_v6/',
                          referenceNo.trim()
                            ? `eCourts Services par CNR/Case No "${referenceNo.trim()}" status check karein.`
                            : 'eCourts India par CNR / Party Name / FIR Case Status search kholein.'
                        )
                      }
                      className="min-h-[30px] px-2.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-[11px] font-semibold inline-flex items-center gap-1 whitespace-nowrap"
                    >
                      <Compass className="w-3 h-3" />
                      eCourts Check
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowBnsLookup((v) => !v)}
                      className="text-[11px] font-semibold text-slate-700 hover:underline"
                    >
                      {showBnsLookup ? 'Hide' : 'Find Section'}
                    </button>
                  </div>
                </div>

                {showBnsLookup && (
                  <div className="pt-2 border-t border-slate-100 space-y-2.5">
                    <div className="relative">
                      <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        value={bnsQuery}
                        onChange={(e) => setBnsQuery(e.target.value)}
                        placeholder="Search 323, 420, 438, 107, 138, 115, theft, bail..."
                        className="w-full min-h-[36px] pl-8 pr-3 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-900 focus:bg-white focus:border-slate-900 focus:outline-none"
                      />
                    </div>
                    <div className="max-h-52 overflow-y-auto divide-y divide-slate-100">
                      {filteredBnsList.map((sec) => (
                        <div
                          key={`${sec.bnsOrBnss}-${sec.oldIpcOrCrpc}`}
                          className="py-2 flex items-start justify-between gap-2 text-xs"
                        >
                          <div className="min-w-0">
                            <div className="font-mono font-bold text-slate-900">
                              {sec.bnsOrBnss}{' '}
                              <span className="text-slate-500 font-normal">
                                (Old {sec.oldIpcOrCrpc})
                              </span>
                            </div>
                            <div className="text-[11px] font-semibold text-slate-800 truncate">
                              {sec.title}
                            </div>
                            <div className="text-[11px] text-slate-600">
                              {sec.hindiMeaning} ·{' '}
                              <span className="font-semibold text-emerald-700">{sec.bailNote}</span>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              const tag = `${sec.bnsOrBnss} (Old ${sec.oldIpcOrCrpc})`;
                              setOppositeParty((prev) =>
                                prev.includes(sec.bnsOrBnss)
                                  ? prev
                                  : prev.trim()
                                  ? `${prev.trim()}, ${tag}`
                                  : tag
                              );
                            }}
                            className="min-h-[28px] px-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-[11px] font-semibold text-slate-800 whitespace-nowrap shrink-0"
                          >
                            + Add
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

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
                      <button
                        type="button"
                        onClick={() =>
                          downloadWordDoc({
                            filename: `${packet.mode}-petition.doc`,
                            title: packet.title,
                            subtitle: `${packet.portalName} · ${packet.feeAndTimeline}`,
                            bodyText: editablePrimaryDraft,
                            secondaryTitle: packet.secondaryDraftTitle,
                            secondaryText: editableSecondaryDraft,
                          })
                        }
                        className="min-h-[34px] px-3 rounded-lg bg-slate-50 border border-slate-200 text-xs font-semibold text-slate-800 inline-flex items-center gap-1.5 whitespace-nowrap"
                      >
                        <FileText className="w-3.5 h-3.5" />
                        .DOC (Word)
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

      {/* Clean A4 / Photo-Sheet Print-Only Views */}
      {mode === 'resizer' && resizerTool === 'sheet' && sheetDataUrl && (
        <div className="print-only print-sheet">
          <img
            src={sheetDataUrl}
            alt="Printable Passport Photo Sheet"
            className="w-full h-auto object-contain"
          />
        </div>
      )}
      {mode === 'resizer' && resizerTool === 'jpg' && resizedOutput?.dataUrl && (
        <div className="print-only print-sheet p-6">
          <img
            src={resizedOutput.dataUrl}
            alt="Printable Form Image"
            className="max-w-full h-auto"
          />
        </div>
      )}
      {mode !== 'resizer' && packet && (
        <div className="print-only print-sheet space-y-4">
          <div className="border-b border-slate-400 pb-2">
            <h1 className="text-lg font-bold text-black">{packet.title}</h1>
            <div className="text-xs text-slate-700 mt-0.5">
              {packet.portalName} · {packet.feeAndTimeline}
            </div>
          </div>
          <div>
            <div className="text-sm font-bold text-black mb-1">{packet.primaryDraftTitle}</div>
            <pre className="whitespace-pre-wrap font-sans text-xs leading-relaxed text-black">
              {editablePrimaryDraft}
            </pre>
          </div>
          {editableSecondaryDraft.trim() && (
            <div className="pt-3 border-t border-slate-300">
              <div className="text-sm font-bold text-black mb-1">{packet.secondaryDraftTitle}</div>
              <pre className="whitespace-pre-wrap font-sans text-xs leading-relaxed text-black">
                {editableSecondaryDraft}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
