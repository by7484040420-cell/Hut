export interface UserProfile {
  id: string;
  name: string;
  color: string;
}

export interface OnlineUser {
  clientId: string;
  userId: string;
  name: string;
  color: string;
  roomId: string | null;
  voiceActive: boolean;
  isMuted: boolean;
}

export interface CommentItem {
  id: string;
  author: string;
  authorColor: string;
  text: string;
  createdAt: number;
}

export interface VideoItem {
  id: string;
  title: string;
  channel: string;
  channelColor: string;
  category: string;
  videoUrl: string;
  thumbnailUrl: string;
  duration: string;
  views: number;
  likes: number;
  likedBy: string[];
  comments: CommentItem[];
  createdAt: number;
}

export interface PhotoItem {
  id: string;
  author: string;
  authorColor: string;
  location: string;
  caption: string;
  imageUrl: string;
  likes: number;
  likedBy: string[];
  comments: CommentItem[];
  createdAt: number;
}

export interface ChatMessage {
  id: string;
  channelId: string;
  senderId: string;
  senderName: string;
  senderColor: string;
  text: string;
  imageUrl?: string;
  createdAt: number;
}

export interface WatchRoom {
  id: string;
  name: string;
  hostName: string;
  videoId: string;
  videoTitle: string;
  videoUrl: string;
  thumbnailUrl: string;
  isPlaying: boolean;
  currentTime: number;
  updatedAt: number;
  createdAt: number;
}

export type AppTab = 'videos' | 'photos' | 'chat' | 'party';
