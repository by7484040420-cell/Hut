import React, { useState } from 'react';
import {
  ArrowUpRight,
  Check,
  Compass,
  Copy,
  Download,
  FileText,
  Loader2,
  Printer,
  Save,
  ShieldCheck,
  Sparkles,
  Trash2,
} from 'lucide-react';
import type {
  AppCategory,
  ApplicationDraft,
  EphemeralDocumentExtract,
} from '../types';
import { CATEGORY_LABELS, formatIsoTime } from '../lib/format';
import { apiFetchJson } from '../lib/api';

interface FormStudioSectionProps {
  applications: ApplicationDraft[];
  selectedId: string | null;
  ephemeralDocs: EphemeralDocumentExtract[];
  zeroSave: boolean;
  onToggleZeroSave: (val: boolean) => void;
  onAddEphemeralDoc: (doc: EphemeralDocumentExtract) => void;
  onWipeEphemeralDocs: () => void;
  onSelectId: (id: string | null) => void;
  onApplicationsChange: (applications: ApplicationDraft[]) => void;
  onOpenBrowser: (url: string, goal?: string) => void;
}

const CATEGORIES: { id: AppCategory; label: string; placeholder: string }[] = [
  {
    id: 'job',
    label: 'Job Application (SSC / Army / Railway)',
    placeholder: 'e.g. SSC GD / Join Indian Army / RRB Group D direct form fill karo',
  },
  {
    id: 'court_block',
    label: 'Court / Kachahari / Block Application',
    placeholder: 'e.g. BDO Block office me Aay / Niwas Praman Patra ya Court haziri application likho',
  },
  {
    id: 'pan',
    label: 'PAN Card (New / Correction)',
    placeholder: 'e.g. NSDL se Naya PAN Card Form 49A bharne ke liye form ready karo',
  },
  {
    id: 'passport',
    label: 'Passport Seva',
    placeholder: 'e.g. Fresh Normal Passport 36 pages application ready karo',
  },
  {
    id: 'dl',
    label: 'Driving License (LL / DL)',
    placeholder: 'e.g. Parivahan Sarathi par Motorcycle + LMV Learner License form ready karo',
  },
  {
    id: 'ticket',
    label: 'Train / Flight Ticket & IRCTC Account',
    placeholder: 'e.g. IRCTC account registration aur Patna se Delhi train ticket booking ready karo',
  },
  {
    id: 'hotel',
    label: 'Hotel Booking Plan',
    placeholder: 'e.g. New Delhi Railway Station ke paas budget family hotel options & guest form ready karo',
  },
  {
    id: 'custom',
    label: 'Any Other Online Form',
    placeholder: 'e.g. Scholarship / Ration Card / Voter ID / Bank KYC form fill karo',
  },
];

export const FormStudioSection: React.FC<FormStudioSectionProps> = ({
  applications,
  selectedId,
  ephemeralDocs,
  zeroSave,
  onWipeEphemeralDocs,
  onSelectId,
  onApplicationsChange,
  onOpenBrowser,
}) => {
  const [category, setCategory] = useState<AppCategory>('job');
  const [goal, setGoal] = useState('');
  const [targetUrl, setTargetUrl] = useState('');
  const [language, setLanguage] = useState<'hinglish' | 'hindi' | 'english'>('hinglish');
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const selected =
    applications.find((a) => a.id === selectedId) || applications[0] || null;

  const activeCategoryMeta = CATEGORIES.find((c) => c.id === category) || CATEGORIES[0];

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!goal.trim() || generating) return;

    setGenerating(true);
    setError(null);
    try {
      const data = await apiFetchJson<{
        zeroSave?: boolean;
        draft?: ApplicationDraft;
        applications?: ApplicationDraft[];
      }>('/api/ai/autofill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category,
          goal: goal.trim(),
          targetUrl: targetUrl.trim() || undefined,
          language,
          zeroSave,
          ephemeralDocs,
        }),
      });
      if (data.zeroSave && data.draft) {
        onApplicationsChange([data.draft, ...applications]);
        onSelectId(data.draft.id);
      } else if (Array.isArray(data.applications)) {
        onApplicationsChange(data.applications);
        if (data.draft?.id) {
          onSelectId(data.draft.id);
        }
      }
      setGoal('');
      setTargetUrl('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to generate application');
    } finally {
      setGenerating(false);
    }
  };

  const updateSelectedField = (idx: number, value: string) => {
    if (!selected) return;
    const nextFields = selected.fields.map((f, i) =>
      i === idx
        ? { ...f, value, source: value.trim() ? ('vault' as const) : ('needs_input' as const) }
        : f
    );
    const nextList = applications.map((a) =>
      a.id === selected.id ? { ...a, fields: nextFields } : a
    );
    onApplicationsChange(nextList);
  };

  const updateLetterText = (text: string) => {
    if (!selected) return;
    const nextList = applications.map((a) =>
      a.id === selected.id ? { ...a, formalLetterText: text } : a
    );
    onApplicationsChange(nextList);
  };

  const saveDraftEdits = async () => {
    if (!selected || saving) return;
    if (selected.id.startsWith('temp-app-')) {
      const nextList = applications.map((a) =>
        a.id === selected.id
          ? {
              ...a,
              status: selected.fields.some((f) => !f.value.trim())
                ? ('needs_review' as const)
                : ('draft_ready' as const),
              updatedAt: new Date().toISOString(),
            }
          : a
      );
      onApplicationsChange(nextList);
      return;
    }
    setSaving(true);
    try {
      const data = await apiFetchJson<{ applications?: ApplicationDraft[] }>(
        `/api/applications/${selected.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fields: selected.fields,
            formalLetterText: selected.formalLetterText,
            status: selected.fields.some((f) => !f.value.trim())
              ? 'needs_review'
              : 'draft_ready',
          }),
        }
      );
      if (Array.isArray(data.applications)) {
        onApplicationsChange(data.applications);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save changes');
    } finally {
      setSaving(false);
    }
  };

  const deleteDraft = async (id: string) => {
    if (id.startsWith('temp-app-')) {
      const next = applications.filter((a) => a.id !== id);
      onApplicationsChange(next);
      if (selectedId === id) {
        onSelectId(next[0]?.id || null);
      }
      return;
    }
    try {
      const data = await apiFetchJson<{ applications?: ApplicationDraft[] }>(
        `/api/applications/${id}`,
        { method: 'DELETE' }
      );
      if (Array.isArray(data.applications)) {
        onApplicationsChange(data.applications);
        if (selectedId === id) {
          onSelectId(data.applications[0]?.id || null);
        }
      }
    } catch {
      const next = applications.filter((a) => a.id !== id);
      onApplicationsChange(next);
      if (selectedId === id) {
        onSelectId(next[0]?.id || null);
      }
    }
  };

  const copyText = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(key);
      setTimeout(() => setCopiedId(null), 1600);
    } catch {
      // ignore
    }
  };

  const downloadDraftTxt = (draft: ApplicationDraft) => {
    const lines = [
      draft.title,
      `Portal: ${draft.portalName} (${draft.portalUrl})`,
      '',
      '--- AUTO-FILLED FORM FIELDS ---',
      ...draft.fields.map((f) => `${f.label}: ${f.value || '[NEEDS INPUT]'}`),
      '',
    ];
    if (draft.formalLetterText) {
      lines.push('--- FORMAL APPLICATION / LETTER ---', draft.formalLetterText, '');
    }
    if (draft.documentChecklist.length > 0) {
      lines.push('--- DOCUMENT CHECKLIST ---', ...draft.documentChecklist.map((d) => `- ${d}`), '');
    }
    if (draft.actionSteps.length > 0) {
      lines.push('--- SUBMISSION STEPS ---', ...draft.actionSteps.map((s, i) => `${i + 1}. ${s}`));
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${draft.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-5">
      {ephemeralDocs.length > 0 && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
          <span className="text-emerald-900 font-medium">
            Active OCR Docs in RAM ({ephemeralDocs.length}):{' '}
            {ephemeralDocs.map((d) => d.documentType).join(', ')} (Not saved to disk)
          </span>
          <button
            type="button"
            onClick={onWipeEphemeralDocs}
            className="text-rose-700 font-semibold hover:underline"
          >
            Wipe RAM
          </button>
        </div>
      )}

      {/* AI Form Generator Card */}
      <form
        onSubmit={handleGenerate}
        className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-base font-bold text-slate-900">
              AI Smart Auto-Fill Form Studio
            </h1>
            <p className="text-xs text-slate-600 mt-0.5">
              {zeroSave
                ? 'Zero-Save RAM Mode · Document details won’t be stored permanently'
                : 'Live internet research + automatic form filling from your Profile Vault'}
            </p>
          </div>
          <div className="flex items-center gap-1 bg-slate-100 border border-slate-200 rounded-xl p-1">
            {(['hinglish', 'hindi', 'english'] as const).map((lang) => (
              <button
                key={lang}
                type="button"
                onClick={() => setLanguage(lang)}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold capitalize transition-colors ${
                  language === lang
                    ? 'bg-[#0F172A] text-white'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {lang}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
          <div className="md:col-span-4">
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              Application Category
            </label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as AppCategory)}
              className="w-full min-h-[44px] px-3 rounded-xl bg-slate-50 border border-slate-200 text-sm text-slate-900 focus:border-slate-900 focus:bg-white focus:outline-none"
            >
              {CATEGORIES.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>

          <div className="md:col-span-8">
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              Optional Direct Portal URL
            </label>
            <input
              type="url"
              value={targetUrl}
              onChange={(e) => setTargetUrl(e.target.value)}
              placeholder="https://... (leave blank so AI picks the direct form URL automatically)"
              className="w-full min-h-[44px] px-3.5 rounded-xl bg-slate-50 border border-slate-200 text-sm font-mono text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:bg-white focus:outline-none"
            />
          </div>

          <div className="md:col-span-10">
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              What should SarthiAI prepare &amp; fill?
            </label>
            <input
              type="text"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder={activeCategoryMeta.placeholder}
              className="w-full min-h-[44px] px-3.5 rounded-xl bg-slate-50 border border-slate-200 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:bg-white focus:outline-none"
            />
          </div>

          <div className="md:col-span-2 flex items-end">
            <button
              type="submit"
              disabled={generating || !goal.trim()}
              className="w-full min-h-[44px] px-4 rounded-xl bg-[#0F172A] hover:bg-slate-800 disabled:opacity-50 text-white font-semibold text-sm inline-flex items-center justify-center gap-2 transition-colors"
            >
              {generating ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Sparkles className="w-4 h-4 text-rose-400" />
              )}
              Auto-Fill
            </button>
          </div>
        </div>

        {error && (
          <div className="px-4 py-2.5 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700">
            {error}
          </div>
        )}
      </form>

      {/* Saved Drafts Master-Detail View */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <aside className="lg:col-span-4 space-y-2.5">
          <div className="flex items-center justify-between px-1">
            <h2 className="text-sm font-bold text-slate-900">
              Prepared Forms ({applications.length})
            </h2>
          </div>

          {applications.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-2xl p-5 text-xs text-slate-600 leading-relaxed">
              Abhi koi form draft nahi hai. Upar category select karke request bhejein — AI direct portal dhundh kar aapka form auto-fill kar dega.
            </div>
          ) : (
            <div className="space-y-2">
              {applications.map((item) => {
                const isActive = selected?.id === item.id;
                return (
                  <div
                    key={item.id}
                    className={`rounded-2xl border p-3.5 transition-colors cursor-pointer bg-white ${
                      isActive
                        ? 'border-slate-900'
                        : 'border-slate-200 hover:border-slate-400'
                    }`}
                    onClick={() => onSelectId(item.id)}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-emerald-700">
                          {CATEGORY_LABELS[item.category]}
                        </div>
                        <div className="text-sm font-bold text-slate-900 truncate mt-0.5">
                          {item.title}
                        </div>
                        <div className="text-[11px] text-slate-500 mt-1">
                          {item.portalName} · {formatIsoTime(item.updatedAt)}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteDraft(item.id);
                        }}
                        aria-label="Delete draft"
                        className="p-1.5 text-slate-400 hover:text-rose-600 shrink-0"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </aside>

        {/* Selected Application Detail */}
        <section className="lg:col-span-8">
          {!selected ? (
            <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center text-sm text-slate-500">
              Select a form draft to review, edit, print, or open its direct page in Live Browser.
            </div>
          ) : (
            <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-5">
              <div className="flex flex-wrap items-start justify-between gap-3 pb-4 border-b border-slate-200">
                <div className="space-y-1">
                  <div className="text-xs text-slate-600">
                    {CATEGORY_LABELS[selected.category]} · {selected.portalName} ·{' '}
                    <span
                      className={
                        selected.status === 'draft_ready'
                          ? 'text-emerald-700 font-semibold'
                          : 'text-amber-700 font-semibold'
                      }
                    >
                      {selected.status === 'draft_ready'
                        ? 'All Fields Filled'
                        : 'Needs Review'}
                    </span>
                  </div>
                  <h2 className="text-lg font-bold text-slate-900">{selected.title}</h2>
                  <p className="text-xs text-slate-600 leading-relaxed">{selected.summary}</p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      onOpenBrowser(
                        selected.portalUrl,
                        `Open direct form page at ${selected.portalUrl} for "${selected.title}" and auto-fill fields. Pause at CAPTCHA/OTP.`
                      )
                    }
                    className="min-h-[40px] px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs inline-flex items-center gap-1.5"
                  >
                    <Compass className="w-3.5 h-3.5" />
                    Open Direct Form
                  </button>
                  <button
                    type="button"
                    onClick={() => downloadDraftTxt(selected)}
                    className="min-h-[40px] px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 hover:border-slate-400 text-xs font-semibold text-slate-800 inline-flex items-center gap-1.5"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Export .TXT
                  </button>
                  <button
                    type="button"
                    onClick={() => window.print()}
                    className="min-h-[40px] px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 hover:border-slate-400 text-xs font-semibold text-slate-800 inline-flex items-center gap-1.5"
                  >
                    <Printer className="w-3.5 h-3.5" />
                    Print
                  </button>
                </div>
              </div>

              {/* Editable Auto-Filled Form Fields */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-slate-900">
                    Auto-Filled Form Fields
                  </h3>
                  <button
                    type="button"
                    onClick={saveDraftEdits}
                    disabled={saving}
                    className="min-h-[36px] px-3 py-1.5 rounded-lg bg-emerald-50 border border-emerald-300 text-xs font-semibold text-emerald-800 inline-flex items-center gap-1.5"
                  >
                    <Save className="w-3.5 h-3.5" />
                    {saving ? 'Saving...' : 'Save Changes'}
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {selected.fields.map((field, idx) => (
                    <div
                      key={`${field.key}-${idx}`}
                      className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <label className="text-xs font-semibold text-slate-700">
                          {field.label}
                        </label>
                        <button
                          type="button"
                          onClick={() => copyText(`f-${idx}`, field.value)}
                          disabled={!field.value}
                          className="text-[11px] font-semibold text-slate-500 hover:text-slate-900 inline-flex items-center gap-1 disabled:opacity-40"
                        >
                          {copiedId === `f-${idx}` ? (
                            <>
                              <Check className="w-3 h-3 text-emerald-600" />
                              Copied
                            </>
                          ) : (
                            <>
                              <Copy className="w-3 h-3" />
                              Copy
                            </>
                          )}
                        </button>
                      </div>
                      <input
                        type="text"
                        value={field.value}
                        onChange={(e) => updateSelectedField(idx, e.target.value)}
                        placeholder={field.notes || 'Enter missing value'}
                        className={`w-full min-h-[38px] px-3 rounded-lg bg-white border text-xs text-slate-900 focus:outline-none ${
                          field.value.trim()
                            ? 'border-slate-200 focus:border-slate-900'
                            : 'border-amber-400 focus:border-amber-600'
                        }`}
                      />
                    </div>
                  ))}
                </div>
              </div>

              {selected.formalLetterText !== undefined && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-slate-900 inline-flex items-center gap-1.5">
                      <FileText className="w-4 h-4 text-emerald-700" />
                      Ready Application Letter (Court / Block / Office)
                    </h3>
                    <button
                      type="button"
                      onClick={() => copyText('letter', selected.formalLetterText || '')}
                      className="min-h-[34px] px-3 rounded-lg bg-slate-50 border border-slate-200 text-xs font-semibold text-slate-800 inline-flex items-center gap-1.5"
                    >
                      {copiedId === 'letter' ? (
                        <Check className="w-3.5 h-3.5 text-emerald-600" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                      Copy Letter
                    </button>
                  </div>
                  <textarea
                    rows={8}
                    value={selected.formalLetterText}
                    onChange={(e) => updateLetterText(e.target.value)}
                    className="w-full p-3.5 rounded-xl bg-slate-50 border border-slate-200 focus:border-slate-900 focus:bg-white focus:outline-none text-xs leading-relaxed text-slate-900"
                  />
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {selected.documentChecklist.length > 0 && (
                  <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                    <div className="text-xs font-bold text-slate-900">
                      Documents Required
                    </div>
                    <ul className="space-y-1.5 text-xs text-slate-700 list-disc pl-4">
                      {selected.documentChecklist.map((doc, i) => (
                        <li key={i}>{doc}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {selected.actionSteps.length > 0 && (
                  <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                    <div className="text-xs font-bold text-slate-900">
                      Submission Guide
                    </div>
                    <ol className="space-y-1.5 text-xs text-slate-700 list-decimal pl-4">
                      {selected.actionSteps.map((step, i) => (
                        <li key={i}>{step}</li>
                      ))}
                    </ol>
                  </div>
                )}
              </div>

              {selected.humanVerificationNotes.length > 0 && (
                <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 space-y-1.5">
                  <div className="text-xs font-bold text-amber-900 inline-flex items-center gap-1.5">
                    <ShieldCheck className="w-4 h-4" />
                    Final User Verification Steps (OTP / CAPTCHA / Payment)
                  </div>
                  <ul className="space-y-1 text-xs text-amber-950 list-disc pl-4">
                    {selected.humanVerificationNotes.map((note, i) => (
                      <li key={i}>{note}</li>
                    ))}
                  </ul>
                </div>
              )}

              {selected.sources && selected.sources.length > 0 && (
                <div className="pt-2 border-t border-slate-200 space-y-1.5">
                  <div className="text-[11px] font-semibold text-slate-500">
                    Verified Direct Links
                  </div>
                  <div className="flex flex-wrap gap-3">
                    {selected.sources.map((src) => (
                      <button
                        key={src.uri}
                        type="button"
                        onClick={() => onOpenBrowser(src.uri)}
                        className="text-xs text-sky-700 hover:text-sky-900 underline underline-offset-2 inline-flex items-center gap-1"
                      >
                        <span className="truncate max-w-[260px]">{src.title}</span>
                        <ArrowUpRight className="w-3 h-3 shrink-0" />
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
};
