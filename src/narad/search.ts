// NaradSearch - In-browser intelligent Hinglish & Hindi search engine
import type { JobItem, Portal } from './types';

const SYN: Record<string, string[]> = {
  bharti: ['recruitment', 'vacancy', 'भर्ती', 'notification'],
  bharty: ['recruitment', 'vacancy', 'भर्ती'],
  vacancy: ['recruitment', 'vacancy', 'भर्ती'],
  vacancies: ['vacancy', 'recruitment'],
  job: ['recruitment', 'vacancy', 'भर्ती'],
  jobs: ['recruitment', 'vacancy', 'भर्ती'],
  naukri: ['recruitment', 'vacancy', 'भर्ती'],
  recruitment: ['recruitment', 'vacancy', 'भर्ती'],
  'भर्ती': ['भर्ती', 'recruitment', 'vacancy'],
  result: ['result', 'परिणाम', 'रिजल्ट'],
  results: ['result', 'परिणाम'],
  parinam: ['result', 'परिणाम'],
  parinaam: ['result', 'परिणाम'],
  rijalt: ['result', 'रिजल्ट'],
  'रिजल्ट': ['रिजल्ट', 'result', 'परिणाम'],
  'परिणाम': ['परिणाम', 'result'],
  admit: ['admit', 'प्रवेश', 'एडमिट'],
  admitcard: ['admit card', 'एडमिट कार्ड'],
  hallticket: ['hall ticket', 'admit card'],
  'एडमिट': ['एडमिट', 'admit'],
  sipahi: ['constable', 'सिपाही'],
  'सिपाही': ['सिपाही', 'constable'],
  constable: ['constable', 'सिपाही'],
  grup: ['group'],
  gropu: ['group'],
  railway: ['railway', 'rrb', 'रेलवे'],
  'रेलवे': ['रेलवे', 'railway', 'rrb'],
  rrb: ['rrb', 'railway'],
  police: ['police', 'पुलिस'],
  'पुलिस': ['पुलिस', 'police'],
  teacher: ['teacher', 'शिक्षक', 'tet'],
  shikshak: ['teacher', 'शिक्षक'],
  'शिक्षक': ['शिक्षक', 'teacher'],
  tatkal: ['tatkal', 'ticket', 'irctc'],
  train: ['train', 'irctc', 'railway', 'pnr'],
  ticket: ['ticket', 'train', 'irctc'],
  pan: ['pan', 'e-pan', 'pan card', 'incometax'],
  aadhaar: ['aadhaar', 'aadhar', 'adhar', 'uidai'],
  aadhar: ['aadhaar', 'aadhar', 'adhar', 'uidai'],
  caste: ['caste', 'jati', 'jaati', 'rtps'],
  income: ['income', 'aay', 'rtps']
};

export function norm(s: string): string {
  return (s || '')
    .toLowerCase()
    .replace(/[^a-z0-9\u0900-\u097f ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function lev(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const prev: number[] = [];
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    const cur: number[] = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
      if (cur[j] < best) best = cur[j];
    }
    if (best > max) return max + 1;
    for (let k = 0; k <= b.length; k++) prev[k] = cur[k];
  }
  return prev[b.length];
}

export function daysAgo(iso?: string, now = Date.now()): number {
  if (!iso) return 999;
  const t = Date.parse(iso + 'T00:00:00Z');
  return isNaN(t) ? 999 : Math.floor((now - t) / 86400000);
}

function tokenScore(forms: string[], text: string, words: string[]): number {
  let best = 0;
  for (let i = 0; i < forms.length; i++) {
    const f = forms[i];
    if (text.includes(f)) {
      let s = 3;
      for (let w = 0; w < words.length; w++) {
        if (words[w].startsWith(f)) {
          s = 4;
          break;
        }
      }
      if (s > best) best = s;
    } else if (f.length >= 4 && /^[a-z0-9]+$/.test(f)) {
      const max = f.length >= 7 ? 2 : 1;
      for (let w = 0; w < words.length; w++) {
        if (words[w].length >= 4 && lev(f, words[w], max) <= max) {
          if (best < 2) best = 2;
          break;
        }
      }
    }
  }
  return best;
}

export interface SearchResult<T> {
  item: T;
  score: number;
  age: number;
}

export function searchJobs(
  items: JobItem[],
  query: string,
  kind = 'all',
  now = Date.now()
): SearchResult<JobItem>[] {
  const toks = norm(query).split(' ').filter(Boolean);
  const groups = toks.map(t => [t, ...(SYN[t] || [])].map(norm));
  const out: SearchResult<JobItem>[] = [];

  items.forEach(it => {
    if (kind && kind !== 'all' && it.kind !== kind) return;
    const age = daysAgo(it.first_seen, now);
    let score = 0;

    if (groups.length) {
      const text = norm(it.title);
      const words = text.split(' ');
      const src = norm(it.source);

      for (let g = 0; g < groups.length; g++) {
        let s = tokenScore(groups[g], text, words);
        if (!s) s = tokenScore(groups[g], src, src.split(' ')) ? 1 : 0;
        if (!s) return; // all query words must match
        score += s;
      }
    } else {
      score = 1;
    }

    score += age <= 3 ? 1.5 : age <= 14 ? 0.5 : 0;
    out.push({ item: it, score, age });
  });

  out.sort((a, b) => b.score - a.score || (a.item.first_seen < b.item.first_seen ? 1 : -1));
  return out;
}

export function searchPortals(portals: Portal[], query: string): Portal[] {
  const q = norm(query);
  if (!q) return portals;

  const toks = q.split(' ').filter(Boolean);
  const groups = toks.map(t => [t, ...(SYN[t] || [])].map(norm));

  return portals
    .map(p => {
      const nameNorm = norm(p.name);
      const keysNorm = (p.keys || []).map(norm).join(' ');
      const noteNorm = norm(p.note || '');
      const full = `${nameNorm} ${keysNorm} ${noteNorm}`;
      const words = full.split(' ');

      let score = 0;
      let matchedAll = true;

      for (const g of groups) {
        const s = tokenScore(g, full, words);
        if (s > 0) {
          score += s;
        } else {
          matchedAll = false;
          break;
        }
      }

      return { portal: p, score: matchedAll ? score : 0 };
    })
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .map(x => x.portal);
}
