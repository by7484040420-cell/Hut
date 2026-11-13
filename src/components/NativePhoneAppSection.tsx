import React from 'react';
import {
  CheckCircle2,
  Download,
  Globe,
  Layers,
  Smartphone,
  Wrench,
} from 'lucide-react';
import { PWAInstallButton } from './PWAInstallButton';

interface NativePhoneAppSectionProps {
  onOpenManualCloner: () => void;
}

export const NativePhoneAppSection: React.FC<NativePhoneAppSectionProps> = ({
  onOpenManualCloner,
}) => {
  return (
    <div className="space-y-6">
      {/* Main Hero: Zero-Upload Native Android MochiClone APK */}
      <div className="bg-[#111827] border border-slate-800/90 rounded-2xl p-6 space-y-5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-5">
          <div className="space-y-2 max-w-2xl">
            <div className="inline-flex items-center gap-2 text-xs font-medium text-emerald-400">
              <Smartphone className="w-4 h-4" />
              <span>Zero APK Upload · Scans Apps Already Installed on Your Phone</span>
            </div>
            <h1 className="text-xl sm:text-2xl font-display font-bold text-slate-100">
              MochiClone Android App — Phone Me Installed Apps ko Seedha Double Karein
            </h1>
            <p className="text-sm text-slate-300 leading-relaxed">
              Isme aapko koi <code className="font-mono text-emerald-400">.apk</code> file upload karne ki zaroorat nahi hai. Jab aap <strong>MochiClone.apk</strong> apne Android phone me install karte hain, toh yeh automatically aapke mobile me pehle se installed saare apps (icons aur size ke saath) dikhata hai aur unhe direct phone ke andar double clone karke chalata hai.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row lg:flex-col gap-2.5 shrink-0">
            <a
              href="/api/native-android/zip"
              download="mochiclone-native-android.zip"
              className="min-h-[44px] px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-sm inline-flex items-center justify-center gap-2 transition-colors whitespace-nowrap"
            >
              <Download className="w-4 h-4" />
              Download Native Android Code (.zip)
            </a>
            <PWAInstallButton prominent />
          </div>
        </div>

        <div className="pt-4 border-t border-slate-800/80 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs text-slate-300">
          <div className="flex items-start gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            <span>Phone ke installed apps auto-scan (<code className="font-mono">PackageManager</code>)</span>
          </div>
          <div className="flex items-start gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            <span>Split-APK auto-clone + sign (<code className="font-mono">apksig</code> + <code className="font-mono">PackageInstaller</code>)</span>
          </div>
          <div className="flex items-start gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            <span>Dual Work Space + Isolated Dual Web Containers</span>
          </div>
        </div>
      </div>

      {/* 3 Native Engines Inside MochiClone.apk */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-[#111827] border border-slate-800/90 rounded-2xl p-5 space-y-2.5">
          <Wrench className="w-5 h-5 text-emerald-400" />
          <h2 className="text-base font-semibold text-slate-100">
            1. Direct Phone App Cloner
          </h2>
          <p className="text-xs text-slate-400 leading-relaxed">
            Aapke mobile me installed kisi bhi app ka <code className="font-mono text-slate-300">base.apk</code> aur <code className="font-mono text-slate-300">split_*.apk</code> phone se hi read karta hai, naya Package ID (<code className="font-mono text-emerald-400">.mochi2</code>, <code className="font-mono text-emerald-400">.mochi3</code>) deta hai, aur direct install karta hai.
          </p>
        </div>

        <div className="bg-[#111827] border border-slate-800/90 rounded-2xl p-5 space-y-2.5">
          <Layers className="w-5 h-5 text-sky-400" />
          <h2 className="text-base font-semibold text-slate-100">
            2. Android Dual Work Space
          </h2>
          <p className="text-xs text-slate-400 leading-relaxed">
            WhatsApp, BGMI, Free Fire, aur banking apps jo signature check karte hain, unke liye phone me Android ka real isolated Work Profile (<code className="font-mono text-slate-300">DevicePolicyManager</code>) create karke original copy double chalata hai.
          </p>
        </div>

        <div className="bg-[#111827] border border-slate-800/90 rounded-2xl p-5 space-y-2.5">
          <Globe className="w-5 h-5 text-amber-400" />
          <h2 className="text-base font-semibold text-slate-100">
            3. Dual Account Web Containers
          </h2>
          <p className="text-xs text-slate-400 leading-relaxed">
            Har cloned account ko alag <code className="font-mono text-slate-300">WebView.setDataDirectorySuffix()</code> aur separate <code className="font-mono text-slate-300">:sandbox_web</code> process deta hai taaki 2-3 accounts ek saath login rahein.
          </p>
        </div>
      </div>

      {/* Why Browser Needs APK Build + How to Build MochiClone.apk */}
      <div className="bg-[#111827] border border-slate-800/90 rounded-2xl p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-100">
              Phone me Install Karne ke liye MochiClone.apk Kaise Banayein
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Browser website ko Android phone ke installed apps padhne ki permission nahi hoti, isliye phone par chalane ke liye neeche diye steps se APK compile karein:
            </p>
          </div>
          <button
            type="button"
            onClick={onOpenManualCloner}
            className="min-h-[40px] px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-200 whitespace-nowrap shrink-0"
          >
            Open Manual .APK Patcher
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 text-xs text-slate-300">
          <div className="p-4 rounded-xl bg-[#0B0F17] border border-slate-800 space-y-1.5">
            <div className="font-semibold text-slate-100">Step 1: GitHub Actions (Bina PC ke Phone se APK Banayein)</div>
            <p className="text-slate-400 leading-relaxed">
              Is project ko apne GitHub repo me push karein → <strong>Actions</strong> tab kholein → <strong>Build Native Android APK (MochiClone)</strong> run karein → 3 minute me ready <code className="font-mono text-emerald-400">mochiclone-native-apk</code> download karke phone me install karein.
            </p>
          </div>
          <div className="p-4 rounded-xl bg-[#0B0F17] border border-slate-800 space-y-1.5">
            <div className="font-semibold text-slate-100">Step 2: Android Studio / Terminal Build</div>
            <pre className="font-mono text-[11px] text-slate-300 overflow-x-auto">
{`unzip mochiclone-native-android.zip
cd native-android
gradle assembleDebug`}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
};
