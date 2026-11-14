// Narad AI ke directory types (Hut ke saath merge)
export interface Portal {
  name: string;
  url: string;
  keys: string[];
  note: string;
}

export interface Category {
  name: string;
  sub: string;
  tag: string;
  color: string;
  links: Portal[];
}

export interface JobItem {
  title: string;
  url: string;
  source: string;
  last_date?: string;
  first_seen: string;
  kind: 'job' | 'admit' | 'result' | 'all';
  posts?: string;
  vacancies?: number | string;
  qualification?: string;
}

export interface SvcDetail {
  direct?: string;
  info?: string;
  ask?: string;
  yesLabel?: string;
  noLabel?: string;
  yesUrl?: string;
  noUrl?: string;
  yesSay?: string;
  noSay?: string;
}
