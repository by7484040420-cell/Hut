import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowUpRight,
  CheckCircle2,
  Compass,
  Eraser,
  FileCheck2,
  Globe,
  Loader2,
  Paperclip,
  Send,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react';
import type {
  ApplicationDraft,
  ChatMessage,
  EphemeralDocumentExtract,
  ProfileVault,
} from '../types';
import { formatIsoTime, getVaultCompletion } from '../lib/format';
import { apiFetchJson } from '../lib/api';
import { INDIAN_STATES_AND_UTS, resolveIndianState } from '../lib/indianStates';
import { runNativeOnDeviceOcr } from '../lib/nativeBrowserBridge';

interface AiAgentSectionProps {
  profile: ProfileVault;
  chatHistory: ChatMessage[];
  aiConfigured: boolean;
  ephemeralDocs: EphemeralDocumentExtract[];
  zeroSave: boolean;
  initialPrompt?: string | null;
  onConsumeInitialPrompt?: () => void;
  onToggleZeroSave: (val: boolean) => void;
  onAddEphemeralDoc: (doc: EphemeralDocumentExtract) => void;
  onUpdateEphemeralDocField?: (docId: string, key: string, label: string, value: string) => void;
  onWipeEphemeralDocs: () => void;
  onChatUpdate: (messages: ChatMessage[], createdDraft?: ApplicationDraft) => void;
  onOpenBrowser: (url: string, goal?: string) => void;
  onOpenDraft: (draftId: string) => void;
  onGoToVault: () => void;
}

const LIVE_BROWSER_PRESETS = [
  {
    label: 'IRCTC Train Search & Booking (Direct)',
    url: 'https://www.irctc.co.in/nget/train-search',
    goal: 'IRCTC Train Search direct page kholo aur mere gaon ke liye train search / ticket fill karo. CAPTCHA aur OTP main khud dalunga.',
  },
  {
    label: 'PAN Card Form 49A (Direct)',
    url: 'https://onlineservices.proteantech.in/paam/endUserRegisterContact.html',
    goal: 'Protean PAN Card Form 49A direct application page kholo, jo details chahiye auto-fill karo. CAPTCHA aur OTP main dalunga.',
  },
  {
    label: 'SSC Candidate OTR / Apply (Direct)',
    url: 'https://ssc.gov.in/candidate-portal/one-time-registration/home-page',
    goal: 'SSC Candidate OTR / Apply direct form page par meri details fill karo. CAPTCHA/OTP main dalunga.',
  },
];

const QUICK_TASKS = [
  {
    label: 'PAN Card (Fee, Docs & Form 49A)',
    prompt:
      'Mujhe naya PAN Card banwana hai. Pehle batao kitna paisa aur kya document lagega, mujhse upload maango aur direct Form 49A link do.',
  },
  {
    label: 'Gaon Jaane Ka Train Ticket (IRCTC)',
    prompt:
      'Mujhe apne gaon jaane ke liye train ticket book karna hai. Kitna kiraya aur kya details chahiye batao, aur direct train booking page link do.',
  },
  {
    label: 'SSC CGL / GD / Army Job Form',
    prompt:
      'Mujhe SSC ya Army job form bharna hai. Exact fee, eligibility aur required documents batao, main document upload karunga toh OCR se direct form bhar dena.',
  },
  {
    label: 'Court / Block / Aay-Niwas Form',
    prompt:
      'Mujhe Block/Tehsil ya Court ke liye application ya certificate apply karna hai. Kitna fee aur kya documents lagega batao aur direct form taiyaar karo.',
  },
];

export const AiAgentSection: React.FC<AiAgentSectionProps> = ({
  profile,
  chatHistory,
  aiConfigured,
  ephemeralDocs,
  zeroSave,
  initialPrompt,
  onConsumeInitialPrompt,
  onAddEphemeralDoc,
  onUpdateEphemeralDocField,
  onWipeEphemeralDocs,
  onChatUpdate,
  onOpenBrowser,
  onOpenDraft,
  onGoToVault,
}) => {
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [uploadingSlotId, setUploadingSlotId] = useState<string | null>(null);
  const [completedSlots, setCompletedSlots] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const slotInputRef = useRef<HTMLInputElement | null>(null);
  const pendingSlotRef = useRef<{ slotId: string; docName: string; triggerAutoFill: boolean } | null>(null);

  const completion = getVaultCompletion(profile);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [chatHistory, sending]);

  const sendMessage = async (
    textToSend?: string,
    docsOverride?: EphemeralDocumentExtract[],
    historyOverride?: ChatMessage[]
  ) => {
    const prompt = (textToSend ?? input).trim();
    if (!prompt || sending) return;

    setSending(true);
    setError(null);
    if (!textToSend) setInput('');

    const activeHistory = historyOverride ?? chatHistory;
    const activeDocs = docsOverride ?? ephemeralDocs;

    try {
      const data = await apiFetchJson<{
        zeroSave?: boolean;
        userMessage: ChatMessage;
        message: ChatMessage;
        createdDraft?: ApplicationDraft;
        chatHistory: ChatMessage[];
      }>('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          zeroSave,
          ephemeralDocs: activeDocs,
        }),
      });
      if (data.zeroSave) {
        const nextHistory: ChatMessage[] = [
          ...activeHistory,
          data.userMessage,
          data.message,
        ];
        onChatUpdate(nextHistory, data.createdDraft);
      } else {
        onChatUpdate(data.chatHistory, data.createdDraft);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to contact SarthiAI');
    } finally {
      setSending(false);
    }
  };

  useEffect(() => {
    if (initialPrompt && initialPrompt.trim()) {
      const p = initialPrompt.trim();
      onConsumeInitialPrompt?.();
      void sendMessage(p);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPrompt]);

  const triggerSlotUpload = (slotId: string, docName: string, triggerAutoFill: boolean) => {
    pendingSlotRef.current = { slotId, docName, triggerAutoFill };
    slotInputRef.current?.click();
  };

  const handleSlotFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const slot = pendingSlotRef.current;
    e.target.value = '';
    if (!file || !slot) return;

    setUploadingSlotId(slot.slotId);
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
      setCompletedSlots((prev) => ({
        ...prev,
        [slot.slotId]: extracted.fileName,
      }));

      if (slot.triggerAutoFill) {
        const nextDocs = [extracted, ...ephemeralDocs];
        const fieldsPreview = extracted.fields
          .slice(0, 10)
          .map((f) => `${f.label}: ${f.value}`)
          .join(', ');
        await sendMessage(
          `Maine "${slot.docName}" (${extracted.documentType}) upload kar diya hai. OCR se yeh details mili hain: ${fieldsPreview}. Ab in details se mera requested form auto-fill karke draft ready karo aur seedha direct form page link do (Zero-Save mode).`,
          nextDocs,
          chatHistory
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to read uploaded document');
    } finally {
      setUploadingSlotId(null);
      pendingSlotRef.current = null;
    }
  };

  const clearChat = async () => {
    if (zeroSave) {
      onChatUpdate([
        {
          id: `msg-${Date.now()}`,
          role: 'assistant',
          text: 'Zero-Save session active hai. Batayein kaunsa form bharna hai — main fee, documents aur direct form page link nikal kar fill kar dunga!',
          createdAt: new Date().toISOString(),
        },
      ]);
      return;
    }
    try {
      const data = await apiFetchJson<{ chatHistory?: ChatMessage[] }>('/api/chat', {
        method: 'DELETE',
      });
      if (Array.isArray(data.chatHistory)) {
        onChatUpdate(data.chatHistory);
      }
    } catch {
      // ignore
    }
  };

  const latestRamDoc = ephemeralDocs[0] || null;
  const latestRamState = latestRamDoc
    ? resolveIndianState({
        state: latestRamDoc.fields.find(
          (f) => f.key.toLowerCase() === 'state' || f.label.toLowerCase().includes('state')
        )?.value,
        addressLine: latestRamDoc.fields.find((f) => f.key.toLowerCase().includes('address'))?.value,
        pinCode: latestRamDoc.fields.find((f) => f.key.toLowerCase().includes('pin'))?.value,
        district: latestRamDoc.fields.find((f) => f.key.toLowerCase().includes('district'))?.value,
      })
    : '';

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
      <input
        ref={slotInputRef}
        type="file"
        accept="image/*,.pdf"
        onChange={handleSlotFileChange}
        className="hidden"
      />

      {/* Left column: Quick Workflows & Direct Form Launchers */}
      <aside className="lg:col-span-4 space-y-4">
        <div className="bg-white border border-slate-200/90 rounded-2xl p-4 shadow-xs space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-bold font-display text-slate-900">Quick AI Workflows</h2>
            {!zeroSave && (
              <button
                type="button"
                onClick={onGoToVault}
                className="text-xs font-semibold text-emerald-700 hover:underline whitespace-nowrap shrink-0"
              >
                Vault {completion.percent}%
              </button>
            )}
          </div>
          <p className="text-xs text-slate-600 leading-relaxed">
            Bas kaam batayein — AI pehle fee aur documents batayega, phir OCR se details nikal kar direct Desktop form page kholega.
          </p>
          <div className="space-y-2">
            {QUICK_TASKS.map((task) => (
              <button
                key={task.label}
                type="button"
                disabled={sending}
                onClick={() => sendMessage(task.prompt)}
                className="w-full text-left min-h-[42px] px-3.5 py-2 rounded-xl bg-slate-50 border border-slate-200 hover:border-slate-400 hover:bg-white text-xs font-semibold text-slate-800 transition-colors flex items-center justify-between gap-2 disabled:opacity-50"
              >
                <span className="truncate">{task.label}</span>
                <Sparkles className="w-3.5 h-3.5 text-rose-600 shrink-0" />
              </button>
            ))}
          </div>
        </div>

        <div className="bg-white border border-slate-200/90 rounded-2xl p-4 shadow-xs space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-bold font-display text-slate-900">Direct Form Browser</h2>
            <span className="text-[11px] font-mono font-semibold text-sky-700 whitespace-nowrap shrink-0">
              Desktop Mode
            </span>
          </div>
          <p className="text-xs text-slate-600 leading-relaxed">
            Seedha form wale page par jaata hai — CAPTCHA aur OTP aap live Desktop screen par dalenge.
          </p>
          <div className="space-y-2">
            {LIVE_BROWSER_PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => onOpenBrowser(p.url, p.goal)}
                className="w-full min-h-[42px] px-3.5 py-2 rounded-xl bg-slate-50 border border-slate-200 hover:border-slate-900 hover:bg-white text-xs font-semibold text-slate-900 flex items-center justify-between gap-2 transition-colors text-left"
              >
                <span className="truncate">{p.label}</span>
                <Compass className="w-3.5 h-3.5 text-sky-700 shrink-0" />
              </button>
            ))}
          </div>
        </div>

        {latestRamDoc && (
          <div className="bg-white border border-emerald-200 rounded-2xl p-4 shadow-xs space-y-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-bold text-emerald-900">
                Active RAM Docs ({ephemeralDocs.length})
              </span>
              <button
                type="button"
                onClick={() => {
                  onWipeEphemeralDocs();
                  setCompletedSlots({});
                }}
                className="text-xs font-semibold text-rose-700 hover:text-rose-800 inline-flex items-center gap-1 whitespace-nowrap shrink-0"
              >
                <Eraser className="w-3.5 h-3.5" />
                Wipe RAM
              </button>
            </div>

            {onUpdateEphemeralDocField && (
              <div className="space-y-1">
                <label className="block text-[11px] font-semibold text-slate-700">
                  Detected Rajya / State ({latestRamDoc.documentType})
                </label>
                <select
                  value={latestRamState}
                  onChange={(e) =>
                    onUpdateEphemeralDocField(
                      latestRamDoc.id,
                      'state',
                      'State',
                      e.target.value
                    )
                  }
                  className="w-full min-h-[36px] px-2.5 rounded-lg bg-slate-50 border border-slate-200 text-xs font-semibold text-slate-900 focus:border-slate-900 focus:bg-white focus:outline-none"
                >
                  <option value="">-- Select Rajya / State --</option>
                  {INDIAN_STATES_AND_UTS.map((st) => (
                    <option key={st} value={st}>
                      {st}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="grid grid-cols-2 gap-1.5">
              {latestRamDoc.fields.slice(0, 6).map((f, idx) => (
                <div
                  key={`${f.key}-${idx}`}
                  className="px-2 py-1.5 rounded-lg bg-emerald-50/70 border border-emerald-200/80 min-w-0"
                >
                  <div className="text-[10px] text-slate-500 truncate">{f.label}</div>
                  <div className="text-[11px] font-semibold text-slate-900 truncate">{f.value}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </aside>

      {/* Right column: Live Internet AI Chat Console */}
      <section className="lg:col-span-8 bg-white border border-slate-200/90 rounded-2xl shadow-xs flex flex-col min-h-[580px] max-h-[78vh]">
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Globe className="w-4 h-4 text-sky-700 shrink-0" />
              <h1 className="text-base font-bold font-display text-slate-900 truncate">
                SarthiAI Live Internet + OCR Agent
              </h1>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              {zeroSave ? 'Zero-Save RAM Only' : 'Profile Vault Active'} · Dynamic Document OCR ·{' '}
              {aiConfigured ? 'AI Ready' : 'Standalone Mode'}
            </p>
          </div>
          <button
            type="button"
            onClick={clearChat}
            title="Clear conversation"
            className="min-h-[36px] px-3 py-1.5 rounded-lg border border-slate-200 hover:border-slate-400 text-xs font-semibold text-slate-600 hover:text-slate-900 inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Clear
          </button>
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto p-5 space-y-4 bg-slate-50/60">
          {chatHistory.map((msg) => {
            const isUser = msg.role === 'user';
            return (
              <div
                key={msg.id}
                className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}
              >
                <div
                  className={`max-w-[94%] sm:max-w-[84%] rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${
                    isUser
                      ? 'bg-[#0B1120] text-white font-medium'
                      : 'bg-white border border-slate-200 text-slate-800 shadow-xs'
                  }`}
                >
                  {msg.text}

                  {!isUser && msg.requestedDocuments && msg.requestedDocuments.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-slate-200 space-y-2">
                      <div className="text-xs font-bold text-emerald-800">
                        Is kaam ke liye yeh document upload karein (OCR auto-extract karega, save nahi hoga):
                      </div>
                      <div className="space-y-2">
                        {msg.requestedDocuments.map((docReq) => {
                          const uploadedName = completedSlots[docReq.id];
                          const isUploading = uploadingSlotId === docReq.id;
                          return (
                            <div
                              key={docReq.id}
                              className="p-2.5 rounded-xl bg-slate-50 border border-slate-200 flex flex-wrap items-center justify-between gap-2"
                            >
                              <div className="min-w-0 flex-1">
                                <div className="text-xs font-bold text-slate-900">
                                  {docReq.name}
                                </div>
                                <div className="text-[11px] text-slate-600">
                                  {docReq.reason}
                                </div>
                              </div>
                              <button
                                type="button"
                                disabled={isUploading || sending}
                                onClick={() => triggerSlotUpload(docReq.id, docReq.name, true)}
                                className={`min-h-[36px] px-3 py-1.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
                                  uploadedName
                                    ? 'bg-emerald-100 border border-emerald-300 text-emerald-800'
                                    : 'bg-[#0B1120] hover:bg-slate-800 text-white'
                                }`}
                              >
                                {isUploading ? (
                                  <>
                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                    Scanning...
                                  </>
                                ) : uploadedName ? (
                                  <>
                                    <CheckCircle2 className="w-3.5 h-3.5" />
                                    Scanned
                                  </>
                                ) : (
                                  <>
                                    <Upload className="w-3.5 h-3.5" />
                                    Upload &amp; Fill
                                  </>
                                )}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {!isUser && (msg.linkedApplicationId || msg.suggestedUrl) && (
                    <div className="mt-3 pt-3 border-t border-slate-200 flex flex-wrap gap-2">
                      {msg.linkedApplicationId && (
                        <button
                          type="button"
                          onClick={() => onOpenDraft(msg.linkedApplicationId!)}
                          className="min-h-[38px] px-3 py-1.5 rounded-lg bg-emerald-50 border border-emerald-300 hover:bg-emerald-100 text-xs font-semibold text-emerald-800 inline-flex items-center gap-1.5"
                        >
                          <FileCheck2 className="w-3.5 h-3.5" />
                          View Auto-Filled Form
                        </button>
                      )}
                      {msg.suggestedUrl && (
                        <button
                          type="button"
                          onClick={() =>
                            onOpenBrowser(
                              msg.suggestedUrl!,
                              'Open this direct form page and auto-fill using my details. Pause at CAPTCHA or OTP so I can enter it.'
                            )
                          }
                          className="min-h-[38px] px-3 py-1.5 rounded-lg bg-sky-50 border border-sky-300 hover:bg-sky-100 text-xs font-semibold text-sky-900 inline-flex items-center gap-1.5"
                        >
                          <Compass className="w-3.5 h-3.5" />
                          Open Direct Form Page
                        </button>
                      )}
                    </div>
                  )}

                  {!isUser && msg.sources && msg.sources.length > 0 && (
                    <div className="mt-3 pt-2.5 border-t border-slate-200 space-y-1.5">
                      <div className="text-[11px] font-semibold text-slate-500">
                        Verified Direct Links
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {msg.sources.slice(0, 6).map((src) => (
                          <button
                            key={src.uri}
                            type="button"
                            onClick={() => onOpenBrowser(src.uri)}
                            className="text-left text-xs text-sky-700 hover:text-sky-900 underline underline-offset-2 inline-flex items-center gap-1 max-w-full truncate"
                          >
                            <span className="truncate max-w-[240px]">{src.title}</span>
                            <ArrowUpRight className="w-3 h-3 shrink-0" />
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                <span className="text-[11px] text-slate-500 mt-1 px-1">
                  {isUser ? 'You' : 'SarthiAI'} · {formatIsoTime(msg.createdAt)}
                </span>
              </div>
            );
          })}

          {sending && (
            <div className="flex items-start">
              <div className="rounded-2xl px-4 py-3 bg-white border border-slate-200 text-xs text-slate-700 inline-flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-emerald-600" />
                Live internet par fee, documents aur direct form link check ho raha hai...
              </div>
            </div>
          )}
        </div>

        {error && (
          <div className="mx-5 my-2 px-4 py-2.5 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700">
            {error}
          </div>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void sendMessage();
          }}
          className="p-4 border-t border-slate-200 bg-white flex items-end gap-2 rounded-b-2xl"
        >
          <button
            type="button"
            title="Attach a document directly for OCR"
            disabled={sending || uploadingSlotId !== null}
            onClick={() => triggerSlotUpload(`manual-${Date.now()}`, 'Attached Document', false)}
            className="min-h-[48px] min-w-[44px] rounded-xl bg-slate-50 border border-slate-200 hover:border-slate-400 text-slate-700 flex items-center justify-center shrink-0"
          >
            <Paperclip className="w-4 h-4" />
          </button>
          <textarea
            rows={2}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void sendMessage();
              }
            }}
            placeholder="AI ko batayein: 'SSC GD form bharna hai' ya 'PAN card Form 49A fill karo'..."
            className="flex-1 resize-none rounded-xl bg-slate-50 border border-slate-200 focus:border-slate-900 focus:bg-white focus:outline-none px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400"
          />
          <button
            type="submit"
            disabled={sending || !input.trim()}
            className="min-h-[48px] px-4 py-2.5 rounded-xl bg-[#0B1120] hover:bg-slate-800 disabled:opacity-50 text-white font-semibold text-sm inline-flex items-center gap-2 whitespace-nowrap shrink-0 transition-colors"
          >
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            <span className="hidden sm:inline">Run AI</span>
          </button>
        </form>
      </section>
    </div>
  );
};
