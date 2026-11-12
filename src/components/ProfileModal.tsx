import React, { useState } from 'react';
import { X } from 'lucide-react';
import type { UserProfile } from '../types';

interface ProfileModalProps {
  profile: UserProfile;
  onSave: (updated: UserProfile) => void;
  onClose: () => void;
}

const AVATAR_COLORS = [
  '#E11D48',
  '#0284C7',
  '#059669',
  '#D97706',
  '#4F46E5',
  '#DB2777',
];

export const ProfileModal: React.FC<ProfileModalProps> = ({
  profile,
  onSave,
  onClose,
}) => {
  const [name, setName] = useState(profile.name);
  const [color, setColor] = useState(profile.color);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = name.trim();
    if (!cleaned) return;
    onSave({ ...profile, name: cleaned.slice(0, 32), color });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
      <form
        onSubmit={handleSubmit}
        className="w-full sm:max-w-md bg-zinc-900 border border-zinc-800 rounded-t-3xl sm:rounded-2xl p-5 space-y-5"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-zinc-100">Your Profile</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close profile dialog"
            className="min-h-[40px] min-w-[40px] rounded-xl text-zinc-400 hover:text-white hover:bg-zinc-800 flex items-center justify-center"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex items-center gap-4">
          <div
            className="w-14 h-14 rounded-full flex items-center justify-center text-xl font-bold text-white shrink-0"
            style={{ backgroundColor: color }}
          >
            {(name.trim() || 'G').slice(0, 1).toUpperCase()}
          </div>
          <div className="flex-1">
            <label className="block text-xs font-medium text-zinc-400 mb-1.5">
              Display Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={32}
              placeholder="Enter your name"
              className="w-full min-h-[44px] bg-zinc-950 border border-zinc-800 rounded-xl px-3.5 text-sm text-zinc-100 focus:outline-none focus:border-rose-500"
            />
          </div>
        </div>

        <div>
          <span className="block text-xs font-medium text-zinc-400 mb-2">
            Avatar Color
          </span>
          <div className="flex items-center gap-3">
            {AVATAR_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                aria-label={`Select color ${c}`}
                className={`w-9 h-9 rounded-full transition-transform ${
                  color === c ? 'ring-2 ring-white ring-offset-2 ring-offset-zinc-900 scale-110' : ''
                }`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] px-4 rounded-xl text-sm font-medium text-zinc-400 hover:text-white"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!name.trim()}
            className="min-h-[44px] px-5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-semibold text-sm disabled:opacity-40"
          >
            Save Profile
          </button>
        </div>
      </form>
    </div>
  );
};
