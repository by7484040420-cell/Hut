import React, { useCallback, useEffect, useState } from 'react';
import {
  Camera,
  Film,
  MessageCircle,
  Plus,
  Tv,
  WifiOff,
} from 'lucide-react';
import type {
  AppTab,
  ChatMessage,
  PhotoItem,
  UserProfile,
  VideoItem,
  WatchRoom,
} from './types';
import { useRealtimeSocket, type ServerEvent } from './hooks/useRealtimeSocket';
import { useOnlineStatus } from './hooks/usePWAInstall';
import { VideoSection } from './components/VideoSection';
import { PhotoSection } from './components/PhotoSection';
import { ChatSection } from './components/ChatSection';
import { WatchPartySection } from './components/WatchPartySection';
import { CreateModal } from './components/CreateModal';
import { ProfileModal } from './components/ProfileModal';
import { PWAInstallButton } from './components/PWAInstallButton';

const PROFILE_STORAGE_KEY = 'viberoom_profile_v1';

function loadOrCreateProfile(): UserProfile {
  try {
    const raw = localStorage.getItem(PROFILE_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as UserProfile;
      if (parsed.id && parsed.name) return parsed;
    }
  } catch {
    // ignore storage errors
  }
  const fresh: UserProfile = {
    id: crypto.randomUUID ? crypto.randomUUID() : `u-${Date.now()}`,
    name: `Friend ${Math.floor(100 + Math.random() * 900)}`,
    color: '#E11D48',
  };
  try {
    localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(fresh));
  } catch {
    // ignore
  }
  return fresh;
}

export function App() {
  const [profile, setProfile] = useState<UserProfile>(loadOrCreateProfile);
  const [activeTab, setActiveTab] = useState<AppTab>('videos');
  const [videos, setVideos] = useState<VideoItem[]>([]);
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [rooms, setRooms] = useState<WatchRoom[]>([]);
  const [loading, setLoading] = useState(true);

  const [activeRoomId, setActiveRoomId] = useState<string | null>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('room');
  });
  const [incomingRoomEvent, setIncomingRoomEvent] = useState<ServerEvent | null>(null);
  const [typingUsers, setTypingUsers] = useState<
    Record<string, { userName: string; expiresAt: number }>
  >({});

  const [createModalMode, setCreateModalMode] = useState<'video' | 'photo' | null>(null);
  const [showProfileModal, setShowProfileModal] = useState(false);

  const isOnline = useOnlineStatus();

  // Switch to Watch Party automatically if opened with ?room=
  useEffect(() => {
    if (activeRoomId) {
      setActiveTab('party');
    }
  }, [activeRoomId]);

  const handleServerEvent = useCallback((evt: ServerEvent) => {
    const type = String(evt.type || '');

    if (type === 'video:created' && evt.video) {
      const v = evt.video as VideoItem;
      setVideos((prev) => (prev.some((x) => x.id === v.id) ? prev : [v, ...prev]));
    } else if (type === 'video:updated' && evt.video) {
      const v = evt.video as VideoItem;
      setVideos((prev) => prev.map((x) => (x.id === v.id ? v : x)));
    } else if (type === 'photo:created' && evt.photo) {
      const p = evt.photo as PhotoItem;
      setPhotos((prev) => (prev.some((x) => x.id === p.id) ? prev : [p, ...prev]));
    } else if (type === 'photo:updated' && evt.photo) {
      const p = evt.photo as PhotoItem;
      setPhotos((prev) => prev.map((x) => (x.id === p.id ? p : x)));
    } else if (type === 'chat:message' && evt.message) {
      const m = evt.message as ChatMessage;
      setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
    } else if (type === 'chat:typing') {
      const channelId = String(evt.channelId || 'global');
      const cid = String(evt.clientId || '');
      const userName = String(evt.userName || 'Someone');
      const isTyping = Boolean(evt.isTyping);
      const key = `${channelId}::${cid}`;
      setTypingUsers((prev) => {
        const next = { ...prev };
        if (isTyping) {
          next[key] = { userName, expiresAt: Date.now() + 3000 };
        } else {
          delete next[key];
        }
        return next;
      });
    } else if (type === 'rooms:updated' && Array.isArray(evt.rooms)) {
      setRooms(evt.rooms as WatchRoom[]);
    } else if (
      type.startsWith('room:') ||
      type.startsWith('rtc:')
    ) {
      setIncomingRoomEvent(evt);
    }
  }, []);

  const { connected, clientId, onlineUsers, sendEvent } = useRealtimeSocket(
    profile,
    handleServerEvent
  );

  // Initial bootstrap load
  useEffect(() => {
    let mounted = true;
    fetch('/api/bootstrap')
      .then((r) => r.json())
      .then((data) => {
        if (!mounted) return;
        setVideos(Array.isArray(data.videos) ? data.videos : []);
        setPhotos(Array.isArray(data.photos) ? data.photos : []);
        setMessages(Array.isArray(data.messages) ? data.messages : []);
        setRooms(Array.isArray(data.rooms) ? data.rooms : []);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const handleSaveProfile = (updated: UserProfile) => {
    setProfile(updated);
    try {
      localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(updated));
    } catch {
      // ignore
    }
  };

  const uploadFile = async (file: File): Promise<string> => {
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch('/api/upload', { method: 'POST', body: fd });
    if (!res.ok) throw new Error('Upload failed');
    const data = await res.json();
    return String(data.url);
  };

  const handleCreateVideo = async (payload: {
    file: File;
    thumbnailFile?: File;
    title: string;
    category: string;
  }) => {
    const videoUrl = await uploadFile(payload.file);
    let thumbnailUrl = '/samples/video_thumb_cosmos.jpg';
    if (payload.thumbnailFile) {
      thumbnailUrl = await uploadFile(payload.thumbnailFile);
    }
    const res = await fetch('/api/videos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: payload.title,
        category: payload.category,
        channel: profile.name,
        channelColor: profile.color,
        videoUrl,
        thumbnailUrl,
      }),
    });
    const created = (await res.json()) as VideoItem;
    setVideos((prev) => (prev.some((v) => v.id === created.id) ? prev : [created, ...prev]));
  };

  const handleCreatePhoto = async (payload: {
    file: File;
    caption: string;
    location: string;
  }) => {
    const imageUrl = await uploadFile(payload.file);
    const res = await fetch('/api/photos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        author: profile.name,
        authorColor: profile.color,
        caption: payload.caption,
        location: payload.location,
        imageUrl,
      }),
    });
    const created = (await res.json()) as PhotoItem;
    setPhotos((prev) => (prev.some((p) => p.id === created.id) ? prev : [created, ...prev]));
  };

  const handleLikeVideo = async (videoId: string) => {
    const res = await fetch(`/api/videos/${videoId}/like`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: profile.id }),
    });
    if (res.ok) {
      const updated = (await res.json()) as VideoItem;
      setVideos((prev) => prev.map((v) => (v.id === updated.id ? updated : v)));
    }
  };

  const handleViewVideo = async (videoId: string) => {
    const res = await fetch(`/api/videos/${videoId}/view`, { method: 'POST' });
    if (res.ok) {
      const updated = (await res.json()) as VideoItem;
      setVideos((prev) => prev.map((v) => (v.id === updated.id ? updated : v)));
    }
  };

  const handleCommentVideo = async (videoId: string, text: string) => {
    const res = await fetch(`/api/videos/${videoId}/comment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        author: profile.name,
        authorColor: profile.color,
        text,
      }),
    });
    if (res.ok) {
      const updated = (await res.json()) as VideoItem;
      setVideos((prev) => prev.map((v) => (v.id === updated.id ? updated : v)));
    }
  };

  const handleLikePhoto = async (photoId: string) => {
    const res = await fetch(`/api/photos/${photoId}/like`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: profile.id }),
    });
    if (res.ok) {
      const updated = (await res.json()) as PhotoItem;
      setPhotos((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
    }
  };

  const handleCommentPhoto = async (photoId: string, text: string) => {
    const res = await fetch(`/api/photos/${photoId}/comment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        author: profile.name,
        authorColor: profile.color,
        text,
      }),
    });
    if (res.ok) {
      const updated = (await res.json()) as PhotoItem;
      setPhotos((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
    }
  };

  const handleSendMessage = (channelId: string, text: string, imageUrl?: string) => {
    const id = crypto.randomUUID ? crypto.randomUUID() : `m-${Date.now()}-${Math.random()}`;
    const optimistic: ChatMessage = {
      id,
      channelId,
      senderId: profile.id,
      senderName: profile.name,
      senderColor: profile.color,
      text,
      imageUrl,
      createdAt: Date.now(),
    };
    setMessages((prev) => [...prev, optimistic]);
    sendEvent({
      type: 'chat:send',
      id,
      channelId,
      text,
      imageUrl,
    });
  };

  const handleTyping = (channelId: string, isTyping: boolean) => {
    sendEvent({ type: 'chat:typing', channelId, isTyping });
  };

  const handleCreateRoom = async (payload: {
    name: string;
    videoId?: string;
    videoTitle?: string;
    videoUrl?: string;
    thumbnailUrl?: string;
  }) => {
    const res = await fetch('/api/rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...payload,
        hostName: profile.name,
      }),
    });
    const created = (await res.json()) as WatchRoom;
    setRooms((prev) => (prev.some((r) => r.id === created.id) ? prev : [created, ...prev]));
    return created;
  };

  const handleStartWatchPartyFromVideo = async (video: VideoItem) => {
    const created = await handleCreateRoom({
      name: `${video.title.slice(0, 32)} Party`,
      videoId: video.id,
      videoTitle: video.title,
      videoUrl: video.videoUrl,
      thumbnailUrl: video.thumbnailUrl,
    });
    setActiveRoomId(created.id);
    setActiveTab('party');
  };

  const NAV_ITEMS: Array<{ id: AppTab; label: string; icon: React.ReactNode }> = [
    { id: 'videos', label: 'Videos', icon: <Film className="w-5 h-5" /> },
    { id: 'photos', label: 'Photos', icon: <Camera className="w-5 h-5" /> },
    { id: 'chat', label: 'Chat', icon: <MessageCircle className="w-5 h-5" /> },
    { id: 'party', label: 'Watch Party', icon: <Tv className="w-5 h-5" /> },
  ];

  return (
    <div className="min-h-screen bg-[#09090B] text-zinc-100 flex flex-col">
      {/* Sticky Top Header (Compact 52px on mobile, 3-zone bar on desktop) */}
      <header className="sticky top-0 z-30 h-14 bg-[#09090B]/90 backdrop-blur-md border-b border-zinc-800/80">
        <div className="max-w-7xl mx-auto h-full px-4 flex items-center justify-between gap-8">
          {/* Zone 1: Brand Wordmark */}
          <button
            type="button"
            onClick={() => setActiveTab('videos')}
            className="text-lg font-display font-bold tracking-tight text-white whitespace-nowrap shrink-0"
          >
            VibeRoom
          </button>

          {/* Zone 2: Desktop Single-Line Navigation */}
          <nav className="hidden md:flex items-center gap-6">
            {NAV_ITEMS.map((item) => {
              const active = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveTab(item.id)}
                  className={`py-1.5 text-sm font-medium transition-colors whitespace-nowrap shrink-0 border-b-2 ${
                    active
                      ? 'text-white border-rose-500'
                      : 'text-zinc-400 border-transparent hover:text-zinc-100'
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </nav>

          {/* Zone 3: Primary Action + Profile */}
          <div className="flex items-center gap-2.5 shrink-0">
            <PWAInstallButton />

            <button
              type="button"
              onClick={() => setShowProfileModal(true)}
              aria-label="Edit your profile"
              className="inline-flex items-center gap-2 min-h-[40px] px-2.5 rounded-xl hover:bg-zinc-900 transition-colors whitespace-nowrap shrink-0"
            >
              <span
                className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white"
                style={{ backgroundColor: profile.color }}
              >
                {profile.name.slice(0, 1).toUpperCase()}
              </span>
              <span className="hidden sm:inline text-xs font-medium text-zinc-200 max-w-[110px] truncate">
                {profile.name}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setCreateModalMode(activeTab === 'photos' ? 'photo' : 'video')}
              className="inline-flex items-center gap-1.5 min-h-[40px] px-3.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold transition-colors whitespace-nowrap shrink-0"
            >
              <Plus className="w-4 h-4" />
              <span>Upload</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 py-5 pb-24 md:pb-8">
        {loading ? (
          <div className="py-20 text-center text-sm text-zinc-400">
            Loading VibeRoom...
          </div>
        ) : (
          <>
            {activeTab === 'videos' && (
              <VideoSection
                videos={videos}
                profile={profile}
                onLikeVideo={handleLikeVideo}
                onViewVideo={handleViewVideo}
                onCommentVideo={handleCommentVideo}
                onStartWatchParty={handleStartWatchPartyFromVideo}
                onOpenUploadVideo={() => setCreateModalMode('video')}
              />
            )}

            {activeTab === 'photos' && (
              <PhotoSection
                photos={photos}
                profile={profile}
                onLikePhoto={handleLikePhoto}
                onCommentPhoto={handleCommentPhoto}
                onCreatePhoto={handleCreatePhoto}
              />
            )}

            {activeTab === 'chat' && (
              <ChatSection
                profile={profile}
                connected={connected}
                onlineUsers={onlineUsers}
                messages={messages}
                typingUsers={typingUsers}
                onSendMessage={handleSendMessage}
                onTyping={handleTyping}
                onUploadFile={uploadFile}
              />
            )}

            {activeTab === 'party' && (
              <WatchPartySection
                profile={profile}
                clientId={clientId}
                rooms={rooms}
                videos={videos}
                onlineUsers={onlineUsers}
                messages={messages}
                activeRoomId={activeRoomId}
                incomingRoomEvent={incomingRoomEvent}
                onSelectRoom={(rid) => setActiveRoomId(rid)}
                onCreateRoom={handleCreateRoom}
                onUploadFile={uploadFile}
                onSendEvent={sendEvent}
                onSendMessage={handleSendMessage}
              />
            )}
          </>
        )}
      </main>

      {/* Mobile Bottom Thumb Tab Bar (64px height) */}
      <nav
        aria-label="Mobile navigation"
        className="md:hidden fixed bottom-0 left-0 right-0 z-40 h-16 pb-safe bg-[#09090B]/95 backdrop-blur-md border-t border-zinc-800 grid grid-cols-4 items-center"
      >
        {NAV_ITEMS.map((item) => {
          const active = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveTab(item.id)}
              className={`h-full flex flex-col items-center justify-center gap-1 transition-colors ${
                active ? 'text-rose-500' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {item.icon}
              <span className="text-[11px] font-medium tracking-tight leading-none whitespace-nowrap">
                {item.label}
              </span>
            </button>
          );
        })}
      </nav>

      {/* Offline Connectivity Banner */}
      {!isOnline && (
        <div className="fixed bottom-20 md:bottom-4 left-4 z-50 flex items-center gap-2 rounded-xl bg-amber-600 px-3.5 py-2 text-xs font-medium text-white shadow-lg">
          <WifiOff className="w-4 h-4" />
          Offline — Cached shell active
        </div>
      )}

      {/* Modals */}
      {createModalMode && (
        <CreateModal
          initialMode={createModalMode}
          onClose={() => setCreateModalMode(null)}
          onCreateVideo={handleCreateVideo}
          onCreatePhoto={handleCreatePhoto}
        />
      )}

      {showProfileModal && (
        <ProfileModal
          profile={profile}
          onSave={handleSaveProfile}
          onClose={() => setShowProfileModal(false)}
        />
      )}
    </div>
  );
}

export default App;
