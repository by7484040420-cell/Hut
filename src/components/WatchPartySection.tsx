import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  Copy,
  Film,
  LogOut,
  Mic,
  MicOff,
  Pause,
  Phone,
  PhoneOff,
  Play,
  Plus,
  Send,
  Upload,
  Users,
  Volume2,
} from 'lucide-react';
import type {
  ChatMessage,
  OnlineUser,
  UserProfile,
  VideoItem,
  WatchRoom,
} from '../types';
import { MediaImage } from './MediaImage';
import { formatClock } from '../lib/format';
import type { ServerEvent } from '../hooks/useRealtimeSocket';

interface WatchPartySectionProps {
  profile: UserProfile;
  clientId: string | null;
  rooms: WatchRoom[];
  videos: VideoItem[];
  onlineUsers: OnlineUser[];
  messages: ChatMessage[];
  activeRoomId: string | null;
  incomingRoomEvent: ServerEvent | null;
  onSelectRoom: (roomId: string | null) => void;
  onCreateRoom: (payload: {
    name: string;
    videoId?: string;
    videoTitle?: string;
    videoUrl?: string;
    thumbnailUrl?: string;
  }) => Promise<WatchRoom>;
  onUploadFile: (file: File) => Promise<string>;
  onSendEvent: (payload: Record<string, unknown>) => void;
  onSendMessage: (channelId: string, text: string) => void;
}

const REACTIONS = ['❤️', '😂', '🔥', '👏', '😮'];

export const WatchPartySection: React.FC<WatchPartySectionProps> = ({
  profile,
  clientId,
  rooms,
  videos,
  onlineUsers,
  messages,
  activeRoomId,
  incomingRoomEvent,
  onSelectRoom,
  onCreateRoom,
  onUploadFile,
  onSendEvent,
  onSendMessage,
}) => {
  const [newRoomName, setNewRoomName] = useState('');
  const [selectedMovieId, setSelectedMovieId] = useState(videos[0]?.id || '');
  const [joinCode, setJoinCode] = useState('');
  const [creatingRoom, setCreatingRoom] = useState(false);
  const [uploadingMovie, setUploadingMovie] = useState(false);

  const [copiedLink, setCopiedLink] = useState(false);
  const [chatDraft, setChatDraft] = useState('');
  const [syncNotice, setSyncNotice] = useState('');
  const [floatingReactions, setFloatingReactions] = useState<
    Array<{ id: string; emoji: string; senderName: string }>
  >([]);
  const [showMoviePicker, setShowMoviePicker] = useState(false);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);

  // Sync video refs
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const isRemoteSyncRef = useRef(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  // WebRTC Voice Talk refs & state
  const [voiceActive, setVoiceActive] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [voiceError, setVoiceError] = useState('');
  const localStreamRef = useRef<MediaStream | null>(null);
  const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});
  const audioAnalyserRef = useRef<number | null>(null);

  const activeRoom = useMemo(
    () => rooms.find((r) => r.id === activeRoomId) || null,
    [rooms, activeRoomId]
  );

  const roomParticipants = useMemo(
    () => onlineUsers.filter((u) => u.roomId === activeRoomId),
    [onlineUsers, activeRoomId]
  );

  const roomMessages = useMemo(
    () =>
      activeRoomId
        ? messages.filter((m) => m.channelId === `room:${activeRoomId}`)
        : [],
    [messages, activeRoomId]
  );

  const chatEndRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [roomMessages.length]);

  // Join / leave room on WebSocket
  useEffect(() => {
    if (!activeRoomId) return;
    onSendEvent({ type: 'room:join', roomId: activeRoomId });
    return () => {
      onSendEvent({ type: 'room:leave', roomId: activeRoomId });
    };
  }, [activeRoomId, onSendEvent]);

  // Cleanup WebRTC when leaving room or unmounting
  const stopVoice = () => {
    if (audioAnalyserRef.current) {
      cancelAnimationFrame(audioAnalyserRef.current);
      audioAnalyserRef.current = null;
    }
    peersRef.current.forEach((pc) => pc.close());
    peersRef.current.clear();
    setRemoteStreams({});
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }
    setVoiceActive(false);
    setIsMuted(false);
    setIsSpeaking(false);
    if (activeRoomId) {
      onSendEvent({
        type: 'rtc:voice-state',
        roomId: activeRoomId,
        voiceActive: false,
        isMuted: false,
      });
    }
  };

  useEffect(() => {
    return () => {
      stopVoice();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRoomId]);

  // Create WebRTC peer connection helper
  const createPeerConnection = (targetClientId: string): RTCPeerConnection => {
    const existing = peersRef.current.get(targetClientId);
    if (existing) existing.close();

    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    });

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => {
        if (localStreamRef.current) {
          pc.addTrack(track, localStreamRef.current);
        }
      });
    }

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        onSendEvent({
          type: 'rtc:ice',
          targetClientId,
          candidate: event.candidate,
        });
      }
    };

    pc.ontrack = (event) => {
      const [stream] = event.streams;
      if (stream) {
        setRemoteStreams((prev) => ({ ...prev, [targetClientId]: stream }));
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        setRemoteStreams((prev) => {
          const next = { ...prev };
          delete next[targetClientId];
          return next;
        });
      }
    };

    peersRef.current.set(targetClientId, pc);
    return pc;
  };

  const handleJoinVoice = async () => {
    if (!activeRoomId) return;
    setVoiceError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      localStreamRef.current = stream;
      setVoiceActive(true);
      setIsMuted(false);

      // Voice activity detection
      try {
        const ctx = new AudioContext();
        const src = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        src.connect(analyser);
        const data = new Uint8Array(analyser.frequencyBinCount);
        const tick = () => {
          analyser.getByteFrequencyData(data);
          const avg = data.reduce((sum, v) => sum + v, 0) / data.length;
          setIsSpeaking(avg > 14);
          audioAnalyserRef.current = requestAnimationFrame(tick);
        };
        tick();
      } catch {
        // Optional audio meter
      }

      onSendEvent({
        type: 'rtc:voice-state',
        roomId: activeRoomId,
        voiceActive: true,
        isMuted: false,
      });

      // Initiate offers to peers already in voice
      for (const peer of roomParticipants) {
        if (peer.clientId !== clientId && peer.voiceActive) {
          const pc = createPeerConnection(peer.clientId);
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          onSendEvent({
            type: 'rtc:offer',
            targetClientId: peer.clientId,
            sdp: offer,
          });
        }
      }
    } catch {
      setVoiceError('Microphone permission is required for live voice talk.');
    }
  };

  const handleToggleMute = () => {
    if (!localStreamRef.current || !activeRoomId) return;
    const nextMuted = !isMuted;
    localStreamRef.current.getAudioTracks().forEach((t) => {
      t.enabled = !nextMuted;
    });
    setIsMuted(nextMuted);
    onSendEvent({
      type: 'rtc:voice-state',
      roomId: activeRoomId,
      voiceActive: true,
      isMuted: nextMuted,
    });
  };

  // Handle incoming room sync, reactions & WebRTC signaling
  useEffect(() => {
    if (!incomingRoomEvent) return;
    const type = String(incomingRoomEvent.type || '');

    if (type === 'room:state' && incomingRoomEvent.room) {
      const rm = incomingRoomEvent.room as WatchRoom;
      const vid = videoRef.current;
      if (vid) {
        isRemoteSyncRef.current = true;
        vid.currentTime = rm.currentTime || 0;
        setCurrentTime(rm.currentTime || 0);
        setIsPlaying(rm.isPlaying);
        if (rm.isPlaying) {
          vid.play().catch(() => setAutoplayBlocked(true));
        } else {
          vid.pause();
        }
        window.setTimeout(() => {
          isRemoteSyncRef.current = false;
        }, 350);
      }
      return;
    }

    if (type === 'room:player-sync' && incomingRoomEvent.roomId === activeRoomId) {
      const vid = videoRef.current;
      const action = String(incomingRoomEvent.action || '');
      const targetTime = Number(incomingRoomEvent.currentTime || 0);
      const actor = String(incomingRoomEvent.actorName || 'Friend');
      const shouldPlay = Boolean(incomingRoomEvent.isPlaying);

      setSyncNotice(`${actor} ${action === 'play' ? 'resumed' : action === 'pause' ? 'paused' : action === 'seek' ? `jumped to ${formatClock(targetTime)}` : 'changed the movie'}`);
      window.setTimeout(() => setSyncNotice(''), 2500);

      if (vid) {
        isRemoteSyncRef.current = true;
        if (Math.abs(vid.currentTime - targetTime) > 1.2 || action === 'seek' || action === 'change-video') {
          vid.currentTime = targetTime;
        }
        setCurrentTime(targetTime);
        setIsPlaying(shouldPlay);
        if (shouldPlay) {
          vid.play().catch(() => setAutoplayBlocked(true));
        } else {
          vid.pause();
        }
        window.setTimeout(() => {
          isRemoteSyncRef.current = false;
        }, 350);
      }
      return;
    }

    if (type === 'room:reaction' && incomingRoomEvent.roomId === activeRoomId) {
      const item = {
        id: String(incomingRoomEvent.id || Date.now()),
        emoji: String(incomingRoomEvent.emoji || '❤️'),
        senderName: String(incomingRoomEvent.senderName || ''),
      };
      setFloatingReactions((prev) => [...prev.slice(-8), item]);
      window.setTimeout(() => {
        setFloatingReactions((prev) => prev.filter((r) => r.id !== item.id));
      }, 2400);
      return;
    }

    if (type === 'rtc:offer') {
      const fromClientId = String(incomingRoomEvent.fromClientId || '');
      const sdp = incomingRoomEvent.sdp as RTCSessionDescriptionInit;
      if (!fromClientId || !sdp) return;
      (async () => {
        const pc = createPeerConnection(fromClientId);
        await pc.setRemoteDescription(new RTCSessionDescription(sdp));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        onSendEvent({
          type: 'rtc:answer',
          targetClientId: fromClientId,
          sdp: answer,
        });
      })();
      return;
    }

    if (type === 'rtc:answer') {
      const fromClientId = String(incomingRoomEvent.fromClientId || '');
      const sdp = incomingRoomEvent.sdp as RTCSessionDescriptionInit;
      const pc = peersRef.current.get(fromClientId);
      if (pc && sdp) {
        pc.setRemoteDescription(new RTCSessionDescription(sdp)).catch(() => {});
      }
      return;
    }

    if (type === 'rtc:ice') {
      const fromClientId = String(incomingRoomEvent.fromClientId || '');
      const candidate = incomingRoomEvent.candidate as RTCIceCandidateInit;
      const pc = peersRef.current.get(fromClientId);
      if (pc && candidate) {
        pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => {});
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incomingRoomEvent, activeRoomId]);

  const handleTogglePlayPause = () => {
    const vid = videoRef.current;
    if (!vid || !activeRoom) return;
    setAutoplayBlocked(false);
    if (vid.paused) {
      vid.play().catch(() => {});
    } else {
      vid.pause();
    }
  };

  const handleVideoPlay = () => {
    setIsPlaying(true);
    setAutoplayBlocked(false);
    if (isRemoteSyncRef.current || !activeRoom) return;
    onSendEvent({
      type: 'room:player-sync',
      roomId: activeRoom.id,
      action: 'play',
      currentTime: videoRef.current?.currentTime || 0,
    });
  };

  const handleVideoPause = () => {
    setIsPlaying(false);
    if (isRemoteSyncRef.current || !activeRoom) return;
    onSendEvent({
      type: 'room:player-sync',
      roomId: activeRoom.id,
      action: 'pause',
      currentTime: videoRef.current?.currentTime || 0,
    });
  };

  const handleSeek = (newTime: number) => {
    const vid = videoRef.current;
    if (!vid || !activeRoom) return;
    vid.currentTime = newTime;
    setCurrentTime(newTime);
    onSendEvent({
      type: 'room:player-sync',
      roomId: activeRoom.id,
      action: 'seek',
      currentTime: newTime,
    });
  };

  const handleSwitchMovie = (video: VideoItem) => {
    if (!activeRoom) return;
    setShowMoviePicker(false);
    onSendEvent({
      type: 'room:player-sync',
      roomId: activeRoom.id,
      action: 'change-video',
      currentTime: 0,
      videoId: video.id,
      videoTitle: video.title,
      videoUrl: video.videoUrl,
      thumbnailUrl: video.thumbnailUrl,
    });
  };

  const handleUploadMovieToRoom = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !activeRoom) return;
    setUploadingMovie(true);
    try {
      const url = await onUploadFile(file);
      const cleanName = file.name.replace(/\.[^/.]+$/, '');
      onSendEvent({
        type: 'room:player-sync',
        roomId: activeRoom.id,
        action: 'change-video',
        currentTime: 0,
        videoId: `custom-${Date.now()}`,
        videoTitle: cleanName,
        videoUrl: url,
        thumbnailUrl: '/samples/video_thumb_cosmos.jpg',
      });
      setShowMoviePicker(false);
    } finally {
      setUploadingMovie(false);
    }
  };

  const handleCreateRoomSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (creatingRoom) return;
    setCreatingRoom(true);
    try {
      const chosen = videos.find((v) => v.id === selectedMovieId) || videos[0];
      const created = await onCreateRoom({
        name: newRoomName.trim() || `${profile.name}'s Movie Night`,
        videoId: chosen?.id,
        videoTitle: chosen?.title,
        videoUrl: chosen?.videoUrl,
        thumbnailUrl: chosen?.thumbnailUrl,
      });
      setNewRoomName('');
      onSelectRoom(created.id);
    } finally {
      setCreatingRoom(false);
    }
  };

  const handleJoinByCode = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = joinCode.trim();
    if (!cleaned) return;
    const match = rooms.find((r) => r.id.toLowerCase() === cleaned.toLowerCase());
    if (match) {
      onSelectRoom(match.id);
      setJoinCode('');
    }
  };

  const handleCopyInvite = () => {
    if (!activeRoom) return;
    const url = `${window.location.origin}/?room=${encodeURIComponent(activeRoom.id)}`;
    navigator.clipboard?.writeText(url);
    setCopiedLink(true);
    window.setTimeout(() => setCopiedLink(false), 2000);
  };

  const handleSendRoomChat = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeRoom || !chatDraft.trim()) return;
    onSendMessage(`room:${activeRoom.id}`, chatDraft.trim());
    setChatDraft('');
  };

  // ---- Room Lobby View ----
  if (!activeRoom) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Create Watch Party */}
          <form
            onSubmit={handleCreateRoomSubmit}
            className="lg:col-span-7 bg-zinc-900/60 border border-zinc-800 rounded-2xl p-5 space-y-4"
          >
            <div>
              <h2 className="text-lg font-semibold text-zinc-100">
                Start a Group Watch Party
              </h2>
              <p className="text-xs text-zinc-400 mt-0.5">
                Watch movies in real-time sync with friends, chat live, and talk over voice.
              </p>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1.5">
                  Room Name
                </label>
                <input
                  type="text"
                  value={newRoomName}
                  onChange={(e) => setNewRoomName(e.target.value)}
                  placeholder={`${profile.name}'s Movie Night`}
                  className="w-full min-h-[44px] bg-zinc-950 border border-zinc-800 rounded-xl px-3.5 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-rose-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1.5">
                  Starting Movie / Video
                </label>
                <select
                  value={selectedMovieId}
                  onChange={(e) => setSelectedMovieId(e.target.value)}
                  className="w-full min-h-[44px] bg-zinc-950 border border-zinc-800 rounded-xl px-3.5 text-sm text-zinc-100 focus:outline-none focus:border-rose-500"
                >
                  {videos.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.title} ({v.duration})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <button
              type="submit"
              disabled={creatingRoom}
              className="w-full sm:w-auto min-h-[44px] px-5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-semibold text-sm inline-flex items-center justify-center gap-2 transition-colors"
            >
              <Plus className="w-4 h-4" />
              {creatingRoom ? 'Creating Room...' : 'Create Watch Party'}
            </button>
          </form>

          {/* Join by Code */}
          <form
            onSubmit={handleJoinByCode}
            className="lg:col-span-5 bg-zinc-900/60 border border-zinc-800 rounded-2xl p-5 flex flex-col justify-between gap-4"
          >
            <div>
              <h2 className="text-lg font-semibold text-zinc-100">Join with Room Code</h2>
              <p className="text-xs text-zinc-400 mt-0.5">
                Paste a friend&apos;s room code (like <span className="font-mono text-zinc-300">cinema-lounge</span>) to sync instantly.
              </p>
            </div>

            <div className="flex gap-2">
              <input
                type="text"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value)}
                placeholder="Enter room code..."
                className="flex-1 min-h-[44px] bg-zinc-950 border border-zinc-800 rounded-xl px-3.5 text-sm font-mono text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-rose-500"
              />
              <button
                type="submit"
                disabled={!joinCode.trim()}
                className="min-h-[44px] px-5 rounded-xl bg-zinc-100 text-zinc-950 font-semibold text-sm hover:bg-white disabled:opacity-40 transition-colors whitespace-nowrap"
              >
                Join
              </button>
            </div>
          </form>
        </div>

        {/* Active Watch Party Rooms */}
        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-zinc-300">Live Rooms</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {rooms.map((room) => {
              const count = onlineUsers.filter((u) => u.roomId === room.id).length;
              return (
                <button
                  key={room.id}
                  type="button"
                  onClick={() => onSelectRoom(room.id)}
                  className="text-left bg-zinc-900/50 border border-zinc-800 hover:border-zinc-700 rounded-2xl overflow-hidden transition-colors group"
                >
                  <div className="relative aspect-video w-full bg-zinc-950 overflow-hidden">
                    <MediaImage
                      src={room.thumbnailUrl}
                      alt={room.videoTitle}
                      className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-200"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
                    <div className="absolute bottom-2.5 left-3 right-3 flex items-center justify-between text-xs text-white">
                      <span className="font-mono">{room.id}</span>
                      <span className="inline-flex items-center gap-1 font-mono">
                        <Users className="w-3.5 h-3.5" />
                        {count} watching
                      </span>
                    </div>
                  </div>
                  <div className="p-4">
                    <div className="text-sm font-semibold text-zinc-100 truncate">
                      {room.name}
                    </div>
                    <div className="text-xs text-zinc-400 truncate mt-1">
                      Now playing: {room.videoTitle}
                    </div>
                    <div className="text-xs text-zinc-500 mt-1">
                      Hosted by {room.hostName}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      </div>
    );
  }

  // ---- Active Synchronized Theater View ----
  return (
    <div className="space-y-4">
      {/* Hidden audio elements for remote WebRTC voice streams */}
      {Object.entries(remoteStreams).map(([peerId, stream]) => (
        <RemoteAudio key={peerId} stream={stream} />
      ))}

      {/* Room Top Strip */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-zinc-900/60 border border-zinc-800 rounded-2xl px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <h2 className="text-base font-semibold text-zinc-100 truncate">
              {activeRoom.name}
            </h2>
            <span className="text-xs font-mono text-zinc-400">
              {activeRoom.id}
            </span>
          </div>
          <p className="text-xs text-zinc-400 truncate">
            {activeRoom.videoTitle} · {roomParticipants.length} in room
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => setShowMoviePicker((s) => !s)}
            className="min-h-[40px] px-3 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-xs font-medium text-zinc-100 inline-flex items-center gap-1.5 whitespace-nowrap"
          >
            <Film className="w-3.5 h-3.5 text-rose-400" />
            Change Movie
          </button>

          <button
            type="button"
            onClick={handleCopyInvite}
            className="min-h-[40px] px-3 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-xs font-medium text-zinc-100 inline-flex items-center gap-1.5 whitespace-nowrap"
          >
            {copiedLink ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            {copiedLink ? 'Copied' : 'Invite'}
          </button>

          <button
            type="button"
            onClick={() => {
              stopVoice();
              onSelectRoom(null);
            }}
            className="min-h-[40px] px-3 rounded-xl bg-zinc-950 border border-zinc-800 hover:border-zinc-700 text-xs font-medium text-zinc-300 inline-flex items-center gap-1.5 whitespace-nowrap"
          >
            <LogOut className="w-3.5 h-3.5" />
            Leave
          </button>
        </div>
      </div>

      {/* Movie Picker Drawer */}
      {showMoviePicker && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-zinc-100">
              Select or Upload a Movie for Everyone
            </h3>
            <label className="min-h-[40px] px-3.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap">
              <Upload className="w-3.5 h-3.5" />
              {uploadingMovie ? 'Uploading...' : 'Upload Movie File'}
              <input
                type="file"
                accept="video/*"
                onChange={handleUploadMovieToRoom}
                className="hidden"
              />
            </label>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {videos.map((v) => (
              <button
                key={v.id}
                type="button"
                onClick={() => handleSwitchMovie(v)}
                className="text-left p-2 rounded-xl bg-zinc-950 border border-zinc-800 hover:border-rose-500 flex items-center gap-3 transition-colors"
              >
                <MediaImage
                  src={v.thumbnailUrl}
                  alt={v.title}
                  className="w-16 aspect-video rounded object-cover shrink-0"
                />
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-zinc-100 truncate">
                    {v.title}
                  </div>
                  <div className="text-[11px] text-zinc-400 font-mono">{v.duration}</div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Split Cinema Grid: Left Movie + Voice, Right Friends Group Chat */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        <div className="lg:col-span-8 space-y-4">
          {/* Synchronized Player */}
          <div className="relative aspect-video w-full rounded-2xl overflow-hidden bg-black border border-zinc-800">
            <video
              ref={videoRef}
              key={activeRoom.videoUrl}
              src={activeRoom.videoUrl}
              poster={activeRoom.thumbnailUrl}
              playsInline
              onPlay={handleVideoPlay}
              onPause={handleVideoPause}
              onTimeUpdate={() => setCurrentTime(videoRef.current?.currentTime || 0)}
              onLoadedMetadata={() => setDuration(videoRef.current?.duration || 0)}
              onClick={handleTogglePlayPause}
              className="w-full h-full object-contain bg-black cursor-pointer"
            />

            {/* Floating Reactions */}
            <div className="pointer-events-none absolute bottom-16 right-4 flex flex-col items-end gap-1.5">
              {floatingReactions.map((r) => (
                <div
                  key={r.id}
                  className="bg-black/75 backdrop-blur-sm text-white text-xs px-2.5 py-1 rounded-full flex items-center gap-1.5"
                >
                  <span className="text-base">{r.emoji}</span>
                  <span className="text-[11px] text-zinc-300">{r.senderName}</span>
                </div>
              ))}
            </div>

            {syncNotice && (
              <div className="pointer-events-none absolute top-3 left-3 bg-black/80 text-zinc-100 text-xs px-3 py-1.5 rounded-lg">
                {syncNotice}
              </div>
            )}

            {autoplayBlocked && (
              <button
                type="button"
                onClick={handleTogglePlayPause}
                className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center gap-2 text-white"
              >
                <Play className="w-10 h-10 fill-white" />
                <span className="text-sm font-semibold">Tap to sync with room</span>
              </button>
            )}
          </div>

          {/* Custom Synchronized Controls & Reactions */}
          <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-3.5 space-y-3">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleTogglePlayPause}
                aria-label={isPlaying ? 'Pause for all' : 'Play for all'}
                className="min-h-[44px] min-w-[44px] rounded-xl bg-rose-600 hover:bg-rose-500 text-white flex items-center justify-center transition-colors shrink-0"
              >
                {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 fill-white" />}
              </button>

              <input
                type="range"
                min={0}
                max={duration || 30}
                step={0.25}
                value={currentTime}
                onChange={(e) => handleSeek(Number(e.target.value))}
                aria-label="Seek movie timeline"
                className="flex-1 accent-rose-500 cursor-pointer"
              />

              <span className="text-xs font-mono text-zinc-300 shrink-0">
                {formatClock(currentTime)} / {formatClock(duration)}
              </span>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-zinc-800/80">
              <div className="flex items-center gap-1.5">
                {REACTIONS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() =>
                      onSendEvent({
                        type: 'room:reaction',
                        roomId: activeRoom.id,
                        emoji,
                      })
                    }
                    className="min-h-[38px] min-w-[38px] rounded-lg bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 text-base transition-transform active:scale-90"
                  >
                    {emoji}
                  </button>
                ))}
              </div>

              {/* Voice Talk Controls */}
              <div className="flex items-center gap-2">
                {!voiceActive ? (
                  <button
                    type="button"
                    onClick={handleJoinVoice}
                    className="min-h-[40px] px-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap"
                  >
                    <Phone className="w-3.5 h-3.5" />
                    Join Voice Talk
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={handleToggleMute}
                      className={`min-h-[40px] px-3.5 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap ${
                        isMuted
                          ? 'bg-zinc-800 text-zinc-300'
                          : 'bg-emerald-600/20 border border-emerald-500/60 text-emerald-300'
                      }`}
                    >
                      {isMuted ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
                      {isMuted ? 'Muted' : isSpeaking ? 'Speaking' : 'Mic On'}
                    </button>
                    <button
                      type="button"
                      onClick={stopVoice}
                      className="min-h-[40px] px-3 rounded-xl bg-rose-600/20 border border-rose-500/50 text-rose-300 text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap"
                    >
                      <PhoneOff className="w-3.5 h-3.5" />
                      End Voice
                    </button>
                  </>
                )}
              </div>
            </div>

            {voiceError && (
              <p className="text-xs text-rose-400">{voiceError}</p>
            )}

            {/* Participants & Voice Strip */}
            <div className="flex flex-wrap items-center gap-3 pt-1 text-xs text-zinc-400">
              <span className="inline-flex items-center gap-1 font-medium text-zinc-300">
                <Volume2 className="w-3.5 h-3.5 text-zinc-400" />
                In Room:
              </span>
              {roomParticipants.map((u) => (
                <span key={u.clientId} className="inline-flex items-center gap-1.5 text-zinc-200">
                  <span
                    className="w-2 h-2 rounded-full"
                    style={{ backgroundColor: u.color }}
                  />
                  <span>{u.name}</span>
                  {u.voiceActive && (
                    <span className="text-[11px] text-emerald-400">
                      {u.isMuted ? '(muted)' : '(voice)'}
                    </span>
                  )}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Friends Group Movie Chat */}
        <aside className="lg:col-span-4 bg-zinc-900/60 border border-zinc-800 rounded-2xl flex flex-col h-[420px] lg:h-[540px] overflow-hidden">
          <div className="px-4 py-3 border-b border-zinc-800 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-zinc-100">Group Movie Chat</h3>
            <span className="text-xs font-mono text-zinc-400">
              {roomParticipants.length} live
            </span>
          </div>

          <div className="flex-1 overflow-y-auto p-3.5 space-y-2.5">
            {roomMessages.length === 0 ? (
              <p className="text-xs text-zinc-500 text-center py-8">
                Say hi to your friends watching this movie together.
              </p>
            ) : (
              roomMessages.map((m) => (
                <div key={m.id} className="text-sm leading-snug">
                  <span
                    className="font-semibold mr-2"
                    style={{ color: m.senderColor }}
                  >
                    {m.senderName}
                  </span>
                  <span className="text-zinc-200 break-words">{m.text}</span>
                </div>
              ))
            )}
            <div ref={chatEndRef} />
          </div>

          <form onSubmit={handleSendRoomChat} className="p-3 border-t border-zinc-800 flex gap-2">
            <input
              type="text"
              value={chatDraft}
              onChange={(e) => setChatDraft(e.target.value)}
              placeholder="Chat with friends..."
              className="flex-1 min-h-[42px] bg-zinc-950 border border-zinc-800 rounded-xl px-3 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-rose-500"
            />
            <button
              type="submit"
              disabled={!chatDraft.trim()}
              aria-label="Send group chat message"
              className="min-h-[42px] min-w-[42px] rounded-xl bg-rose-600 hover:bg-rose-500 text-white flex items-center justify-center disabled:opacity-40 transition-colors shrink-0"
            >
              <Send className="w-4 h-4" />
            </button>
          </form>
        </aside>
      </div>
    </div>
  );
};

const RemoteAudio: React.FC<{ stream: MediaStream }> = ({ stream }) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.srcObject = stream;
    }
  }, [stream]);
  return <audio ref={audioRef} autoPlay playsInline className="hidden" />;
};
