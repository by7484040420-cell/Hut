import React, { useEffect, useRef, useState } from 'react';
import {
  Download,
  FileArchive,
  History,
  Smartphone,
  WifiOff,
} from 'lucide-react';
import type { AppTab, ClonedApkRecord } from './types';
import { useOnlineStatus } from './hooks/usePWAInstall';
import { ApkClonerSection } from './components/ApkClonerSection';
import { NativePhoneAppSection } from './components/NativePhoneAppSection';
import { ClonedHistorySection } from './components/ClonedHistorySection';

export function App() {
  const [activeTab, setActiveTab] = useState<AppTab>('native');
  const [history, setHistory] = useState<ClonedApkRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const fileTriggerRef = useRef<(() => void) | null>(null);
  const isOnline = useOnlineStatus();

  useEffect(() => {
    let mounted = true;
    fetch('/api/bootstrap')
      .then((r) => r.json())
      .then((data) => {
        if (!mounted) return;
        setHistory(Array.isArray(data.history) ? (data.history as ClonedApkRecord[]) : []);
      })
      .catch(() => {
        // ignore
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const handleDeleteRecord = async (id: string) => {
    const res = await fetch(`/api/apk/history/${id}`, { method: 'DELETE' });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.history)) setHistory(data.history);
    }
  };

  const navItems: Array<{
    id: AppTab;
    label: string;
    mobileLabel: string;
    icon: React.ComponentType<{ className?: string }>;
  }> = [
    { id: 'native', label: 'Phone Dual APK', mobileLabel: 'Phone APK', icon: Smartphone },
    { id: 'cloner', label: 'Manual .APK Tool', mobileLabel: 'Patcher', icon: FileArchive },
    { id: 'history', label: `Cloned APKs (${history.length})`, mobileLabel: 'Builds', icon: History },
  ];

  return (
    <div className="min-h-screen bg-[#0B0F17] text-slate-100 flex flex-col">
      {/* Top Bar — 3-Zone Contract */}
      <header className="sticky top-0 z-30 h-[52px] md:h-16 bg-[#0B0F17]/90 backdrop-blur-md border-b border-slate-800/80">
        <div className="max-w-7xl mx-auto h-full px-4 sm:px-6 flex items-center justify-between gap-8">
          <button
            type="button"
            onClick={() => setActiveTab('native')}
            className="text-lg font-display font-bold tracking-tight text-slate-100 hover:text-emerald-400 transition-colors whitespace-nowrap shrink-0"
          >
            MochiClone
          </button>

          <nav className="hidden md:flex items-center gap-6">
            {navItems.map((item) => {
              const active = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveTab(item.id)}
                  className={`py-1.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                    active
                      ? 'border-emerald-500 text-slate-100'
                      : 'border-transparent text-slate-400 hover:text-slate-100'
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </nav>

          <div className="flex items-center shrink-0">
            <a
              href="/api/native-android/zip"
              download="mochiclone-native-android.zip"
              className="min-h-[38px] md:min-h-[40px] px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-xs sm:text-sm inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
            >
              <Download className="w-4 h-4" />
              Get Phone APK Code
            </a>
          </div>
        </div>
      </header>

      {!isOnline && (
        <div className="bg-amber-500/10 border-b border-amber-500/30 px-4 py-2 text-xs text-amber-300 flex items-center justify-center gap-2">
          <WifiOff className="w-3.5 h-3.5" />
          <span>Offline mode active.</span>
        </div>
      )}

      <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 pt-6 pb-24 md:pb-10">
        {loading ? (
          <div className="h-56 rounded-2xl bg-[#111827] border border-slate-800/80 animate-pulse" />
        ) : (
          <>
            {activeTab === 'native' && (
              <NativePhoneAppSection onOpenManualCloner={() => setActiveTab('cloner')} />
            )}
            {activeTab === 'cloner' && (
              <ApkClonerSection
                externalFileTriggerRef={fileTriggerRef}
                onApkCloned={(_record, allHistory) => setHistory(allHistory)}
              />
            )}
            {activeTab === 'history' && (
              <ClonedHistorySection
                history={history}
                onDelete={handleDeleteRecord}
                onGoToCloner={() => setActiveTab('cloner')}
              />
            )}
          </>
        )}
      </main>

      {/* Mobile Bottom Tab Bar */}
      <nav
        aria-label="Mobile navigation"
        className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-[#0B0F17]/95 backdrop-blur-md border-t border-slate-800/90 pb-safe"
      >
        <div className="grid grid-cols-3 items-center h-16">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={`min-h-[44px] flex flex-col items-center justify-center gap-1 transition-colors ${
                  active ? 'text-emerald-400' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Icon className="w-5 h-5" />
                <span className="text-[10px] font-medium tracking-tight">{item.mobileLabel}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}

export default App;
