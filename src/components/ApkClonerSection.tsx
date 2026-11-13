import React, { useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  CopyPlus,
  Download,
  FileArchive,
  ShieldCheck,
  Upload,
} from 'lucide-react';
import type { ApkInspectionSummary, ClonedApkRecord } from '../types';
import { formatBytes } from '../lib/format';

interface ApkClonerSectionProps {
  onApkCloned: (record: ClonedApkRecord, allHistory: ClonedApkRecord[]) => void;
  externalFileTriggerRef?: React.MutableRefObject<(() => void) | null>;
}

export const ApkClonerSection: React.FC<ApkClonerSectionProps> = ({
  onApkCloned,
  externalFileTriggerRef,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [inspection, setInspection] = useState<ApkInspectionSummary | null>(null);
  const [inspecting, setInspecting] = useState(false);
  const [cloning, setCloning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [newPackageName, setNewPackageName] = useState('');
  const [newAppLabel, setNewAppLabel] = useState('');
  const [renameAuthorities, setRenameAuthorities] = useState(true);
  const [renameCustomPermissions, setRenameCustomPermissions] = useState(true);
  const [builtRecord, setBuiltRecord] = useState<ClonedApkRecord | null>(null);

  if (externalFileTriggerRef) {
    externalFileTriggerRef.current = () => fileInputRef.current?.click();
  }

  const handleSelectApk = async (file: File) => {
    setError(null);
    setBuiltRecord(null);
    setSelectedFile(file);
    setInspection(null);
    setInspecting(true);

    try {
      const fd = new FormData();
      fd.append('apk', file);
      const res = await fetch('/api/apk/inspect', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Could not inspect APK file');
      }
      const summary = data as ApkInspectionSummary;
      setInspection(summary);
      setNewPackageName(`${summary.manifest.packageName}.mochi2`);
      setNewAppLabel(
        summary.manifest.appLabel && !summary.manifest.appLabelIsResource
          ? `${summary.manifest.appLabel} 2`
          : ''
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid APK file');
    } finally {
      setInspecting(false);
    }
  };

  const handleCloneAndSign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile || !inspection) return;
    setError(null);
    setCloning(true);
    setBuiltRecord(null);

    try {
      const fd = new FormData();
      fd.append('apk', selectedFile);
      fd.append('newPackageName', newPackageName.trim());
      if (newAppLabel.trim()) fd.append('newAppLabel', newAppLabel.trim());
      fd.append('renameAuthorities', String(renameAuthorities));
      fd.append('renameCustomPermissions', String(renameCustomPermissions));

      const res = await fetch('/api/apk/clone', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to clone and sign APK');
      }
      const record = data.record as ClonedApkRecord;
      setBuiltRecord(record);
      onApkCloned(record, Array.isArray(data.history) ? data.history : [record]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to build cloned APK');
    } finally {
      setCloning(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Upload & Drop Zone */}
      <div className="bg-[#111827] border border-slate-800/90 rounded-2xl p-6 space-y-5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-xl sm:text-2xl font-display font-bold text-slate-100">
              Real Android APK Binary Cloner &amp; Signer
            </h1>
            <p className="text-sm text-slate-400 max-w-2xl">
              Upload any <code className="font-mono text-slate-200">.apk</code> file from your phone. MochiClone parses the real binary{' '}
              <code className="font-mono text-slate-200">AndroidManifest.xml</code>, rewrites the Package ID &amp; provider authorities, aligns <code className="font-mono text-slate-200">resources.arsc</code>, and signs a fresh dual-installable APK with v1 + v2 signatures.
            </p>
          </div>

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={inspecting || cloning}
            className="min-h-[44px] px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 font-semibold text-sm inline-flex items-center justify-center gap-2 transition-colors whitespace-nowrap shrink-0"
          >
            <Upload className="w-4 h-4" />
            {inspecting ? 'Parsing Manifest...' : 'Choose .APK File'}
          </button>

          <input
            ref={fileInputRef}
            type="file"
            accept=".apk,.apks,.xapk,application/vnd.android.package-archive"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleSelectApk(f);
              e.target.value = '';
            }}
          />
        </div>

        {!selectedFile && !inspecting && (
          <div
            onClick={() => fileInputRef.current?.click()}
            className="border border-dashed border-slate-700 hover:border-emerald-500/60 rounded-xl p-8 text-center cursor-pointer transition-colors space-y-2 bg-[#0B0F17]"
          >
            <FileArchive className="w-8 h-8 text-emerald-400 mx-auto" />
            <div className="text-sm font-medium text-slate-200">
              Select a real Android .apk file to clone
            </div>
            <div className="text-xs text-slate-400">
              Reads actual AndroidManifest.xml binary XML · Rewrites package &amp; authorities · Generates APK v1 + v2 signed binary
            </div>
          </div>
        )}

        {error && (
          <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-sm text-rose-300 flex items-start gap-2.5">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </div>

      {/* Real Parsed Manifest & Clone Form */}
      {inspection && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          {/* Left: Real Parsed APK Details */}
          <div className="lg:col-span-5 bg-[#111827] border border-slate-800/90 rounded-2xl p-5 space-y-4">
            <div className="space-y-1">
              <div className="text-xs font-medium text-emerald-400">Parsed Binary Manifest</div>
              <h2 className="text-base font-display font-bold text-slate-100 break-all">
                {inspection.manifest.packageName}
              </h2>
              <p className="text-xs text-slate-400">
                {inspection.fileName} · {formatBytes(inspection.sizeBytes)}
              </p>
            </div>

            <div className="divide-y divide-slate-800/80 border-t border-slate-800/80 text-xs">
              <div className="py-2.5 flex items-center justify-between gap-3">
                <span className="text-slate-400">Version</span>
                <span className="font-mono text-slate-200 tabular-nums">
                  {inspection.manifest.versionName} ({inspection.manifest.versionCode})
                </span>
              </div>
              <div className="py-2.5 flex items-center justify-between gap-3">
                <span className="text-slate-400">SDK Range</span>
                <span className="font-mono text-slate-200 tabular-nums">
                  min {inspection.manifest.minSdkVersion ?? '—'} · target {inspection.manifest.targetSdkVersion ?? '—'}
                </span>
              </div>
              <div className="py-2.5 flex items-center justify-between gap-3">
                <span className="text-slate-400">DEX &amp; Native ABIs</span>
                <span className="font-mono text-slate-200 tabular-nums">
                  {inspection.dexFiles.length} dex · {inspection.nativeAbis.length > 0 ? inspection.nativeAbis.join(', ') : 'Pure Java/Kotlin'}
                </span>
              </div>
              <div className="py-2.5 flex items-center justify-between gap-3">
                <span className="text-slate-400">Components</span>
                <span className="font-mono text-slate-200 tabular-nums">
                  {inspection.manifest.activitiesCount} act · {inspection.manifest.servicesCount} svc · {inspection.manifest.receiversCount} rcv
                </span>
              </div>
              <div className="py-2.5 flex items-center justify-between gap-3">
                <span className="text-slate-400">Provider Authorities</span>
                <span className="font-mono text-slate-200 tabular-nums">
                  {inspection.manifest.authorities.length}
                </span>
              </div>
              <div className="py-2.5 flex items-center justify-between gap-3">
                <span className="text-slate-400">Permissions</span>
                <span className="font-mono text-slate-200 tabular-nums">
                  {inspection.manifest.permissions.length}
                </span>
              </div>
            </div>

            <div className="pt-1 text-[11px] font-mono text-slate-500 break-all">
              SHA-256: {inspection.sha256}
            </div>
          </div>

          {/* Right: Clone Configuration & Build */}
          <form
            onSubmit={handleCloneAndSign}
            className="lg:col-span-7 bg-[#111827] border border-slate-800/90 rounded-2xl p-5 space-y-5"
          >
            <div>
              <h2 className="text-base font-display font-bold text-slate-100">
                Configure Dual Package Identity
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Android requires a unique Package ID and unique ContentProvider authorities to install a second copy alongside the original app.
              </p>
            </div>

            <div className="space-y-4">
              <div className="space-y-1.5">
                <span className="text-xs font-medium text-slate-300">Quick Clone Instance</span>
                <div className="flex flex-wrap items-center gap-1.5">
                  {[2, 3, 4, 5].map((num) => {
                    const targetPkg = `${inspection.manifest.packageName}.mochi${num}`;
                    const active = newPackageName === targetPkg;
                    return (
                      <button
                        key={num}
                        type="button"
                        onClick={() => {
                          setNewPackageName(targetPkg);
                          if (inspection.manifest.appLabel && !inspection.manifest.appLabelIsResource) {
                            setNewAppLabel(`${inspection.manifest.appLabel} ${num}`);
                          }
                        }}
                        className={`min-h-[36px] px-3 rounded-lg text-xs font-mono font-semibold transition-colors ${
                          active
                            ? 'bg-emerald-500 text-slate-950'
                            : 'bg-[#0B0F17] border border-slate-800 text-slate-300 hover:border-slate-700'
                        }`}
                      >
                        Clone #{num}
                      </button>
                    );
                  })}
                </div>
              </div>

              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-slate-300">New Clone Package ID</span>
                <input
                  type="text"
                  required
                  value={newPackageName}
                  onChange={(e) => setNewPackageName(e.target.value)}
                  placeholder="com.example.app.mochi2"
                  className="w-full min-h-[44px] px-3.5 rounded-xl bg-[#0B0F17] border border-slate-800 text-sm font-mono text-slate-100 focus:outline-none focus:border-emerald-500"
                />
              </label>

              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-slate-300">
                  Clone Display Label {inspection.manifest.appLabelIsResource ? '(Resource-linked in resources.arsc — leave blank to keep)' : ''}
                </span>
                <input
                  type="text"
                  value={newAppLabel}
                  disabled={inspection.manifest.appLabelIsResource}
                  onChange={(e) => setNewAppLabel(e.target.value)}
                  placeholder={
                    inspection.manifest.appLabelIsResource
                      ? 'Uses @string/app_name from resources.arsc'
                      : 'e.g. App Clone 2'
                  }
                  className="w-full min-h-[44px] px-3.5 rounded-xl bg-[#0B0F17] border border-slate-800 disabled:opacity-50 text-sm text-slate-100 focus:outline-none focus:border-emerald-500"
                />
              </label>

              <div className="space-y-2.5 pt-1">
                <label className="flex items-start gap-3 p-3.5 rounded-xl bg-[#0B0F17] border border-slate-800 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={renameAuthorities}
                    onChange={(e) => setRenameAuthorities(e.target.checked)}
                    className="w-4 h-4 accent-emerald-500 mt-0.5"
                  />
                  <div>
                    <div className="text-xs font-medium text-slate-200">
                      Rewrite ContentProvider Authorities ({inspection.manifest.authorities.length} found)
                    </div>
                    <div className="text-[11px] text-slate-400">
                      Prevents Android <code className="font-mono">INSTALL_FAILED_CONFLICTING_PROVIDER</code> when installing dual copies.
                    </div>
                  </div>
                </label>

                <label className="flex items-start gap-3 p-3.5 rounded-xl bg-[#0B0F17] border border-slate-800 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={renameCustomPermissions}
                    onChange={(e) => setRenameCustomPermissions(e.target.checked)}
                    className="w-4 h-4 accent-emerald-500 mt-0.5"
                  />
                  <div>
                    <div className="text-xs font-medium text-slate-200">
                      Namespace Custom App Permissions
                    </div>
                    <div className="text-[11px] text-slate-400">
                      Prevents Android 13+ signature permission collisions with the original installed app.
                    </div>
                  </div>
                </label>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-800/80">
              <div className="flex items-center gap-1.5 text-xs text-slate-400">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                Signs APK v1 (JAR) + v2 (Signing Block)
              </div>

              <button
                type="submit"
                disabled={cloning}
                className="min-h-[44px] px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 font-semibold text-sm inline-flex items-center gap-2 transition-colors"
              >
                <CopyPlus className="w-4 h-4" />
                {cloning ? 'Patching & Signing APK...' : 'Clone & Sign APK'}
              </button>
            </div>

            {builtRecord && (
              <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-start gap-2.5">
                  <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                  <div>
                    <div className="text-sm font-semibold text-slate-100">
                      Signed Cloned APK Ready
                    </div>
                    <div className="text-xs font-mono text-emerald-300 break-all">
                      {builtRecord.clonedPackage} · {formatBytes(builtRecord.sizeBytes)}
                    </div>
                  </div>
                </div>
                <a
                  href={builtRecord.downloadUrl}
                  download
                  className="min-h-[42px] px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-xs inline-flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0"
                >
                  <Download className="w-4 h-4" />
                  Download .APK
                </a>
              </div>
            )}
          </form>
        </div>
      )}
    </div>
  );
};
