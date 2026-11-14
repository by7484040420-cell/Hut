import React, { useMemo, useState } from 'react';
import { Bookmark, Bot, Check, ExternalLink, Search, Sparkles } from 'lucide-react';
import { allPortals, categories } from '../narad/portals';
import { searchPortals } from '../narad/search';
import type { Portal } from '../narad/types';
import type { PortalBookmark } from '../types';

interface DirectorySectionProps {
  onOpenBrowser: (url: string, goal?: string) => void;
  onAskAi: (prompt: string) => void;
  bookmarks?: PortalBookmark[];
  onSaveBookmark?: (portal: Portal) => void;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/**
 * Narad AI ka Official Sarkari Directory (85+ portals, 13 categories, Hinglish search)
 * SarthiAI ke AI Live Browser + AI Agent se jod diya gaya hai:
 *   - "AI Browser me kholo"  -> portal khulta hai aur fill engine form bharta hai
 *   - "AI se poochho"       -> AI Agent portal ke documents/eligibility/fees batata hai
 */
export function DirectorySection({
  onOpenBrowser,
  onAskAi,
  bookmarks = [],
  onSaveBookmark,
}: DirectorySectionProps) {
  const [query, setQuery] = useState('');
  const [activeCat, setActiveCat] = useState<string>('all');

  const bookmarkedUrls = useMemo(
    () => new Set(bookmarks.map((b) => b.url.replace(/\/+$/, '').toLowerCase())),
    [bookmarks]
  );

  const results: Portal[] = useMemo(() => {
    if (query.trim()) return searchPortals(allPortals, query).slice(0, 60);
    if (activeCat === 'all') return allPortals.slice(0, 60);
    const cat = categories.find((c) => c.name === activeCat);
    return cat ? cat.links : [];
  }, [query, activeCat]);

  const searching = query.trim().length > 0;

  return (
    <div className="space-y-4">
      <div className="bg-white border border-slate-200/90 rounded-2xl p-4 sm:p-5 shadow-xs space-y-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-lg font-bold text-slate-900 font-display">Sarkari Directory</h1>
            <p className="text-xs text-slate-600 mt-0.5">
              {allPortals.length}+ official portals (.gov.in / .nic.in). Hindi ya Hinglish me khojein — jaise
              &quot;sipahi bharti&quot;, &quot;aay praman&quot;, &quot;tatkal&quot;, &quot;passport&quot;.
            </p>
          </div>
          <span className="text-[11px] font-mono text-slate-500 whitespace-nowrap shrink-0">
            Desktop Browser Ready
          </span>
        </div>

        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Portal ya seva khojein..."
            className="w-full min-h-[44px] pl-10 pr-3.5 rounded-xl bg-slate-50 border border-slate-200 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:bg-white focus:outline-none"
          />
        </div>

        {!searching && (
          <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
            <button
              type="button"
              onClick={() => setActiveCat('all')}
              className={`shrink-0 whitespace-nowrap min-h-[34px] px-3 rounded-lg text-xs font-semibold border transition-colors ${
                activeCat === 'all'
                  ? 'bg-[#0B1120] text-white border-[#0B1120]'
                  : 'bg-slate-50 text-slate-700 border-slate-200 hover:border-slate-400 hover:bg-white'
              }`}
            >
              Popular ({allPortals.length})
            </button>
            {categories.map((c) => (
              <button
                key={c.name}
                type="button"
                onClick={() => setActiveCat(c.name)}
                className={`shrink-0 whitespace-nowrap min-h-[34px] px-3 rounded-lg text-xs font-semibold border transition-colors ${
                  activeCat === c.name
                    ? 'bg-[#0B1120] text-white border-[#0B1120]'
                    : 'bg-slate-50 text-slate-700 border-slate-200 hover:border-slate-400 hover:bg-white'
                }`}
              >
                {c.name} ({c.links.length})
              </button>
            ))}
          </div>
        )}
      </div>

      {results.length === 0 ? (
        <div className="bg-white border border-slate-200/90 rounded-2xl p-6 shadow-xs text-sm text-slate-600 space-y-3">
          <p>&quot;{query}&quot; ke liye directory me koi portal nahi mila.</p>
          <button
            type="button"
            onClick={() => onAskAi(`Mujhe "${query}" ke liye official portal aur apply karne ka process batao (live internet se dhundo).`)}
            className="min-h-[40px] px-4 rounded-xl bg-[#0B1120] hover:bg-slate-800 text-white text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
          >
            <Sparkles className="w-3.5 h-3.5 text-rose-400" />
            AI Agent se live internet par dhundwayein
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
          {results.map((p) => {
            const isBookmarked = bookmarkedUrls.has(p.url.replace(/\/+$/, '').toLowerCase());
            return (
              <div
                key={`${p.name}-${p.url}`}
                className="bg-white border border-slate-200/90 hover:border-slate-300 rounded-2xl p-4 shadow-xs flex flex-col gap-3 transition-colors"
              >
                <div className="min-w-0">
                  <div className="text-sm font-bold text-slate-900 leading-snug">{p.name}</div>
                  <div className="text-[11px] text-slate-600 mt-0.5 line-clamp-2">{p.note}</div>
                  <div className="text-[11px] font-mono text-slate-400 mt-1.5 truncate">{hostOf(p.url)}</div>
                </div>
                <div className="flex items-center gap-1.5 mt-auto pt-2 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() =>
                      onOpenBrowser(p.url, `${p.name} ka form meri profile se bharo. CAPTCHA/OTP/payment mai khud karunga.`)
                    }
                    className="flex-1 min-h-[36px] px-3 rounded-lg bg-[#0B1120] hover:bg-slate-800 text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0"
                  >
                    <Sparkles className="w-3.5 h-3.5 text-amber-300 shrink-0" />
                    Desktop Browser
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      onAskAi(
                        `${p.name} (${p.url}) ke liye: kaun se documents chahiye, eligibility, fees aur step-by-step apply process batao. Official source se confirm karke batao.`
                      )
                    }
                    className="min-h-[36px] px-2.5 rounded-lg bg-slate-50 border border-slate-200 hover:border-slate-400 text-slate-800 text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
                  >
                    <Bot className="w-3.5 h-3.5" />
                    Ask AI
                  </button>
                  {onSaveBookmark && (
                    <button
                      type="button"
                      disabled={isBookmarked}
                      onClick={() => onSaveBookmark(p)}
                      title={isBookmarked ? 'Bookmarked in Live Browser' : 'Pin to Live Browser bookmarks'}
                      className={`min-h-[36px] w-9 rounded-lg border text-xs font-semibold inline-flex items-center justify-center shrink-0 ${
                        isBookmarked
                          ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                          : 'bg-white border-slate-200 text-slate-600 hover:border-slate-400 hover:text-slate-900'
                      }`}
                    >
                      {isBookmarked ? <Check className="w-3.5 h-3.5" /> : <Bookmark className="w-3.5 h-3.5" />}
                    </button>
                  )}
                  <a
                    href={p.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="min-h-[36px] w-8 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 text-xs inline-flex items-center justify-center shrink-0"
                    title="Seedha website kholo"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
