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

interface AiAgentSectionProps {
  profile: ProfileVault;
  chatHistory: ChatMessage[];
  aiConfigured: boolean;
  ephemeralDocs: EphemeralDocumentExtract[];
  zeroSave: boolean;
  onToggleZeroSave: (val: boolean) => void;
  onAddEphemeralDoc: (doc: EphemeralDocumentExtract) => void;
  onWipeEphemeralDocs: () => void;
  onChatUpdate: (messages: ChatMessage[], createdDraft?: ApplicationDraft) => void;
  onOpenBrowser: (url: string, goal?: string) => void;
  onOpenDraft: (draftId: string) => void;
  onGoToVault: () => void;
}

const LIVE_BROWSER_PRESETS = [
  {
    label: 'IRCTC Account + Ticket (Live)',
    url: 'https://www.irctc.co.in',
    goal: 'IRCTC portal par account registration ya mere gaon ke liye train ticket booking page kholo aur meri details fill karo. CAPTCHA aur OTP main khud screen par dalunga.',
  },
  {
    label: 'PAN Card Form 49A (Live)',
    url: 'https://www.onlineservices.nsdl.com/paam/endUserRegisterContact.html',
    goal: 'NSDL PAN Card Form 49A kholo, jo documents/details chahiye wo mango aur form auto-fill karo. CAPTCHA aur OTP main dalunga.',
  },
  {
    label: 'Passport Seva Portal (Live)',
    url: 'https://www.passportindia.gov.in',
    goal: 'Passport Seva portal kholo, jo documents/details chahiye wo mango aur form fill karo. CAPTCHA/OTP main dalunga.',
  },
];

const QUICK_TASKS = [
  {
    label: 'PAN Card Banwana Hai (Form 49A)',
    prompt:
      'Mujhe naya PAN Card banwana hai. Dekho kaun-kaun se documents chahiye, mujhse maango aur OCR se form fill karke NSDL portal link do.',
  },
  {
    label: 'Gaon Jaane Ka Train Ticket + IRCTC',
    prompt:
      'Mujhe apne gaon jaane ke liye train ticket book karna hai (aur zarurat ho toh IRCTC account bhi banana hai). Batao kya details aur station/date chahiye.',
  },
  {
    label: 'Passport / DL Banwana Hai',
    prompt:
      'Mujhe naya Indian Passport ya Driving License banwana hai. Dekho kya-kya documents aur details chahiye, mujhse maango aur OCR se fill karo.',
  },
  {
    label: 'Army / Sarkari Job / Court Form',
    prompt:
      'Mujhe Army / SSC sarkari job ya Court/Block ka form bharna hai. Batao kaun-kaun se documents chahiye, main upload karunga toh details nikal kar form fill kar dena.',
  },
];

export const AiAgentSection: React.FC<AiAgentSectionProps> = ({
  profile,
  chatHistory,
  aiConfigured,
  ephemeralDocs,
  zeroSave,
  onAddEphemeralDoc,
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
          `Maine "${slot.docName}" (${extracted.documentType}) upload kar diya hai. OCR se yeh details mili hain: ${fieldsPreview}. Ab in details se mera requested form auto-fill karke draft ready karo aur official portal link do (Zero-Save mode).`,
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
          text: 'Zero-Save session active hai. Batayein kaunsa form bharna hai ya kaunsi website kholni hai — zarurat ke hisab se main khud document maang lunga!',
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

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
      <input
        ref={slotInputRef}
        type="file"
        accept="image/*,.pdf"
        onChange={handleSlotFileChange}
        className="hidden"
      />

      {/* Left column: Quick Workflows & Live Browser Launchers */}
      <aside className="lg:col-span-4 space-y-4">
        <div className="bg-[#111827] border border-slate-800/80 rounded-2xl p-4 space-y-2.5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-100">Quick AI Workflows</h2>
            {!zeroSave && (
              <button
                type="button"
                onClick={onGoToVault}
                className="text-[11px] text-emerald-400 hover:underline"
              >
                Vault {completion.percent}%
              </button>
            )}
          </div>
          <p className="text-[11px] text-slate-400 leading-relaxed">
            Bas kaam batayein — AI khud check karega ki kya documents chahiye aur wahin chat me maang kar OCR se form bhar dega.
          </p>
          <div className="space-y-2">
            {QUICK_TASKS.map((task) => (
              <button
                key={task.label}
                type="button"
                disabled={sending}
                onClick={() => sendMessage(task.prompt)}
                className="w-full text-left min-h-[42px] px-3.5 py-2 rounded-xl bg-[#0B0F17] border border-slate-800 hover:border-emerald-500/50 text-xs font-medium text-slate-200 transition-colors flex items-center justify-between gap-2 disabled:opacity-50"
              >
                <span>{task.label}</span>
                <Sparkles className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              </button>
            ))}
          </div>
        </div>

        <div className="bg-[#111827] border border-slate-800/80 rounded-2xl p-4 space-y-2.5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-100">
              Launch Live Browser Copilot
            </h2>
            <span className="text-[11px] font-mono text-sky-400">Any Website</span>
          </div>
          <p className="text-[11px] text-slate-400 leading-relaxed">
            Real ad-blocked Chromium screen par koi bhi website chalegi — CAPTCHA aur OTP aap live screen par dalenge.
          </p>
          <div className="space-y-2">
            {LIVE_BROWSER_PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => onOpenBrowser(p.url, p.goal)}
                className="w-full min-h-[42px] px-3.5 py-2 rounded-xl bg-sky-500/15 border border-sky-500/40 hover:bg-sky-500/25 text-xs font-medium text-sky-200 flex items-center justify-between gap-2 transition-colors"
              >
                <span>{p.label}</span>
                <Compass className="w-3.5 h-3.5 text-sky-400 shrink-0" />
              </button>
            ))}
          </div>
        </div>

        {/* Active RAM Documents Pill (only visible once documents are uploaded in this session) */}
        {ephemeralDocs.length > 0 && (
          <div className="bg-[#111827] border border-emerald-500/30 rounded-2xl p-4 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-emerald-300">
                Active RAM Docs ({ephemeralDocs.length})
              </span>
              <button
                type="button"
                onClick={() => {
                  onWipeEphemeralDocs();
                  setCompletedSlots({});
                }}
                className="text-xs text-rose-300 hover:text-rose-200 inline-flex items-center gap-1"
              >
                <Eraser className="w-3.5 h-3.5" />
                Wipe RAM
              </button>
            </div>
            <div className="space-y-1">
              {ephemeralDocs.map((d) => (
                <div
                  key={d.id}
                  className="text-[11px] text-slate-300 truncate bg-[#0B0F17] px-2.5 py-1.5 rounded-lg border border-slate-800"
                >
                  {d.documentType} · {d.fields.length} fields extracted (Not Saved)
                </div>
              ))}
            </div>
          </div>
        )}
      </aside>

      {/* Right column: Live Internet AI Chat Console with Inline Dynamic Document Requests */}
      <section className="lg:col-span-8 bg-[#111827] border border-slate-800/80 rounded-2xl flex flex-col min-h-[580px] max-h-[78vh]">
        <div className="px-5 py-3.5 border-b border-slate-800/80 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Globe className="w-4 h-4 text-sky-400 shrink-0" />
              <h1 className="text-base font-semibold text-slate-100 truncate">
                SarthiAI Live Internet + OCR Agent
              </h1>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              {zeroSave ? 'Zero-Save RAM Only' : 'Profile Vault Active'} · Dynamic Document OCR ·{' '}
              {aiConfigured ? 'AI Ready' : 'Check GEMINI_API_KEY in Settings > Secrets'}
            </p>
          </div>
          <button
            type="button"
            onClick={clearChat}
            title="Clear conversation"
            className="min-h-[40px] px-3 py-1.5 rounded-lg border border-slate-800 hover:border-slate-700 text-xs text-slate-400 hover:text-slate-200 inline-flex items-center gap-1.5 shrink-0"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Clear
          </button>
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto p-5 space-y-4">
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
                      ? 'bg-emerald-500 text-slate-950 font-medium'
                      : 'bg-[#0B0F17] border border-slate-800 text-slate-200'
                  }`}
                >
                  {msg.text}

                  {/* Contextual Inline Document Upload Requests (Only what THIS task needs!) */}
                  {!isUser && msg.requestedDocuments && msg.requestedDocuments.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-slate-800 space-y-2">
                      <div className="text-xs font-semibold text-emerald-300">
                        Is kaam ke liye sirf yeh document upload karein (OCR auto-extract karega, save nahi hoga):
                      </div>
                      <div className="space-y-2">
                        {msg.requestedDocuments.map((docReq) => {
                          const uploadedName = completedSlots[docReq.id];
                          const isUploading = uploadingSlotId === docReq.id;
                          return (
                            <div
                              key={docReq.id}
                              className="p-2.5 rounded-xl bg-[#111827] border border-slate-800 flex flex-wrap items-center justify-between gap-2"
                            >
                              <div className="min-w-0 flex-1">
                                <div className="text-xs font-semibold text-slate-100">
                                  {docReq.name}
                                </div>
                                <div className="text-[11px] text-slate-400">
                                  {docReq.reason}
                                </div>
                              </div>
                              <button
                                type="button"
                                disabled={isUploading || sending}
                                onClick={() => triggerSlotUpload(docReq.id, docReq.name, true)}
                                className={`min-h-[36px] px-3 py-1.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 shrink-0 ${
                                  uploadedName
                                    ? 'bg-emerald-500/20 border border-emerald-500/40 text-emerald-300'
                                    : 'bg-emerald-500 hover:bg-emerald-400 text-slate-950'
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
                    <div className="mt-3 pt-3 border-t border-slate-800 flex flex-wrap gap-2">
                      {msg.linkedApplicationId && (
                        <button
                          type="button"
                          onClick={() => onOpenDraft(msg.linkedApplicationId!)}
                          className="min-h-[38px] px-3 py-1.5 rounded-lg bg-emerald-500/15 border border-emerald-500/40 hover:bg-emerald-500/25 text-xs font-medium text-emerald-300 inline-flex items-center gap-1.5"
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
                              'Open this portal and auto-fill using my details. Pause at CAPTCHA or OTP so I can enter it.'
                            )
                          }
                          className="min-h-[38px] px-3 py-1.5 rounded-lg bg-sky-500/15 border border-sky-500/40 hover:bg-sky-500/25 text-xs font-medium text-sky-300 inline-flex items-center gap-1.5"
                        >
                          <Compass className="w-3.5 h-3.5" />
                          Run Live in Browser
                        </button>
                      )}
                    </div>
                  )}

                  {!isUser && msg.sources && msg.sources.length > 0 && (
                    <div className="mt-3 pt-2.5 border-t border-slate-800/80 space-y-1.5">
                      <div className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">
                        Live Internet Sources
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {msg.sources.slice(0, 6).map((src) => (
                          <button
                            key={src.uri}
                            type="button"
                            onClick={() => onOpenBrowser(src.uri)}
                            className="text-left text-xs text-sky-400 hover:text-sky-300 underline underline-offset-2 inline-flex items-center gap-1 max-w-full truncate"
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
              <div className="rounded-2xl px-4 py-3 bg-[#0B0F17] border border-slate-800 text-xs text-slate-300 inline-flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-emerald-400" />
                Live internet par check aur OCR+AI processing chal raha hai...
              </div>
            </div>
          )}
        </div>

        {error && (
          <div className="mx-5 mb-3 px-4 py-2.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-xs text-rose-300">
            {error}
          </div>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void sendMessage();
          }}
          className="p-4 border-t border-slate-800/80 flex items-end gap-2"
        >
          <button
            type="button"
            title="Attach a document directly for OCR"
            disabled={sending || uploadingSlotId !== null}
            onClick={() => triggerSlotUpload(`manual-${Date.now()}`, 'Attached Document', false)}
            className="min-h-[48px] min-w-[44px] rounded-xl bg-[#0B0F17] border border-slate-700/80 hover:border-emerald-500/60 text-slate-300 hover:text-emerald-300 flex items-center justify-center shrink-0"
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
            placeholder="AI ko batayein: 'Mujhe Passport banwana hai' ya 'https://... website ka form bharna hai'..."
            className="flex-1 resize-none rounded-xl bg-[#0B0F17] border border-slate-700/80 focus:border-emerald-500 focus:outline-none px-3.5 py-2.5 text-sm text-slate-100 placeholder:text-slate-500"
          />
          <button
            type="submit"
            disabled={sending || !input.trim()}
            className="min-h-[48px] px-4 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 font-semibold text-sm inline-flex items-center gap-2 shrink-0 transition-colors"
          >
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            <span className="hidden sm:inline">Run AI</span>
          </button>
        </form>
      </section>
    </div>
  );
};
