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
      <div className="inline-flex items-center gap-2 min-h-[44px] px-4 py-2 rounded-xl bg-emerald-50 border border-emerald-300 text-sm font-medium text-emerald-800 whitespace-nowrap shrink-0">
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
            ? 'inline-flex items-center justify-center gap-2 min-h-[44px] px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-sm transition-colors whitespace-nowrap shrink-0'
            : 'inline-flex items-center gap-1.5 min-h-[36px] px-3 py-1.5 rounded-lg bg-white text-slate-900 hover:bg-slate-100 text-xs font-semibold transition-colors whitespace-nowrap shrink-0'
        }
      >
        <Download className="w-3.5 h-3.5" />
        Install
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
              ? 'inline-flex items-center justify-center gap-2 min-h-[44px] px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-sm transition-colors whitespace-nowrap shrink-0'
              : 'inline-flex items-center gap-1.5 min-h-[36px] px-3 py-1.5 rounded-lg bg-white text-slate-900 hover:bg-slate-100 text-xs font-semibold transition-colors whitespace-nowrap shrink-0'
          }
        >
          <Download className="w-3.5 h-3.5" />
          {isIOS ? 'iOS Install' : 'Install'}
        </button>

        {showGuide && (
          <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="w-full max-w-sm bg-white border border-slate-200 rounded-2xl p-6 space-y-4 text-slate-900">
              <div className="flex items-center justify-between gap-4">
                <h3 className="text-base font-bold text-slate-900">
                  Install SarthiAI on Device
                </h3>
                <button
                  type="button"
                  onClick={() => setShowGuide(false)}
                  aria-label="Close install guide"
                  className="min-h-[40px] min-w-[40px] rounded-lg text-slate-500 hover:text-slate-900 flex items-center justify-center"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              {isIOS ? (
                <p className="text-sm text-slate-700 leading-relaxed">
                  1. Tap the <strong>Share</strong> icon in Safari&apos;s toolbar.
                  <br />
                  2. Scroll down and select <strong>Add to Home Screen</strong>.
                </p>
              ) : (
                <p className="text-sm text-slate-700 leading-relaxed">
                  Open your browser menu (three dots) and tap <strong>Install app</strong> or{' '}
                  <strong>Add to Home screen</strong> to launch SarthiAI in full-screen standalone mode.
                </p>
              )}
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                className="w-full min-h-[44px] rounded-xl bg-[#0F172A] hover:bg-slate-800 text-white font-semibold text-sm transition-colors"
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
