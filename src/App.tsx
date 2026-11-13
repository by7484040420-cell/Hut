import React, { useEffect, useState } from 'react';
import {
  Bot,
  Compass,
  FileSpreadsheet,
  Loader2,
  ShieldCheck,
  UserCheck,
  Wifi,
  WifiOff,
} from 'lucide-react';
import type {
  ApplicationDraft,
  ChatMessage,
  EphemeralDocumentExtract,
  PortalBookmark,
  ProfileVault,
  WorkspaceBootstrap,
} from './types';
import { AiAgentSection } from './components/AiAgentSection';
import { FormStudioSection } from './components/FormStudioSection';
import { MiniBrowserSection } from './components/MiniBrowserSection';
import { ProfileVaultSection } from './components/ProfileVaultSection';
import { PWAInstallButton } from './components/PWAInstallButton';
import { useOnlineStatus } from './hooks/usePWAInstall';

type TabKey = 'agent' | 'forms' | 'browser' | 'vault';

export function App() {
  const [activeTab, setActiveTab] = useState<TabKey>('agent');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [workspace, setWorkspace] = useState<WorkspaceBootstrap | null>(null);
  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(null);
  const [queuedBrowserUrl, setQueuedBrowserUrl] = useState<string | null>(null);
  const [queuedBrowserGoal, setQueuedBrowserGoal] = useState<string | null>(null);

  // Ephemeral RAM-only document extractions & Zero-Save privacy toggle (default ON)
  const [zeroSave, setZeroSave] = useState(true);
  const [ephemeralDocs, setEphemeralDocs] = useState<EphemeralDocumentExtract[]>([]);

  const isOnline = useOnlineStatus();

  useEffect(() => {
    let active = true;
    fetch('/api/bootstrap')
      .then(async (res) => {
        if (!res.ok) throw new Error('Failed to load workspace');
        return (await res.json()) as WorkspaceBootstrap;
      })
      .then((data) => {
        if (!active) return;
        setWorkspace(data);
        if (data.applications.length > 0) {
          setSelectedDraftId(data.applications[0].id);
        }
      })
      .catch((err) => {
        if (!active) return;
        setLoadError(err instanceof Error ? err.message : 'Unable to connect to server');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const openUrlInLiveBrowser = (url: string, goal?: string) => {
    setQueuedBrowserUrl(url);
    setQueuedBrowserGoal(goal || null);
    setActiveTab('browser');
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
    setWorkspace((prev) => (prev ? { ...prev, bookmarks } : prev));
  };

  const handleProfileSaved = (profile: ProfileVault) => {
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
    { key: 'agent', label: 'AI Autopilot', shortLabel: 'AI Agent', icon: <Bot className="w-4 h-4" /> },
    {
      key: 'browser',
      label: 'Live Browser',
      shortLabel: 'Browser',
      icon: <Compass className="w-4 h-4" />,
    },
    {
      key: 'forms',
      label: `Form Studio (${workspace?.applications.length ?? 0})`,
      shortLabel: 'Forms',
      icon: <FileSpreadsheet className="w-4 h-4" />,
    },
    {
      key: 'vault',
      label: 'Profile Vault',
      shortLabel: 'Vault',
      icon: <UserCheck className="w-4 h-4" />,
    },
  ];

  return (
    <div className="min-h-screen bg-[#0B0F17] text-slate-100 flex flex-col pb-20 md:pb-0">
      {/* 3-Zone Top Header */}
      <header className="sticky top-0 z-30 bg-[#0B0F17]/95 backdrop-blur border-b border-slate-800/80">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between gap-4">
          {/* Zone 1: Brand */}
          <div className="flex items-center gap-2.5 shrink-0">
            <img src="/icon.svg" alt="SarthiAI" className="w-8 h-8 rounded-lg" />
            <div>
              <div className="font-display font-bold text-base tracking-tight text-white leading-none">
                SarthiAI
              </div>
              <div className="text-[11px] text-slate-400 mt-0.5">
                Live Browser · OCR+AI · Ad-Block
              </div>
            </div>
          </div>

          {/* Zone 2: Primary Desktop Navigation */}
          <nav className="hidden md:flex items-center gap-1.5">
            {navItems.map((item) => {
              const active = activeTab === item.key;
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setActiveTab(item.key)}
                  className={`min-h-[40px] px-3.5 py-2 rounded-xl text-xs font-medium inline-flex items-center gap-2 transition-colors whitespace-nowrap ${
                    active
                      ? 'bg-emerald-500 text-slate-950 font-semibold'
                      : 'text-slate-300 hover:bg-slate-800/70 hover:text-white'
                  }`}
                >
                  {item.icon}
                  {item.label}
                </button>
              );
            })}
          </nav>

          {/* Zone 3: Zero-Save Status, Network & PWA Install */}
          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => setZeroSave((v) => !v)}
              title="Toggle Zero-Save RAM-only privacy mode"
              className={`min-h-[34px] px-2.5 py-1 rounded-lg border text-xs font-medium inline-flex items-center gap-1.5 transition-colors ${
                zeroSave
                  ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                  : 'bg-slate-900 border-slate-700 text-slate-300'
              }`}
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Zero-Save</span> {zeroSave ? 'ON' : 'OFF'}
            </button>

            <span
              className={`hidden lg:inline-flex items-center gap-1.5 text-xs ${
                isOnline ? 'text-emerald-400' : 'text-amber-400'
              }`}
            >
              {isOnline ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
              {isOnline ? 'Online' : 'Offline'}
            </span>
            <PWAInstallButton />
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 py-5">
        {loading ? (
          <div className="py-24 flex flex-col items-center justify-center gap-3 text-slate-400 text-sm">
            <Loader2 className="w-6 h-6 animate-spin text-emerald-400" />
            Loading SarthiAI Workspace...
          </div>
        ) : loadError || !workspace ? (
          <div className="max-w-lg mx-auto mt-12 p-6 rounded-2xl bg-[#111827] border border-rose-500/40 text-sm text-rose-300">
            {loadError || 'Workspace failed to load.'}
          </div>
        ) : (
          <>
            {activeTab === 'agent' && (
              <AiAgentSection
                profile={workspace.profile}
                chatHistory={workspace.chatHistory}
                aiConfigured={workspace.aiConfigured}
                ephemeralDocs={ephemeralDocs}
                zeroSave={zeroSave}
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
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-[#0B0F17]/95 backdrop-blur border-t border-slate-800 pb-safe">
        <div className="grid grid-cols-4 gap-1 px-2 py-1.5">
          {navItems.map((item) => {
            const active = activeTab === item.key;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => setActiveTab(item.key)}
                className={`min-h-[48px] rounded-xl flex flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors ${
                  active
                    ? 'bg-emerald-500/15 text-emerald-400'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {item.icon}
                <span>{item.shortLabel}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}

export default App;
