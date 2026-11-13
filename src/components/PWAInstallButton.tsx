import React, { useState } from 'react';
import { Download, Smartphone, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

interface PWAInstallButtonProps {
  prominent?: boolean;
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({ prominent = false }) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showGuide, setShowGuide] = useState(false);

  if (isInstalled) {
    if (!prominent) return null;
    return (
      <div className="inline-flex items-center gap-2 min-h-[44px] px-4 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-sm font-medium text-emerald-300 whitespace-nowrap shrink-0">
        <Smartphone className="w-4 h-4" />
        Running as Installed App
      </div>
    );
  }

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={install}
        className={
          prominent
            ? 'inline-flex items-center justify-center gap-2 min-h-[44px] px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-sm transition-colors whitespace-nowrap shrink-0'
            : 'inline-flex items-center gap-2 min-h-[40px] px-3.5 py-2 rounded-xl bg-slate-900 border border-slate-700 hover:border-emerald-500/50 text-xs font-medium text-slate-100 transition-colors whitespace-nowrap shrink-0'
        }
      >
        <Download className="w-4 h-4" />
        Install App
      </button>
    );
  }

  if (isIOS || prominent) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowGuide(true)}
          className={
            prominent
              ? 'inline-flex items-center justify-center gap-2 min-h-[44px] px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-sm transition-colors whitespace-nowrap shrink-0'
              : 'inline-flex items-center gap-2 min-h-[40px] px-3.5 py-2 rounded-xl bg-slate-900 border border-slate-700 hover:border-emerald-500/50 text-xs font-medium text-slate-100 transition-colors whitespace-nowrap shrink-0'
          }
        >
          <Download className="w-4 h-4" />
          {isIOS ? 'Install on iOS' : 'Install App'}
        </button>

        {showGuide && (
          <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="w-full max-w-sm bg-[#111827] border border-slate-800 rounded-2xl p-6 space-y-4">
              <div className="flex items-center justify-between gap-4">
                <h3 className="text-base font-semibold text-slate-100">
                  Install MochiClone on Device
                </h3>
                <button
                  type="button"
                  onClick={() => setShowGuide(false)}
                  aria-label="Close install guide"
                  className="min-h-[40px] min-w-[40px] rounded-lg text-slate-400 hover:text-white flex items-center justify-center"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              {isIOS ? (
                <p className="text-sm text-slate-300 leading-relaxed">
                  1. Tap the <strong>Share</strong> icon in Safari&apos;s toolbar.
                  <br />
                  2. Scroll down and select <strong>Add to Home Screen</strong>.
                </p>
              ) : (
                <p className="text-sm text-slate-300 leading-relaxed">
                  Open your browser menu (three dots) and tap <strong>Install app</strong> or{' '}
                  <strong>Add to Home screen</strong> to launch MochiClone in full-screen standalone mode, or build the Android APK from the APK tab.
                </p>
              )}
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                className="w-full min-h-[44px] rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-sm transition-colors"
              >
                Got it
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
};
