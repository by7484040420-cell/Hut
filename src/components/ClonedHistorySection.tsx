import React from 'react';
import { Download, FileArchive, Trash2 } from 'lucide-react';
import type { ClonedApkRecord } from '../types';
import { formatBytes, formatRelativeTime } from '../lib/format';

interface ClonedHistorySectionProps {
  history: ClonedApkRecord[];
  onDelete: (id: string) => Promise<void>;
  onGoToCloner: () => void;
}

export const ClonedHistorySection: React.FC<ClonedHistorySectionProps> = ({
  history,
  onDelete,
  onGoToCloner,
}) => {
  if (history.length === 0) {
    return (
      <div className="bg-[#111827] border border-slate-800/90 rounded-2xl p-10 text-center space-y-4">
        <div className="w-12 h-12 rounded-2xl bg-slate-800/80 mx-auto flex items-center justify-center text-emerald-400">
          <FileArchive className="w-6 h-6" />
        </div>
        <div className="space-y-1">
          <h2 className="text-base font-semibold text-slate-100">No cloned APKs generated yet</h2>
          <p className="text-sm text-slate-400 max-w-md mx-auto">
            Upload any .apk file in the APK Cloner tab to patch its binary AndroidManifest.xml, sign it, and download the cloned APK here.
          </p>
        </div>
        <button
          type="button"
          onClick={onGoToCloner}
          className="min-h-[44px] px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-sm"
        >
          Open APK Cloner
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-display font-bold text-slate-100">
          Cloned &amp; Signed APK Builds ({history.length})
        </h2>
        <p className="text-xs text-slate-400">
          Real APK binaries patched and signed on this server. Download and install on your Android phone.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {history.map((item) => (
          <div
            key={item.id}
            className="bg-[#111827] border border-slate-800/90 rounded-2xl p-5 flex flex-col justify-between gap-4"
          >
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-base font-semibold text-slate-100 truncate">
                  {item.clonedLabel}
                </h3>
                <span className="text-xs font-mono text-slate-400 tabular-nums shrink-0">
                  {formatBytes(item.sizeBytes)}
                </span>
              </div>
              <div className="text-xs font-mono text-emerald-400 break-all">
                {item.clonedPackage}
              </div>
              <div className="text-xs text-slate-400 break-all">
                Source: {item.originalPackage} · v{item.versionName} · {formatRelativeTime(item.createdAt)}
              </div>
            </div>

            <div className="flex items-center justify-between gap-2 pt-3 border-t border-slate-800/80">
              <a
                href={item.downloadUrl}
                download
                className="flex-1 min-h-[42px] px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-xs inline-flex items-center justify-center gap-1.5"
              >
                <Download className="w-4 h-4" />
                Download .APK
              </a>
              <button
                type="button"
                onClick={() => onDelete(item.id)}
                aria-label={`Delete ${item.clonedPackage}`}
                className="min-h-[42px] min-w-[42px] rounded-xl bg-slate-800 hover:bg-rose-500/20 text-slate-400 hover:text-rose-300 flex items-center justify-center"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
