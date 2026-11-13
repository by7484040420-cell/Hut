import type { AppCategory, ProfileVault } from '../types';

export const CATEGORY_LABELS: Record<AppCategory, string> = {
  job: 'Job Application',
  court_block: 'Court / Kachahari / Block',
  pan: 'PAN Card',
  passport: 'Passport',
  dl: 'Driving License (DL)',
  ticket: 'Train / Flight Ticket',
  hotel: 'Hotel Booking',
  custom: 'Custom Online Form',
};

export function formatIsoTime(iso?: string): string {
  if (!iso) return '';
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return '';
  const diff = Math.max(0, Date.now() - ts);
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'Just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return new Date(ts).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export function getVaultCompletion(profile: ProfileVault): { filled: number; total: number; percent: number } {
  const keys: (keyof ProfileVault)[] = [
    'fullName',
    'fatherName',
    'motherName',
    'dob',
    'gender',
    'mobile',
    'email',
    'addressLine',
    'blockOrTehsil',
    'district',
    'state',
    'pinCode',
    'qualification',
    'panNumber',
  ];
  const filled = keys.filter((k) => {
    const val = profile[k];
    return typeof val === 'string' && val.trim().length > 0;
  }).length;
  return {
    filled,
    total: keys.length,
    percent: Math.round((filled / keys.length) * 100),
  };
}
