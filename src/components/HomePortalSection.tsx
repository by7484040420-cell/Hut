import React, { useEffect, useMemo, useState } from 'react';
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
  ProfileVault,
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
import { buildAutoFillPayload, runNativeOnDeviceOcr } from '../lib/nativeBrowserBridge';
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

const MANUAL_DOC_ID = 'user-details';

// Form shuru karne se pehle jo saman (details) AI ko chahiye. key = payload key, fkey/label = doc field
const DETAIL_FIELDS: Array<{
  payloadKey: string;
  fkey: string;
  label: string;
  placeholder: string;
  inputMode?: 'text' | 'tel' | 'email' | 'numeric';
  inputType?: 'text' | 'password';
  options?: string[];
}> = [
  { payloadKey: 'fromStation', fkey: 'from_station', label: 'From Station (Kahan se)', placeholder: 'jaise Siwan, Patna, New Delhi' },
  { payloadKey: 'toStation', fkey: 'to_station', label: 'To Station (Kahan tak)', placeholder: 'jaise New Delhi, Mumbai, Surat' },
  { payloadKey: 'journeyDate', fkey: 'journey_date', label: 'Journey Date (Yatra Tarikh)', placeholder: 'DD/MM/YYYY' },
  {
    payloadKey: 'trainClass',
    fkey: 'train_class',
    label: 'Train Class',
    placeholder: 'Class chuno',
    options: ['All Classes', 'Sleeper (SL)', 'AC 3 Tier (3A)', 'AC 3 Economy (3E)', 'AC 2 Tier (2A)', 'AC First Class (1A)', 'AC Chair Car (CC)', 'Second Sitting (2S)'],
  },
  {
    payloadKey: 'trainQuota',
    fkey: 'train_quota',
    label: 'Quota',
    placeholder: 'Quota chuno',
    options: ['GENERAL', 'TATKAL', 'PREMIUM TATKAL', 'LADIES', 'LOWER BERTH/SR.CITIZEN'],
  },
  {
    payloadKey: 'berthPreference',
    fkey: 'berth_preference',
    label: 'Seat / Berth Preference',
    placeholder: 'Berth chuno',
    options: ['No Preference', 'Lower', 'Middle', 'Upper', 'Side Lower', 'Side Upper'],
  },
  { payloadKey: 'fullName', fkey: 'full_name', label: 'Full Name', placeholder: 'Aadhaar jaisa poora naam' },
  { payloadKey: 'dob', fkey: 'dob', label: 'Date of Birth', placeholder: 'DD/MM/YYYY' },
  { payloadKey: 'fatherName', fkey: 'father_name', label: 'Father Name', placeholder: 'Pita ka poora naam' },
  { payloadKey: 'motherName', fkey: 'mother_name', label: 'Mother Name', placeholder: 'Mata ka poora naam' },
  { payloadKey: 'gender', fkey: 'gender', label: 'Gender', placeholder: 'Male / Female / Other', options: ['Male', 'Female', 'Other'] },
  { payloadKey: 'category', fkey: 'category', label: 'Category', placeholder: 'General / OBC / SC / ST', options: ['General', 'OBC', 'SC', 'ST', 'EWS'] },
  { payloadKey: 'maritalStatus', fkey: 'marital_status', label: 'Marital Status', placeholder: 'Single / Married', options: ['Single', 'Married', 'Divorced', 'Widowed'] },
  { payloadKey: 'mobile', fkey: 'mobile', label: 'Mobile Number', placeholder: '10 digit mobile', inputMode: 'tel' },
  { payloadKey: 'email', fkey: 'email', label: 'Email ID', placeholder: 'name@gmail.com', inputMode: 'email' },
  { payloadKey: 'aadhaarNumber', fkey: 'aadhaar_number', label: 'Aadhaar Number (12 digit)', placeholder: '12 digit Aadhaar (optional)', inputMode: 'numeric' },
  { payloadKey: 'panNumber', fkey: 'pan_number', label: 'PAN Number', placeholder: 'ABCDE1234F' },
  {
    payloadKey: 'tenthBoard',
    fkey: 'tenth_board',
    label: '10th Board Name',
    placeholder: 'jaise CBSE / Bihar Board (BSEB) / UP Board',
    options: ['CBSE', 'Bihar School Examination Board (BSEB)', 'UP Board (UPMSP)', 'ICSE / CISCE', 'Jharkhand Academic Council (JAC)', 'MPBSE', 'RBSE', 'NIOS', 'West Bengal Board (WBBSE)', 'Maharashtra State Board'],
  },
  { payloadKey: 'tenthRoll', fkey: 'tenth_roll', label: '10th Roll Number', placeholder: 'Matric roll number' },
  { payloadKey: 'tenthYear', fkey: 'tenth_year', label: '10th Passing Year', placeholder: 'jaise 2020', inputMode: 'numeric' },
  { payloadKey: 'tenthPercent', fkey: 'tenth_percent', label: '10th Percentage / CGPA', placeholder: 'jaise 78.5' },
  { payloadKey: 'addressLine', fkey: 'address', label: 'Address', placeholder: 'Ghar / mohalla / gali' },
  { payloadKey: 'villageOrWard', fkey: 'village_ward', label: 'Village / Ward', placeholder: 'Gaon ya ward' },
  { payloadKey: 'postOffice', fkey: 'post_office', label: 'Post Office', placeholder: 'Daakghar' },
  { payloadKey: 'policeStation', fkey: 'police_station', label: 'Police Station', placeholder: 'Thana' },
  { payloadKey: 'blockOrTehsil', fkey: 'block_tehsil', label: 'Block / Tehsil', placeholder: 'Block ya tehsil' },
  { payloadKey: 'district', fkey: 'district', label: 'District', placeholder: 'Zila' },
  { payloadKey: 'state', fkey: 'state', label: 'State / Rajya', placeholder: 'Rajya chuno' },
  { payloadKey: 'pinCode', fkey: 'pin_code', label: 'PIN Code', placeholder: '6 digit PIN', inputMode: 'numeric' },
  { payloadKey: 'birthPlace', fkey: 'birth_place', label: 'Birth Place', placeholder: 'Janm sthan' },
  { payloadKey: 'bloodGroup', fkey: 'blood_group', label: 'Blood Group', placeholder: 'jaise B+' },
  { payloadKey: 'incomeSource', fkey: 'income_source', label: 'Income Source (kamai ka zariya)', placeholder: 'Salary / Business / House property / Other sources / No income', options: ['Salary', 'Income from Business / Profession', 'Income from House property', 'Income from Other sources', 'Capital Gains', 'No income'] },
  { payloadKey: 'alternateMobile', fkey: 'alternate_mobile', label: 'Alternate Mobile', placeholder: '10 digit mobile', inputMode: 'tel' },
  { payloadKey: 'qualification', fkey: 'qualification', label: 'Qualification', placeholder: 'jaise 12th, Graduate' },
  { payloadKey: 'loginUserId', fkey: 'login_user_id', label: 'Portal User ID / Login ID (agar account hai)', placeholder: 'Optional — login ke liye User ID' },
  { payloadKey: 'loginPassword', fkey: 'login_password', label: 'Portal Password (RAM-only, optional)', placeholder: 'Optional — sirf is session ke liye', inputType: 'password' },
];

// Har form ke liye pehle se pata hai kaun si details lagti hain (AI recipe iske upar aur jodta hai)
const BASELINE_KEYS: Array<{ test: RegExp; keys: string[] }> = [
  {
    test: /irctc|train|ticket|rail/i,
    keys: ['fromStation', 'toStation', 'journeyDate', 'trainClass', 'trainQuota', 'fullName', 'dob', 'gender', 'berthPreference', 'mobile', 'email', 'loginUserId', 'loginPassword'],
  },
  {
    test: /ssc|army|rrb|police|constable|otr|bharti|recruitment|job/i,
    keys: ['aadhaarNumber', 'fullName', 'dob', 'gender', 'category', 'fatherName', 'motherName', 'tenthBoard', 'tenthRoll', 'tenthYear', 'tenthPercent', 'mobile', 'email', 'addressLine', 'district', 'state', 'pinCode', 'loginUserId', 'loginPassword'],
  },
  {
    test: /\bpan\b|protean|tin-nsdl|nsdl|utiitsl|49a|panonline/i,
    keys: ['aadhaarNumber', 'fullName', 'dob', 'gender', 'fatherName', 'motherName', 'mobile', 'email', 'addressLine', 'villageOrWard', 'postOffice', 'district', 'state', 'pinCode', 'incomeSource'],
  },
  {
    test: /parivahan|sarathi|driving|licen[cs]e/i,
    keys: ['aadhaarNumber', 'fullName', 'dob', 'gender', 'fatherName', 'motherName', 'mobile', 'addressLine', 'district', 'state', 'pinCode', 'bloodGroup'],
  },
  {
    test: /passport/i,
    keys: ['fullName', 'dob', 'gender', 'maritalStatus', 'birthPlace', 'fatherName', 'motherName', 'qualification', 'mobile', 'email', 'addressLine', 'district', 'state', 'pinCode', 'loginUserId', 'loginPassword'],
  },
  {
    test: /voter|nvsp|eci\.gov/i,
    keys: ['aadhaarNumber', 'fullName', 'dob', 'gender', 'fatherName', 'mobile', 'addressLine', 'district', 'state', 'pinCode'],
  },
  {
    test: /serviceonline|rtps|edistrict|block|certificate|scholarship/i,
    keys: ['aadhaarNumber', 'fullName', 'dob', 'gender', 'category', 'fatherName', 'motherName', 'mobile', 'email', 'addressLine', 'villageOrWard', 'postOffice', 'policeStation', 'blockOrTehsil', 'district', 'state', 'pinCode'],
  },
];
const GENERIC_KEYS = ['fullName', 'dob', 'gender', 'category', 'fatherName', 'motherName', 'mobile', 'email', 'addressLine', 'district', 'state', 'pinCode'];

function baselineKeysFor(url: string, title: string): string[] {
  const t = `${url} ${title}`;
  const hit = BASELINE_KEYS.find((b) => b.test.test(t));
  return hit ? hit.keys : GENERIC_KEYS;
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
  // Website kholne se pehle: is form ko jo details chahiye (OCR ke neeche hi dikhti hain)
  const [needKeys, setNeedKeys] = useState<string[]>([]);
  const [needDocs, setNeedDocs] = useState<string[]>([]);
  const [needBusy, setNeedBusy] = useState(false);
  const [inlineValues, setInlineValues] = useState<Record<string, string>>({});

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
    setInlineValues({});
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

  const doLaunch = () => {
    if (!activeBrief) return;
    const goalParts = [activeBrief.directFormGoal];
    if (extraNote.trim()) {
      goalParts.push(`User Extra Details: ${extraNote.trim()}`);
    }
    goalParts.push(
      `Direct URL open karein: ${activeBrief.directFormUrl}. Homepage par mat ruko, seedha form fields fill karo. Website khulne ke baad user se koi sawal ya popup mat poochho: jo details pehle li ja chuki hain wahi use karo, dropdown/radio/tick khud chuno. Mobile number daal kar Send OTP khud dabao, OTP user dalega. CAPTCHA aur Payment user karega.`
    );
    setSheetOpen(false);
    onOpenDirectFormBrowser(activeBrief.directFormUrl, goalParts.join(' '));
  };

  // OCR panel ke liye sirf scanned document (user ki khud bhari details wala doc nahi)
  const latestDoc = ephemeralDocs.find((d) => d.id !== MANUAL_DOC_ID) || null;

  // Abhi AI ke paas jo details hain (OCR + user ki bhari hui)
  const knownDetails = useMemo(
    () => {
      try {
        return buildAutoFillPayload({ profile: {} as ProfileVault, ephemeralDocs, zeroSave: true });
      } catch {
        return {} as Record<string, string>; // kuch bhi ho, screen white nahi honi chahiye
      }
    },
    [ephemeralDocs]
  );

  // Form ki poori list: pehle se pata wali + AI recipe (sheet khulte hi, ek baar)
  const briefUrl = activeBrief?.directFormUrl || '';
  const briefTitle = activeBrief?.title || '';
  const briefGoal = activeBrief?.directFormGoal || '';
  useEffect(() => {
    if (!sheetOpen || !briefUrl || loadingBrief) return;
    let cancelled = false;
    const base = baselineKeysFor(briefUrl, briefTitle);
    setNeedKeys(base);
    setNeedDocs([]);
    setNeedBusy(true);
    (async () => {
      try {
        const res = await apiFetchJson<{
          recipe?: { details?: Array<{ key: string }>; documents?: Array<{ label: string }> };
        }>('/api/ai/form-recipe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: briefUrl, title: briefTitle, goal: briefGoal }),
        });
        if (cancelled) return;
        const extra = (res.recipe?.details || []).map((d) => d.key);
        setNeedKeys(Array.from(new Set([...base, ...extra])));
        setNeedDocs((res.recipe?.documents || []).map((d) => d.label).filter(Boolean));
      } catch {
        // server na mile to pehle se pata wali list kaafi hai
      } finally {
        if (!cancelled) setNeedBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sheetOpen, briefUrl, briefTitle, briefGoal, loadingBrief]);

  // Jo details abhi AI ke paas nahi hain (OCR + user ki bhari hui ke baad)
  const inlineFields = useMemo(
    () =>
      DETAIL_FIELDS.filter(
        (f) =>
          needKeys.includes(f.payloadKey) &&
          !(knownDetails[f.payloadKey] || '').trim() &&
          !(f.payloadKey === 'state' && latestDoc) // OCR panel me State picker pehle se hai
      ),
    [needKeys, knownDetails, latestDoc]
  );

  // Bhari hui details save karo aur seedha website kholo (koi popup nahi)
  const launchDirectFormPage = () => {
    if (!activeBrief) return;
    const entries = inlineFields.filter((f) => (inlineValues[f.payloadKey] || '').trim());
    if (entries.length > 0) {
      const exists = ephemeralDocs.some((d) => d.id === MANUAL_DOC_ID);
      if (!exists) {
        onAddEphemeralDoc({
          id: MANUAL_DOC_ID,
          fileName: 'Manual details',
          documentType: 'User Details',
          summary: 'User ne AI ke sawalon ke jawab diye',
          fields: entries.map((f) => ({
            key: f.fkey,
            label: f.label,
            value: (inlineValues[f.payloadKey] || '').trim(),
          })),
          extractedAt: new Date().toISOString(),
        });
      } else {
        entries.forEach((f) =>
          onUpdateEphemeralDocField?.(MANUAL_DOC_ID, f.fkey, f.label, (inlineValues[f.payloadKey] || '').trim())
        );
      }
    }
    setInlineValues({});
    window.setTimeout(doLaunch, 300); // state commit hone do, phir website kholo
  };

  const latestStateVal =
    String(
      latestDoc?.fields?.find(
        (f) => String(f?.key ?? '').toLowerCase() === 'state' || String(f?.label ?? '').toLowerCase() === 'state'
      )?.value ?? ''
    );

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
                {ephemeralDocs.filter((d) => d.id !== MANUAL_DOC_ID).length > 0 && (
                  <span className="text-xs font-semibold text-emerald-700">
                    {ephemeralDocs.filter((d) => d.id !== MANUAL_DOC_ID).length} RAM me scanned
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

            {/* Website kholne se pehle: baaki details yahin (OCR ke neeche), phir koi popup nahi */}
            {(inlineFields.length > 0 || needBusy || needDocs.length > 0) && (
              <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 space-y-2.5">
                <div className="text-xs font-bold text-amber-900">
                  Is form ke liye baaki details (website kholne se pehle)
                </div>
                <p className="text-[11px] text-amber-900/80">
                  Sirf wahi jo OCR se nahi mili. Yahin bhar do. Website khulne ke baad AI koi popup nahi dikhayega,
                  dropdown/tick/next sab khud karega.
                </p>
                {needBusy && inlineFields.length === 0 && (
                  <div className="flex items-center gap-2 text-[11px] text-amber-900">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    AI check kar raha hai is form ko kya chahiye...
                  </div>
                )}
                {inlineFields.length > 0 && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {inlineFields.map((f) => {
                      const opts = f.payloadKey === 'state' ? INDIAN_STATES_AND_UTS : f.options;
                      return (
                        <label key={f.payloadKey} className="block">
                          <span className="block text-[11px] font-semibold text-slate-700 mb-0.5">{f.label}</span>
                          {opts && opts.length > 0 ? (
                            <select
                              value={inlineValues[f.payloadKey] || ''}
                              onChange={(e) => setInlineValues((prev) => ({ ...prev, [f.payloadKey]: e.target.value }))}
                              className="w-full min-h-[40px] px-3 rounded-lg bg-white border border-amber-300 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
                            >
                              <option value="">-- chuno --</option>
                              {opts.map((o) => (
                                <option key={o} value={o}>
                                  {o}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <input
                              type={f.inputType || 'text'}
                              inputMode={f.inputMode || 'text'}
                              value={inlineValues[f.payloadKey] || ''}
                              onChange={(e) => setInlineValues((prev) => ({ ...prev, [f.payloadKey]: e.target.value }))}
                              placeholder={f.placeholder}
                              className="w-full min-h-[40px] px-3 rounded-lg bg-white border border-amber-300 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:outline-none"
                            />
                          )}
                        </label>
                      );
                    })}
                  </div>
                )}
                {needDocs.length > 0 && (
                  <p className="text-[11px] text-amber-900 bg-white/70 border border-amber-200 rounded-lg px-2.5 py-1.5">
                    Documents jo lag sakte hain (upar Upload &amp; OCR se de do): {needDocs.join(' | ')}
                  </p>
                )}
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
                onClick={() => launchDirectFormPage()}
                className="flex-1 min-h-[46px] disabled:opacity-60 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm inline-flex items-center justify-center gap-2 whitespace-nowrap transition-colors"
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
