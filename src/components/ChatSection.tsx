import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ImagePlus, MessageCircle, Send, Users } from 'lucide-react';
import type { ChatMessage, OnlineUser, UserProfile } from '../types';
import { MediaImage } from './MediaImage';
import { formatTimeAgo } from '../lib/format';

interface ChatSectionProps {
  profile: UserProfile;
  connected: boolean;
  onlineUsers: OnlineUser[];
  messages: ChatMessage[];
  typingUsers: Record<string, { userName: string; expiresAt: number }>;
  onSendMessage: (channelId: string, text: string, imageUrl?: string) => void;
  onTyping: (channelId: string, isTyping: boolean) => void;
  onUploadFile: (file: File) => Promise<string>;
}

function makeDmChannelId(a: string, b: string): string {
  return `dm:${[a, b].sort().join('_')}`;
}

export const ChatSection: React.FC<ChatSectionProps> = ({
  profile,
  connected,
  onlineUsers,
  messages,
  typingUsers,
  onSendMessage,
  onTyping,
  onUploadFile,
}) => {
  const [activeChannel, setActiveChannel] = useState('global');
  const [draft, setDraft] = useState('');
  const [pendingImageUrl, setPendingImageUrl] = useState<string>('');
  const [uploadingImage, setUploadingImage] = useState(false);
  const logEndRef = useRef<HTMLDivElement | null>(null);
  const typingTimeoutRef = useRef<number | null>(null);

  const uniqueFriends = useMemo(() => {
    const map = new Map<string, OnlineUser>();
    onlineUsers.forEach((u) => {
      if (u.userId !== profile.id && !map.has(u.userId)) {
        map.set(u.userId, u);
      }
    });
    return Array.from(map.values());
  }, [onlineUsers, profile.id]);

  const channels = useMemo(() => {
    const base: Array<{ id: string; title: string; subtitle: string; color?: string }> = [
      { id: 'global', title: 'Friends Lounge', subtitle: 'Live public SMS & group chat' },
      { id: 'group:movies', title: 'Movie Club', subtitle: 'Discuss films & share clips' },
    ];
    const dms = uniqueFriends.map((u) => ({
      id: makeDmChannelId(profile.id, u.userId),
      title: u.name,
      subtitle: 'Direct message · Online',
      color: u.color,
    }));
    return [...base, ...dms];
  }, [uniqueFriends, profile.id]);

  const activeChannelInfo =
    channels.find((c) => c.id === activeChannel) || channels[0];

  const channelMessages = useMemo(
    () => messages.filter((m) => m.channelId === activeChannel),
    [messages, activeChannel]
  );

  const activeTypers = useMemo(() => {
    const now = Date.now();
    return Object.entries(typingUsers)
      .filter(([key, val]) => key.startsWith(`${activeChannel}::`) && val.expiresAt > now)
      .map(([, val]) => val.userName);
  }, [typingUsers, activeChannel]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [channelMessages.length, activeChannel]);

  const handleInputChange = (value: string) => {
    setDraft(value);
    onTyping(activeChannel, value.trim().length > 0);
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = window.setTimeout(() => {
      onTyping(activeChannel, false);
    }, 2000);
  };

  const handleImagePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingImage(true);
    try {
      const url = await onUploadFile(file);
      setPendingImageUrl(url);
    } finally {
      setUploadingImage(false);
    }
  };

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.trim() && !pendingImageUrl) return;
    onSendMessage(activeChannel, draft.trim(), pendingImageUrl || undefined);
    setDraft('');
    setPendingImageUrl('');
    onTyping(activeChannel, false);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 h-[calc(100vh-195px)] min-h-[500px]">
      {/* Channels & Online Friends List */}
      <aside className="lg:col-span-4 bg-zinc-900/50 border border-zinc-800/80 rounded-2xl p-3 flex flex-col gap-3 overflow-y-auto max-h-52 lg:max-h-none">
        <div className="px-2 pt-1 flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-semibold text-zinc-300">
            <Users className="w-4 h-4 text-zinc-400" />
            <span>Channels & Friends</span>
          </div>
          <span className="inline-flex items-center gap-1.5 text-xs font-mono text-zinc-400">
            {connected && (
              <span className="w-2 h-2 rounded-full bg-emerald-500" aria-hidden="true" />
            )}
            {onlineUsers.length} online
          </span>
        </div>

        <div className="space-y-1">
          {channels.map((ch) => {
            const isActive = ch.id === activeChannel;
            const lastMsg = messages
              .filter((m) => m.channelId === ch.id)
              .slice(-1)[0];

            return (
              <button
                key={ch.id}
                type="button"
                onClick={() => setActiveChannel(ch.id)}
                className={`w-full text-left px-3 py-2.5 rounded-xl flex items-center gap-3 transition-colors min-h-[52px] ${
                  isActive
                    ? 'bg-zinc-800 text-white'
                    : 'text-zinc-300 hover:bg-zinc-800/50'
                }`}
              >
                <div
                  className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-semibold text-white shrink-0"
                  style={{ backgroundColor: 'color' in ch && ch.color ? ch.color : '#E11D48' }}
                >
                  {ch.title.slice(0, 1).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold truncate">{ch.title}</span>
                    {lastMsg && (
                      <span className="text-[11px] text-zinc-500 shrink-0 font-mono">
                        {formatTimeAgo(lastMsg.createdAt)}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-zinc-400 truncate">
                    {lastMsg
                      ? `${lastMsg.senderName}: ${lastMsg.text || 'Photo'}`
                      : ch.subtitle}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </aside>

      {/* Active Chat Thread */}
      <section className="lg:col-span-8 bg-zinc-900/50 border border-zinc-800/80 rounded-2xl flex flex-col overflow-hidden">
        {/* Channel Header */}
        <div className="px-4 py-3 border-b border-zinc-800 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <MessageCircle className="w-5 h-5 text-rose-500 shrink-0" />
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-zinc-100 truncate">
                {activeChannelInfo.title}
              </h2>
              <p className="text-xs text-zinc-400 truncate">
                {activeTypers.length > 0
                  ? `${activeTypers.join(', ')} typing...`
                  : activeChannelInfo.subtitle}
              </p>
            </div>
          </div>
          <span className="text-xs font-mono text-zinc-400 shrink-0">
            {connected ? 'Live SMS' : 'Reconnecting'}
          </span>
        </div>

        {/* Message Stream */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {channelMessages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center py-12 px-4">
              <MessageCircle className="w-8 h-8 text-zinc-600 mb-2" />
              <p className="text-sm font-medium text-zinc-300">
                No messages in {activeChannelInfo.title} yet
              </p>
              <p className="text-xs text-zinc-500 mt-1 max-w-sm">
                Send a message or share a photo below. Anyone connected to VibeRoom sees messages immediately.
              </p>
            </div>
          ) : (
            channelMessages.map((m) => {
              const isSelf = m.senderId === profile.id;
              return (
                <div
                  key={m.id}
                  className={`flex items-end gap-2.5 ${isSelf ? 'justify-end' : 'justify-start'}`}
                >
                  {!isSelf && (
                    <div
                      className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-semibold text-white shrink-0"
                      style={{ backgroundColor: m.senderColor }}
                    >
                      {m.senderName.slice(0, 1).toUpperCase()}
                    </div>
                  )}

                  <div
                    className={`max-w-[78%] rounded-2xl px-3.5 py-2.5 space-y-1.5 ${
                      isSelf
                        ? 'bg-rose-600 text-white rounded-br-sm'
                        : 'bg-zinc-800 text-zinc-100 rounded-bl-sm'
                    }`}
                  >
                    {!isSelf && (
                      <div className="text-[11px] font-semibold text-zinc-300">
                        {m.senderName}
                      </div>
                    )}
                    {m.imageUrl && (
                      <div className="rounded-xl overflow-hidden max-w-xs border border-black/20">
                        <MediaImage
                          src={m.imageUrl}
                          alt="Shared in chat"
                          className="w-full max-h-60 object-cover"
                        />
                      </div>
                    )}
                    {m.text && (
                      <p className="text-sm leading-relaxed break-words">{m.text}</p>
                    )}
                    <div
                      className={`text-[10px] font-mono ${
                        isSelf ? 'text-rose-100/80 text-right' : 'text-zinc-400'
                      }`}
                    >
                      {new Date(m.createdAt).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </div>
                  </div>
                </div>
              );
            })
          )}
          <div ref={logEndRef} />
        </div>

        {/* Pending image preview */}
        {pendingImageUrl && (
          <div className="px-4 py-2 border-t border-zinc-800 bg-zinc-950/60 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <img
                src={pendingImageUrl}
                alt="Attachment preview"
                className="w-12 h-12 rounded-lg object-cover border border-zinc-800"
              />
              <span className="text-xs text-zinc-300">Photo attached</span>
            </div>
            <button
              type="button"
              onClick={() => setPendingImageUrl('')}
              className="text-xs text-zinc-400 hover:text-white px-2 py-1"
            >
              Remove
            </button>
          </div>
        )}

        {/* Message Input Bar */}
        <form onSubmit={handleSend} className="p-3 border-t border-zinc-800 flex items-center gap-2">
          <label
            title="Attach photo"
            className="min-h-[44px] min-w-[44px] rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 flex items-center justify-center cursor-pointer transition-colors shrink-0"
          >
            <ImagePlus className="w-5 h-5" />
            <input
              type="file"
              accept="image/*"
              onChange={handleImagePick}
              className="hidden"
            />
          </label>

          <input
            type="text"
            value={draft}
            onChange={(e) => handleInputChange(e.target.value)}
            placeholder={uploadingImage ? 'Uploading photo...' : `Message ${activeChannelInfo.title}...`}
            className="flex-1 min-h-[44px] bg-zinc-950 border border-zinc-800 rounded-xl px-3.5 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-rose-500"
          />

          <button
            type="submit"
            disabled={(!draft.trim() && !pendingImageUrl) || uploadingImage}
            className="min-h-[44px] px-4 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-semibold text-sm disabled:opacity-40 inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
          >
            <Send className="w-4 h-4" />
            <span className="hidden sm:inline">Send</span>
          </button>
        </form>
      </section>
    </div>
  );
};
