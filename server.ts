import express from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import { WebSocketServer, WebSocket } from 'ws';
import crypto from 'crypto';
import type {
  VideoItem,
  PhotoItem,
  ChatMessage,
  WatchRoom,
  OnlineUser,
} from './src/types.ts';

const PORT = Number(process.env.PORT) || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';

const DATA_DIR = path.resolve('data');
const UPLOAD_DIR = path.resolve('uploads');
const STORE_FILE = path.join(DATA_DIR, 'store.json');

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

interface StoreData {
  videos: VideoItem[];
  photos: PhotoItem[];
  messages: ChatMessage[];
  rooms: WatchRoom[];
}

function getInitialStore(): StoreData {
  const now = Date.now();
  return {
    videos: [
      {
        id: 'vid-horizon',
        title: 'Across the Horizon Ridge — Twilight Short Film',
        channel: 'Aarav Cinema',
        channelColor: '#E11D48',
        category: 'Cinema',
        videoUrl: '/media/horizon_ridge.mp4',
        thumbnailUrl: '/samples/video_thumb_cosmos.jpg',
        duration: '0:30',
        views: 1840,
        likes: 214,
        likedBy: [],
        comments: [
          {
            id: 'c-1',
            author: 'Riya',
            authorColor: '#0284C7',
            text: 'The twilight grading on this ridge shot is incredible.',
            createdAt: now - 3600000,
          },
        ],
        createdAt: now - 7200000,
      },
      {
        id: 'vid-chai',
        title: 'Morning Masala Chai in Old Copper — Street Kitchen',
        channel: 'Kitchen Stories',
        channelColor: '#D97706',
        category: 'Food',
        videoUrl: '/media/monsoon_chai.mp4',
        thumbnailUrl: '/samples/video_thumb_chai.jpg',
        duration: '0:25',
        views: 920,
        likes: 118,
        likedBy: [],
        comments: [],
        createdAt: now - 5400000,
      },
      {
        id: 'vid-session',
        title: 'Acoustic Studio Session: Late Night Strings',
        channel: 'Studio 12',
        channelColor: '#059669',
        category: 'Music',
        videoUrl: '/media/midnight_session.mp4',
        thumbnailUrl: '/samples/video_thumb_session.jpg',
        duration: '0:28',
        views: 1325,
        likes: 164,
        likedBy: [],
        comments: [],
        createdAt: now - 1800000,
      },
    ],
    photos: [
      {
        id: 'pho-ridge',
        author: 'Kabir Mehta',
        authorColor: '#0284C7',
        location: 'Garhwal Himalayas',
        caption: 'First light hitting the upper snow ridges above the valley fog.',
        imageUrl: '/samples/photo_post_ridge.jpg',
        likes: 86,
        likedBy: [],
        comments: [],
        createdAt: now - 4800000,
      },
      {
        id: 'pho-alley',
        author: 'Meera Nair',
        authorColor: '#E11D48',
        location: 'Old Quarter Market',
        caption: 'Rain-washed cobblestones and warm lantern light after the evening shower.',
        imageUrl: '/samples/photo_post_alley.jpg',
        likes: 64,
        likedBy: [],
        comments: [],
        createdAt: now - 2400000,
      },
    ],
    messages: [],
    rooms: [
      {
        id: 'cinema-lounge',
        name: 'Evening Movie Lounge',
        hostName: 'Aarav Cinema',
        videoId: 'vid-horizon',
        videoTitle: 'Across the Horizon Ridge — Twilight Short Film',
        videoUrl: '/media/horizon_ridge.mp4',
        thumbnailUrl: '/samples/video_thumb_cosmos.jpg',
        isPlaying: false,
        currentTime: 0,
        updatedAt: now,
        createdAt: now - 600000,
      },
    ],
  };
}

function loadStore(): StoreData {
  try {
    if (fs.existsSync(STORE_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(STORE_FILE, 'utf-8')) as Partial<StoreData>;
      const fallback = getInitialStore();
      return {
        videos: Array.isArray(parsed.videos) ? parsed.videos : fallback.videos,
        photos: Array.isArray(parsed.photos) ? parsed.photos : fallback.photos,
        messages: Array.isArray(parsed.messages) ? parsed.messages : fallback.messages,
        rooms: Array.isArray(parsed.rooms) && parsed.rooms.length > 0 ? parsed.rooms : fallback.rooms,
      };
    }
  } catch (err) {
    console.warn('Could not read store.json, starting fresh:', err);
  }
  const initial = getInitialStore();
  saveStore(initial);
  return initial;
}

function saveStore(data: StoreData) {
  try {
    fs.writeFileSync(STORE_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    console.warn('Failed to write store.json:', err);
  }
}

const store: StoreData = loadStore();

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use('/uploads', express.static(UPLOAD_DIR));

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').slice(0, 12) || '.bin';
    cb(null, `${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 150 * 1024 * 1024 },
});

const httpServer = http.createServer(app);
const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

interface ClientMeta extends OnlineUser {
  ws: WebSocket;
}

const clients = new Map<string, ClientMeta>();

function broadcast(payload: unknown, excludeClientId?: string) {
  const raw = JSON.stringify(payload);
  for (const [cid, client] of clients.entries()) {
    if (excludeClientId && cid === excludeClientId) continue;
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(raw);
    }
  }
}

function broadcastToRoom(roomId: string, payload: unknown, excludeClientId?: string) {
  const raw = JSON.stringify(payload);
  for (const [cid, client] of clients.entries()) {
    if (excludeClientId && cid === excludeClientId) continue;
    if (client.roomId === roomId && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(raw);
    }
  }
}

function getOnlineUsersList(): OnlineUser[] {
  return Array.from(clients.values()).map(({ ws: _ws, ...user }) => user);
}

function broadcastPresence() {
  broadcast({ type: 'presence:update', users: getOnlineUsersList() });
}

function getComputedRoomTime(room: WatchRoom): number {
  if (!room.isPlaying) return room.currentTime;
  return room.currentTime + (Date.now() - room.updatedAt) / 1000;
}

wss.on('connection', (ws) => {
  const clientId = crypto.randomUUID();
  const clientMeta: ClientMeta = {
    ws,
    clientId,
    userId: clientId,
    name: `Guest ${clientId.slice(0, 4).toUpperCase()}`,
    color: '#E11D48',
    roomId: null,
    voiceActive: false,
    isMuted: false,
  };
  clients.set(clientId, clientMeta);

  ws.send(JSON.stringify({ type: 'session:welcome', clientId, users: getOnlineUsersList() }));
  broadcastPresence();

  ws.on('message', (rawMsg) => {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(String(rawMsg));
    } catch {
      return;
    }

    const type = String(msg.type || '');

    if (type === 'auth:identify') {
      if (typeof msg.userId === 'string' && msg.userId.trim()) {
        clientMeta.userId = msg.userId.trim().slice(0, 64);
      }
      if (typeof msg.name === 'string' && msg.name.trim()) {
        clientMeta.name = msg.name.trim().slice(0, 32);
      }
      if (typeof msg.color === 'string' && msg.color.trim()) {
        clientMeta.color = msg.color.trim().slice(0, 20);
      }
      broadcastPresence();
      return;
    }

    if (type === 'chat:send') {
      const id = typeof msg.id === 'string' && msg.id ? msg.id : crypto.randomUUID();
      if (store.messages.some((m) => m.id === id)) return;
      const channelId = typeof msg.channelId === 'string' && msg.channelId ? msg.channelId : 'global';
      const text = typeof msg.text === 'string' ? msg.text.trim().slice(0, 2000) : '';
      const imageUrl = typeof msg.imageUrl === 'string' && msg.imageUrl ? msg.imageUrl : undefined;
      if (!text && !imageUrl) return;

      const chatMessage: ChatMessage = {
        id,
        channelId,
        senderId: clientMeta.userId,
        senderName: clientMeta.name,
        senderColor: clientMeta.color,
        text,
        imageUrl,
        createdAt: Date.now(),
      };
      store.messages.push(chatMessage);
      if (store.messages.length > 500) {
        store.messages = store.messages.slice(-500);
      }
      saveStore(store);

      if (channelId.startsWith('room:')) {
        const roomId = channelId.slice(5);
        broadcastToRoom(roomId, { type: 'chat:message', message: chatMessage });
      } else {
        broadcast({ type: 'chat:message', message: chatMessage });
      }
      return;
    }

    if (type === 'chat:typing') {
      const channelId = typeof msg.channelId === 'string' ? msg.channelId : 'global';
      const isTyping = Boolean(msg.isTyping);
      broadcast(
        {
          type: 'chat:typing',
          channelId,
          clientId,
          userName: clientMeta.name,
          isTyping,
        },
        clientId
      );
      return;
    }

    if (type === 'room:join') {
      const roomId = typeof msg.roomId === 'string' ? msg.roomId : '';
      const room = store.rooms.find((r) => r.id === roomId);
      if (!room) return;
      clientMeta.roomId = roomId;
      clientMeta.voiceActive = false;
      clientMeta.isMuted = false;

      ws.send(
        JSON.stringify({
          type: 'room:state',
          room: {
            ...room,
            currentTime: getComputedRoomTime(room),
          },
        })
      );
      broadcastPresence();
      return;
    }

    if (type === 'room:leave') {
      clientMeta.roomId = null;
      clientMeta.voiceActive = false;
      clientMeta.isMuted = false;
      broadcastPresence();
      return;
    }

    if (type === 'room:player-sync') {
      const roomId = typeof msg.roomId === 'string' ? msg.roomId : '';
      const room = store.rooms.find((r) => r.id === roomId);
      if (!room) return;

      const action = String(msg.action || '');
      const now = Date.now();
      const targetTime = typeof msg.currentTime === 'number' && Number.isFinite(msg.currentTime)
        ? Math.max(0, msg.currentTime)
        : getComputedRoomTime(room);

      if (action === 'play') {
        room.isPlaying = true;
        room.currentTime = targetTime;
        room.updatedAt = now;
      } else if (action === 'pause') {
        room.isPlaying = false;
        room.currentTime = targetTime;
        room.updatedAt = now;
      } else if (action === 'seek') {
        room.currentTime = targetTime;
        room.updatedAt = now;
      } else if (action === 'change-video') {
        if (typeof msg.videoId === 'string') room.videoId = msg.videoId;
        if (typeof msg.videoTitle === 'string') room.videoTitle = msg.videoTitle;
        if (typeof msg.videoUrl === 'string') room.videoUrl = msg.videoUrl;
        if (typeof msg.thumbnailUrl === 'string') room.thumbnailUrl = msg.thumbnailUrl;
        room.currentTime = 0;
        room.isPlaying = true;
        room.updatedAt = now;
      }

      saveStore(store);

      broadcastToRoom(
        roomId,
        {
          type: 'room:player-sync',
          roomId,
          action,
          isPlaying: room.isPlaying,
          currentTime: room.currentTime,
          updatedAt: room.updatedAt,
          videoId: room.videoId,
          videoTitle: room.videoTitle,
          videoUrl: room.videoUrl,
          thumbnailUrl: room.thumbnailUrl,
          actorName: clientMeta.name,
        },
        clientId
      );
      broadcast({ type: 'rooms:updated', rooms: store.rooms });
      return;
    }

    if (type === 'room:reaction') {
      const roomId = typeof msg.roomId === 'string' ? msg.roomId : '';
      const emoji = typeof msg.emoji === 'string' ? msg.emoji.slice(0, 8) : '';
      if (!roomId || !emoji) return;
      broadcastToRoom(roomId, {
        type: 'room:reaction',
        id: crypto.randomUUID(),
        roomId,
        emoji,
        senderName: clientMeta.name,
      });
      return;
    }

    if (type === 'rtc:voice-state') {
      clientMeta.voiceActive = Boolean(msg.voiceActive);
      clientMeta.isMuted = Boolean(msg.isMuted);
      broadcastPresence();
      return;
    }

    if (type === 'rtc:offer' || type === 'rtc:answer' || type === 'rtc:ice') {
      const targetClientId = typeof msg.targetClientId === 'string' ? msg.targetClientId : '';
      const target = clients.get(targetClientId);
      if (target && target.ws.readyState === WebSocket.OPEN) {
        target.ws.send(
          JSON.stringify({
            type,
            fromClientId: clientId,
            fromName: clientMeta.name,
            sdp: msg.sdp,
            candidate: msg.candidate,
          })
        );
      }
      return;
    }
  });

  ws.on('close', () => {
    clients.delete(clientId);
    broadcastPresence();
  });
});

// ---- REST API Routes ----

app.get('/api/bootstrap', (_req, res) => {
  res.json({
    videos: store.videos,
    photos: store.photos,
    messages: store.messages,
    rooms: store.rooms,
  });
});

app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: 'No file provided' });
    return;
  }
  res.json({
    url: `/uploads/${req.file.filename}`,
    mimeType: req.file.mimetype,
    filename: req.file.originalname,
  });
});

app.post('/api/videos', (req, res) => {
  const { title, channel, channelColor, category, videoUrl, thumbnailUrl, duration } = req.body || {};
  if (!title || !videoUrl) {
    res.status(400).json({ error: 'Title and videoUrl are required' });
    return;
  }
  const newVideo: VideoItem = {
    id: `vid-${crypto.randomBytes(4).toString('hex')}`,
    title: String(title).trim().slice(0, 120),
    channel: String(channel || 'Creator').trim().slice(0, 40),
    channelColor: String(channelColor || '#E11D48'),
    category: String(category || 'General').trim().slice(0, 24),
    videoUrl: String(videoUrl),
    thumbnailUrl: String(thumbnailUrl || '/samples/video_thumb_cosmos.jpg'),
    duration: String(duration || '0:30'),
    views: 1,
    likes: 0,
    likedBy: [],
    comments: [],
    createdAt: Date.now(),
  };
  store.videos.unshift(newVideo);
  saveStore(store);
  broadcast({ type: 'video:created', video: newVideo });
  res.json(newVideo);
});

app.post('/api/videos/:id/view', (req, res) => {
  const video = store.videos.find((v) => v.id === req.params.id);
  if (!video) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  video.views += 1;
  saveStore(store);
  broadcast({ type: 'video:updated', video });
  res.json(video);
});

app.post('/api/videos/:id/like', (req, res) => {
  const video = store.videos.find((v) => v.id === req.params.id);
  if (!video) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  const userId = String(req.body?.userId || 'anon');
  const idx = video.likedBy.indexOf(userId);
  if (idx >= 0) {
    video.likedBy.splice(idx, 1);
    video.likes = Math.max(0, video.likes - 1);
  } else {
    video.likedBy.push(userId);
    video.likes += 1;
  }
  saveStore(store);
  broadcast({ type: 'video:updated', video });
  res.json(video);
});

app.post('/api/videos/:id/comment', (req, res) => {
  const video = store.videos.find((v) => v.id === req.params.id);
  if (!video) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  const text = String(req.body?.text || '').trim().slice(0, 500);
  if (!text) {
    res.status(400).json({ error: 'Comment text required' });
    return;
  }
  video.comments.push({
    id: crypto.randomUUID(),
    author: String(req.body?.author || 'Guest').slice(0, 32),
    authorColor: String(req.body?.authorColor || '#E11D48'),
    text,
    createdAt: Date.now(),
  });
  saveStore(store);
  broadcast({ type: 'video:updated', video });
  res.json(video);
});

app.post('/api/photos', (req, res) => {
  const { author, authorColor, location, caption, imageUrl } = req.body || {};
  if (!imageUrl) {
    res.status(400).json({ error: 'imageUrl is required' });
    return;
  }
  const newPhoto: PhotoItem = {
    id: `pho-${crypto.randomBytes(4).toString('hex')}`,
    author: String(author || 'Guest').trim().slice(0, 40),
    authorColor: String(authorColor || '#0284C7'),
    location: String(location || 'Somewhere').trim().slice(0, 48),
    caption: String(caption || '').trim().slice(0, 400),
    imageUrl: String(imageUrl),
    likes: 0,
    likedBy: [],
    comments: [],
    createdAt: Date.now(),
  };
  store.photos.unshift(newPhoto);
  saveStore(store);
  broadcast({ type: 'photo:created', photo: newPhoto });
  res.json(newPhoto);
});

app.post('/api/photos/:id/like', (req, res) => {
  const photo = store.photos.find((p) => p.id === req.params.id);
  if (!photo) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  const userId = String(req.body?.userId || 'anon');
  const idx = photo.likedBy.indexOf(userId);
  if (idx >= 0) {
    photo.likedBy.splice(idx, 1);
    photo.likes = Math.max(0, photo.likes - 1);
  } else {
    photo.likedBy.push(userId);
    photo.likes += 1;
  }
  saveStore(store);
  broadcast({ type: 'photo:updated', photo });
  res.json(photo);
});

app.post('/api/photos/:id/comment', (req, res) => {
  const photo = store.photos.find((p) => p.id === req.params.id);
  if (!photo) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  const text = String(req.body?.text || '').trim().slice(0, 500);
  if (!text) {
    res.status(400).json({ error: 'Comment text required' });
    return;
  }
  photo.comments.push({
    id: crypto.randomUUID(),
    author: String(req.body?.author || 'Guest').slice(0, 32),
    authorColor: String(req.body?.authorColor || '#0284C7'),
    text,
    createdAt: Date.now(),
  });
  saveStore(store);
  broadcast({ type: 'photo:updated', photo });
  res.json(photo);
});

app.post('/api/rooms', (req, res) => {
  const { name, hostName, videoId, videoTitle, videoUrl, thumbnailUrl } = req.body || {};
  const fallbackVideo = store.videos[0];
  const selectedVideo = store.videos.find((v) => v.id === videoId) || fallbackVideo;

  const code = `room-${crypto.randomBytes(2).toString('hex')}`;
  const room: WatchRoom = {
    id: code,
    name: String(name || 'Movie Watch Party').trim().slice(0, 60),
    hostName: String(hostName || 'Host').trim().slice(0, 32),
    videoId: selectedVideo?.id || 'custom',
    videoTitle: String(videoTitle || selectedVideo?.title || 'Watch Together'),
    videoUrl: String(videoUrl || selectedVideo?.videoUrl || '/media/horizon_ridge.mp4'),
    thumbnailUrl: String(thumbnailUrl || selectedVideo?.thumbnailUrl || '/samples/video_thumb_cosmos.jpg'),
    isPlaying: false,
    currentTime: 0,
    updatedAt: Date.now(),
    createdAt: Date.now(),
  };

  store.rooms.unshift(room);
  if (store.rooms.length > 30) {
    store.rooms = store.rooms.slice(0, 30);
  }
  saveStore(store);
  broadcast({ type: 'rooms:updated', rooms: store.rooms });
  res.json(room);
});

async function start() {
  if (!IS_PROD) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve('dist');
    app.use(express.static(distDir));
    app.get('/{*splat}', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`VibeRoom running on http://0.0.0.0:${PORT}`);
  });
}

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
