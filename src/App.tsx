import React, { useCallback, useEffect, useState } from 'react';
import {
  Bot,
  Compass,
  FileSpreadsheet,
  Home,
  Loader2,
  Monitor,
  Server,
  ShieldCheck,
  Smartphone,
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
import { AiAgentSection } from './components/AiAgentSection';
import { FormStudioSection } from './components/FormStudioSection';
import { MiniBrowserSection } from './components/MiniBrowserSection';
import { ProfileVaultSection } from './components/ProfileVaultSection';
import { PWAInstallButton } from './components/PWAInstallButton';
import {
  apiFetchJson,
  BackendUnavailableError,
  getSavedBackendUrl,
  getSavedViewMode,
  loadLocalFallbackBootstrap,
  saveLocalFallbackBookmarks,
  saveLocalFallbackProfile,
  setSavedBackendUrl,
  setSavedViewMode,
  type AppViewMode,
} from './lib/api';

type TabKey = 'home' | 'agent' | 'browser' | 'forms' | 'vault';

export function App() {
  const [activeTab, setActiveTab] = useState<TabKey>('home');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [serverOfflineMode, setServerOfflineMode] = useState(false);
  const [serverUrlInput, setServerUrlInput] = useState(() => getSavedBackendUrl());
  const [connectingServer, setConnectingServer] = useState(false);
  const [serverConnectError, setServerConnectError] = useState<string | null>(null);
  const [workspace, setWorkspace] = useState<WorkspaceBootstrap | null>(null);
  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(null);
  const [queuedBrowserUrl, setQueuedBrowserUrl] = useState<string | null>(null);
  const [queuedBrowserGoal, setQueuedBrowserGoal] = useState<string | null>(null);
  const [queuedAiPrompt, setQueuedAiPrompt] = useState<string | null>(null);

  // Ephemeral RAM-only document extractions & Zero-Save privacy toggle (default ON)
  const [zeroSave, setZeroSave] = useState(true);
  const [ephemeralDocs, setEphemeralDocs] = useState<EphemeralDocumentExtract[]>([]);
  const [viewMode, setViewMode] = useState<AppViewMode>(() => getSavedViewMode());

  const toggleViewMode = () => {
    const next: AppViewMode = viewMode === 'desktop' ? 'mobile' : 'desktop';
    setViewMode(next);
    setSavedViewMode(next);
  };

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

  const handleProfileSaved = (profile: ProfileVault) => {
    if (serverOfflineMode) {
      saveLocalFallbackProfile(profile);
    }
    setWorkspace((prev) => (prev ? { ...prev, profile } : prev));
  };

  const handleAddEphemeralDoc = (doc: EphemeralDocumentExtract) => {
    setEphemeralDocs((prev) => [doc, ...prev]);
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
    { key: 'agent', label: 'AI Agent', shortLabel: 'AI Agent', icon: <Bot className="w-4 h-4" /> },
    { key: 'browser', label: 'Live Browser', shortLabel: 'Browser', icon: <Compass className="w-4 h-4" /> },
    {
      key: 'forms',
      label: `Forms (${workspace?.applications.length ?? 0})`,
      shortLabel: 'Forms',
      icon: <FileSpreadsheet className="w-4 h-4" />,
    },
    { key: 'vault', label: 'Profile Vault', shortLabel: 'Vault', icon: <UserCheck className="w-4 h-4" /> },
  ];

  return (
    <div
      className={`min-h-screen bg-[#F6F8FB] text-slate-900 flex flex-col ${
        viewMode === 'desktop' ? 'pb-4' : 'pb-20 md:pb-4'
      }`}
    >
      {/* Crisp 3-Zone Navy Header matching Reference Screenshot */}
      <header className="sticky top-0 z-30 bg-[#0F172A] text-white border-b border-slate-800 pt-safe">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between gap-6">
          {/* Zone 1: Brand Wordmark */}
          <button
            type="button"
            onClick={() => setActiveTab('home')}
            className="flex items-center gap-2.5 shrink-0 whitespace-nowrap"
          >
            <span className="w-8 h-8 rounded-lg bg-rose-600 text-white font-display font-bold text-sm flex items-center justify-center">
              S
            </span>
            <span className="font-display font-bold text-base tracking-tight text-white">
              SarthiAI
            </span>
          </button>

          {/* Zone 2: Clean Single-Line Navigation Links */}
          <nav className="hidden md:flex items-center gap-6">
            {navItems.map((item) => {
              const active = activeTab === item.key;
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setActiveTab(item.key)}
                  className={`min-h-[40px] py-2 text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 border-b-2 transition-colors ${
                    active
                      ? 'border-rose-500 text-white'
                      : 'border-transparent text-slate-300 hover:text-white'
                  }`}
                >
                  {item.icon}
                  {item.label}
                </button>
              );
            })}
          </nav>

          {/* Zone 3: View Mode & Zero-Save Controls */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={toggleViewMode}
              title="Switch between Laptop Full-Display and Mobile layout"
              className="min-h-[36px] px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors"
            >
              {viewMode === 'desktop' ? (
                <Monitor className="w-3.5 h-3.5 text-sky-400" />
              ) : (
                <Smartphone className="w-3.5 h-3.5 text-sky-400" />
              )}
              {viewMode === 'desktop' ? 'Laptop View' : 'Mobile View'}
            </button>
            <button
              type="button"
              onClick={() => setZeroSave((v) => !v)}
              title="Toggle Zero-Save RAM-only privacy mode"
              className={`min-h-[36px] px-3 py-1.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors ${
                zeroSave
                  ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                  : 'bg-slate-800 hover:bg-slate-700 text-slate-200'
              }`}
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              Zero-Save {zeroSave ? 'ON' : 'OFF'}
            </button>
            <PWAInstallButton />
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 py-5 space-y-4">
        {serverOfflineMode && (
          <form
            onSubmit={handleConnectServer}
            className="p-3.5 rounded-2xl bg-amber-50 border border-amber-300 flex flex-col sm:flex-row sm:items-center gap-2.5"
          >
            <div className="flex items-start gap-2 flex-1 min-w-0">
              <Server className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
              <div className="text-xs text-amber-950 leading-relaxed">
                <span className="font-bold">APK Standalone Mode:</span> Cloud AI Autopilot, OCR &amp; Live Chromium ke liye apna deployed SarthiAI Server URL connect karein — ya Direct Form links phone ke Ad-Blocked browser me kholein.
                {serverConnectError && (
                  <div className="text-[11px] text-rose-700 mt-0.5">{serverConnectError}</div>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <input
                type="url"
                value={serverUrlInput}
                onChange={(e) => setServerUrlInput(e.target.value)}
                placeholder="https://your-sarthiai-server.app"
                className="min-h-[38px] w-full sm:w-72 px-3 rounded-xl bg-white border border-amber-300 text-xs font-mono text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:outline-none"
              />
              <button
                type="submit"
                disabled={connectingServer || !serverUrlInput.trim()}
                className="min-h-[38px] px-4 rounded-xl bg-[#0F172A] hover:bg-slate-800 disabled:opacity-50 text-white font-semibold text-xs inline-flex items-center gap-1.5 shrink-0"
              >
                {connectingServer ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Connect Server'}
              </button>
            </div>
          </form>
        )}

        {loading ? (
          <div className="py-24 flex flex-col items-center justify-center gap-3 text-slate-600 text-sm">
            <Loader2 className="w-6 h-6 animate-spin text-rose-600" />
            Loading SarthiAI Portal...
          </div>
        ) : loadError || !workspace ? (
          <div className="max-w-lg mx-auto mt-12 p-6 rounded-2xl bg-white border border-rose-300 text-sm text-rose-700">
            {loadError || 'Workspace failed to load.'}
          </div>
        ) : (
          <>
            {activeTab === 'home' && (
              <HomePortalSection
                ephemeralDocs={ephemeralDocs}
                zeroSave={zeroSave}
                onAddEphemeralDoc={handleAddEphemeralDoc}
                onOpenDirectFormBrowser={openUrlInLiveBrowser}
                onOpenAiChat={openAiWithPrompt}
                onOpenFormStudio={() => setActiveTab('forms')}
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

      {/* Mobile Bottom Navigation */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-white/95 backdrop-blur border-t border-slate-200 pb-safe">
        <div className="grid grid-cols-5 gap-1 px-1.5 py-1.5">
          {navItems.map((item) => {
            const active = activeTab === item.key;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => setActiveTab(item.key)}
                className={`min-h-[48px] rounded-xl flex flex-col items-center justify-center gap-1 text-[10px] font-semibold transition-colors ${
                  active
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {item.icon}
                <span className="truncate max-w-full px-1">{item.shortLabel}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}

export default App;
