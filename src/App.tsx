import React, { useCallback, useEffect, useState } from 'react';
import {
  Bot,
  Compass,
  FileSpreadsheet,
  Home,
  Landmark,
  Loader2,
  Server,
  ShieldCheck,
  UserCheck,
} from 'lucide-react';
import type {
  ApplicationDraft,
  ChatMessage,
  EphemeralDocumentExtract,
  PortalBookmark,
  ProfileVault,
  WorkspaceBootstrap,
} from './types';
import { HomePortalSection } from './components/HomePortalSection';
import { DirectorySection } from './components/DirectorySection';
import { AiAgentSection } from './components/AiAgentSection';
import { FormStudioSection } from './components/FormStudioSection';
import { MiniBrowserSection } from './components/MiniBrowserSection';
import { ProfileVaultSection } from './components/ProfileVaultSection';
import {
  apiFetchJson,
  BackendUnavailableError,
  DEFAULT_APK_BACKEND_URL,
  getSavedBackendUrl,
  loadLocalFallbackBootstrap,
  saveLocalFallbackBookmarks,
  saveLocalFallbackProfile,
  setSavedBackendUrl,
} from './lib/api';

type TabKey = 'home' | 'directory' | 'agent' | 'browser' | 'forms' | 'vault';

export function App() {
  const [activeTab, setActiveTab] = useState<TabKey>('home');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [serverOfflineMode, setServerOfflineMode] = useState(false);
  const [serverUrlInput, setServerUrlInput] = useState(
    () => getSavedBackendUrl() || DEFAULT_APK_BACKEND_URL
  );
  const [connectingServer, setConnectingServer] = useState(false);
  const [serverConnectError, setServerConnectError] = useState<string | null>(null);
  const [workspace, setWorkspace] = useState<WorkspaceBootstrap | null>(null);
  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(null);
  const [queuedBrowserUrl, setQueuedBrowserUrl] = useState<string | null>(null);
  const [queuedBrowserGoal, setQueuedBrowserGoal] = useState<string | null>(null);
  const [queuedAiPrompt, setQueuedAiPrompt] = useState<string | null>(null);

  const [zeroSave, setZeroSave] = useState(true);
  const [ephemeralDocs, setEphemeralDocs] = useState<EphemeralDocumentExtract[]>([]);

  const loadWorkspaceData = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    setServerConnectError(null);
    try {
      const data = await apiFetchJson<WorkspaceBootstrap>('/api/bootstrap');
      setWorkspace(data);
      setServerOfflineMode(false);
      if (data.applications.length > 0) {
        setSelectedDraftId((prev) => prev || data.applications[0].id);
      }
    } catch (err) {
      if (err instanceof BackendUnavailableError) {
        const localData = loadLocalFallbackBootstrap();
        setWorkspace(localData);
        setServerOfflineMode(true);
        setServerConnectError(null);
      } else {
        setLoadError(err instanceof Error ? err.message : 'Unable to connect to server');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadWorkspaceData();
  }, [loadWorkspaceData]);

  const handleConnectServer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (connectingServer) return;
    setConnectingServer(true);
    setServerConnectError(null);
    const normalized = setSavedBackendUrl(serverUrlInput);
    setServerUrlInput(normalized);
    try {
      const data = await apiFetchJson<WorkspaceBootstrap>('/api/bootstrap');
      setWorkspace(data);
      setServerOfflineMode(false);
      if (data.applications.length > 0) {
        setSelectedDraftId(data.applications[0].id);
      }
    } catch (err) {
      setServerOfflineMode(true);
      setServerConnectError(
        err instanceof Error
          ? err.message
          : 'Server URL se connect nahi ho saka. Kripya live SarthiAI backend URL check karein.'
      );
    } finally {
      setConnectingServer(false);
    }
  };

  const openUrlInLiveBrowser = (url: string, goal?: string) => {
    setQueuedBrowserUrl(url);
    setQueuedBrowserGoal(goal || null);
    setActiveTab('browser');
  };

  const openAiWithPrompt = (prompt?: string) => {
    if (prompt) setQueuedAiPrompt(prompt);
    setActiveTab('agent');
  };

  const openDraftInStudio = (draftId: string) => {
    setSelectedDraftId(draftId);
    setActiveTab('forms');
  };

  const handleChatUpdate = (messages: ChatMessage[], createdDraft?: ApplicationDraft) => {
    setWorkspace((prev) => {
      if (!prev) return prev;
      const nextApps = createdDraft
        ? [createdDraft, ...prev.applications.filter((a) => a.id !== createdDraft.id)]
        : prev.applications;
      return {
        ...prev,
        chatHistory: messages,
        applications: nextApps,
      };
    });
    if (createdDraft) {
      setSelectedDraftId(createdDraft.id);
    }
  };

  const handleApplicationsChange = (applications: ApplicationDraft[]) => {
    setWorkspace((prev) => (prev ? { ...prev, applications } : prev));
  };

  const handleBookmarksChange = (bookmarks: PortalBookmark[]) => {
    if (serverOfflineMode) {
      saveLocalFallbackBookmarks(bookmarks);
    }
    setWorkspace((prev) => (prev ? { ...prev, bookmarks } : prev));
  };

  const handleSavePortalBookmark = async (portal: { name: string; url: string; note: string }) => {
    if (!workspace) return;
    const exists = workspace.bookmarks.some(
      (b) => b.url.replace(/\/+$/, '').toLowerCase() === portal.url.replace(/\/+$/, '').toLowerCase()
    );
    if (exists) return;
    try {
      const data = await apiFetchJson<{ bookmarks?: PortalBookmark[] }>('/api/bookmarks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: portal.name,
          url: portal.url,
          category: 'general',
          description: portal.note,
        }),
      });
      if (Array.isArray(data.bookmarks)) {
        handleBookmarksChange(data.bookmarks);
        return;
      }
    } catch {
      // fallback locally
    }
    const localBm: PortalBookmark = {
      id: `bm-${Date.now()}`,
      name: portal.name,
      url: portal.url,
      category: 'general',
      description: portal.note,
    };
    handleBookmarksChange([localBm, ...workspace.bookmarks]);
  };

  const handleProfileSaved = (profile: ProfileVault) => {
    if (serverOfflineMode) {
      saveLocalFallbackProfile(profile);
    }
    setWorkspace((prev) => (prev ? { ...prev, profile } : prev));
  };

  const handleAddEphemeralDoc = (doc: EphemeralDocumentExtract) => {
    setEphemeralDocs((prev) => [doc, ...prev]);
  };

  const handleUpdateEphemeralDocField = (docId: string, key: string, label: string, value: string) => {
    setEphemeralDocs((prev) =>
      prev.map((doc) => {
        if (doc.id !== docId) return doc;
        const idx = doc.fields.findIndex(
          (f) => f.key.toLowerCase() === key.toLowerCase()
        );
        const nextFields =
          idx >= 0
            ? doc.fields.map((f, i) => (i === idx ? { ...f, value } : f))
            : [...doc.fields, { key, label, value }];
        return { ...doc, fields: nextFields };
      })
    );
  };

  const handleWipeEphemeralDocs = () => {
    setEphemeralDocs([]);
  };

  const handleWipeAllSession = () => {
    setEphemeralDocs([]);
    if (zeroSave) {
      setWorkspace((prev) =>
        prev
          ? {
              ...prev,
              applications: prev.applications.filter((a) => !a.id.startsWith('temp-app-')),
            }
          : prev
      );
    }
  };

  const activeDraft =
    workspace?.applications.find((a) => a.id === selectedDraftId) ||
    workspace?.applications[0] ||
    null;

  const navItems: { key: TabKey; label: string; shortLabel: string; icon: React.ReactNode }[] = [
    { key: 'home', label: 'Home', shortLabel: 'Home', icon: <Home className="w-4 h-4" /> },
    { key: 'directory', label: 'Portals', shortLabel: 'Portals', icon: <Landmark className="w-4 h-4" /> },
    { key: 'agent', label: 'AI Agent', shortLabel: 'AI Agent', icon: <Bot className="w-4 h-4" /> },
    { key: 'browser', label: 'Live Browser', shortLabel: 'Browser', icon: <Compass className="w-4 h-4" /> },
    {
      key: 'forms',
      label: `Forms (${workspace?.applications.length ?? 0})`,
      shortLabel: 'Forms',
      icon: <FileSpreadsheet className="w-4 h-4" />,
    },
    { key: 'vault', label: 'Vault', shortLabel: 'Vault', icon: <UserCheck className="w-4 h-4" /> },
  ];

  return (
    <div
      className={`min-h-dvh bg-[#F4F6FA] text-slate-900 flex flex-col ${
        activeTab === 'browser' ? 'pb-16 md:pb-2' : 'pb-20 md:pb-6'
      }`}
    >
      {/* Clean 3-Zone Top Bar Contract */}
      <header className="sticky top-0 z-30 bg-[#0B1120] text-white border-b border-slate-800/90">
        <div className="max-w-[1440px] mx-auto px-3 sm:px-6 h-12 sm:h-14 flex items-center justify-between gap-4 sm:gap-8">
          {/* Zone 1: Single-line Brand Wordmark */}
          <button
            type="button"
            onClick={() => setActiveTab('home')}
            className="flex items-center gap-2 shrink-0 whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 rounded-md"
          >
            <span className="w-7 h-7 rounded-lg bg-rose-600 text-white font-display font-bold text-sm flex items-center justify-center">
              S
            </span>
            <span className="font-display font-bold text-[15px] tracking-tight text-white">
              Sarthi Narad
            </span>
          </button>

          {/* Zone 2: Clean Single-Line Navigation Links (Desktop) */}
          <nav className="hidden md:flex items-center gap-6">
            {navItems.map((item) => {
              const active = activeTab === item.key;
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setActiveTab(item.key)}
                  className={`h-14 text-[13px] font-medium inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 border-b-2 transition-colors ${
                    active
                      ? 'border-rose-500 text-white font-semibold'
                      : 'border-transparent text-slate-300 hover:text-white'
                  }`}
                >
                  {item.icon}
                  {item.label}
                </button>
              );
            })}
          </nav>

          {/* Zone 3: Single Primary Control */}
          <div className="flex items-center shrink-0">
            <button
              type="button"
              onClick={() => setZeroSave((v) => !v)}
              title="Toggle Zero-Save RAM-only privacy mode"
              className={`min-h-[34px] px-3 py-1.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors ${
                zeroSave
                  ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                  : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700'
              }`}
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              Zero-Save {zeroSave ? 'ON' : 'OFF'}
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main
        className={`flex-1 w-full mx-auto flex flex-col ${
          activeTab === 'browser'
            ? 'max-w-[1440px] px-2 sm:px-6 py-2.5 sm:py-4 gap-3'
            : 'max-w-7xl px-3 sm:px-6 py-4 sm:py-5 gap-4'
        }`}
      >
        {serverOfflineMode && (
          <form
            onSubmit={handleConnectServer}
            className="px-3 py-2 rounded-xl bg-amber-50 border border-amber-200 flex flex-col sm:flex-row sm:items-center gap-2"
          >
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <Server className="w-4 h-4 text-amber-700 shrink-0" />
              <div className="text-xs text-amber-950 truncate">
                <span className="font-semibold">Standalone:</span> Live AI &amp; Desktop Chromium ke liye server URL connect karein.
              </div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <input
                type="url"
                value={serverUrlInput}
                onChange={(e) => setServerUrlInput(e.target.value)}
                placeholder="https://your-sarthiai-server.app"
                className="min-h-[36px] flex-1 sm:w-64 px-2.5 rounded-lg bg-white border border-amber-300 text-xs font-mono text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:outline-none"
              />
              <button
                type="submit"
                disabled={connectingServer || !serverUrlInput.trim()}
                className="min-h-[36px] px-3.5 rounded-lg bg-[#0B1120] hover:bg-slate-800 disabled:opacity-50 text-white font-semibold text-xs inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
              >
                {connectingServer ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Connect'}
              </button>
            </div>
            {serverConnectError && (
              <div className="text-[11px] text-rose-700 w-full">{serverConnectError}</div>
            )}
          </form>
        )}

        {loading ? (
          <div className="flex-1 py-20 flex flex-col items-center justify-center gap-3 text-slate-600 text-sm">
            <Loader2 className="w-6 h-6 animate-spin text-rose-600" />
            Loading Sarthi Narad Workspace...
          </div>
        ) : loadError || !workspace ? (
          <div className="max-w-lg mx-auto mt-12 p-6 rounded-xl bg-white border border-rose-200 text-sm text-rose-700">
            {loadError || 'Workspace failed to load.'}
          </div>
        ) : (
          <>
            {activeTab === 'home' && (
              <HomePortalSection
                ephemeralDocs={ephemeralDocs}
                zeroSave={zeroSave}
                onAddEphemeralDoc={handleAddEphemeralDoc}
                onUpdateEphemeralDocField={handleUpdateEphemeralDocField}
                onOpenDirectFormBrowser={openUrlInLiveBrowser}
                onOpenAiChat={openAiWithPrompt}
                onOpenFormStudio={() => setActiveTab('forms')}
                onOpenDirectory={() => setActiveTab('directory')}
              />
            )}

            {activeTab === 'directory' && (
              <DirectorySection
                onOpenBrowser={openUrlInLiveBrowser}
                onAskAi={openAiWithPrompt}
                bookmarks={workspace.bookmarks}
                onSaveBookmark={(p) => void handleSavePortalBookmark(p)}
              />
            )}

            {activeTab === 'agent' && (
              <AiAgentSection
                profile={workspace.profile}
                chatHistory={workspace.chatHistory}
                aiConfigured={workspace.aiConfigured}
                ephemeralDocs={ephemeralDocs}
                zeroSave={zeroSave}
                initialPrompt={queuedAiPrompt}
                onConsumeInitialPrompt={() => setQueuedAiPrompt(null)}
                onToggleZeroSave={setZeroSave}
                onAddEphemeralDoc={handleAddEphemeralDoc}
                onUpdateEphemeralDocField={handleUpdateEphemeralDocField}
                onWipeEphemeralDocs={handleWipeEphemeralDocs}
                onChatUpdate={handleChatUpdate}
                onOpenBrowser={openUrlInLiveBrowser}
                onOpenDraft={openDraftInStudio}
                onGoToVault={() => setActiveTab('vault')}
              />
            )}

            {activeTab === 'browser' && (
              <MiniBrowserSection
                initialUrl={queuedBrowserUrl}
                initialGoal={queuedBrowserGoal}
                onConsumeInitial={() => {
                  setQueuedBrowserUrl(null);
                  setQueuedBrowserGoal(null);
                }}
                bookmarks={workspace.bookmarks}
                profile={workspace.profile}
                ephemeralDocs={ephemeralDocs}
                zeroSave={zeroSave}
                serverOfflineMode={serverOfflineMode}
                activeDraft={activeDraft}
                onBookmarksChange={handleBookmarksChange}
                onAddEphemeralDoc={handleAddEphemeralDoc}
                onUpdateEphemeralDocField={handleUpdateEphemeralDocField}
                onWipeAllSession={handleWipeAllSession}
              />
            )}

            {activeTab === 'forms' && (
              <FormStudioSection
                applications={workspace.applications}
                selectedId={selectedDraftId}
                ephemeralDocs={ephemeralDocs}
                zeroSave={zeroSave}
                onToggleZeroSave={setZeroSave}
                onAddEphemeralDoc={handleAddEphemeralDoc}
                onWipeEphemeralDocs={handleWipeEphemeralDocs}
                onSelectId={setSelectedDraftId}
                onApplicationsChange={handleApplicationsChange}
                onOpenBrowser={openUrlInLiveBrowser}
              />
            )}

            {activeTab === 'vault' && (
              <ProfileVaultSection
                profile={workspace.profile}
                onProfileSaved={handleProfileSaved}
              />
            )}
          </>
        )}
      </main>

      {/* Compact Mobile Bottom Navigation */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-white/95 backdrop-blur border-t border-slate-200 pb-safe">
        <div className="grid grid-cols-6 gap-0.5 px-1 py-1">
          {navItems.map((item) => {
            const active = activeTab === item.key;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => setActiveTab(item.key)}
                className={`min-h-[44px] rounded-lg flex flex-col items-center justify-center gap-0.5 text-[10px] font-semibold transition-colors ${
                  active
                    ? 'bg-[#0B1120] text-white'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {item.icon}
                <span className="truncate max-w-full px-0.5">{item.shortLabel}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}

export default App;
