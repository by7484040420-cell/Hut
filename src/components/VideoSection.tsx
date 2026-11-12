import React, { useMemo, useState } from 'react';
import {
  Heart,
  MessageSquare,
  Play,
  Search,
  Send,
  Tv,
  Upload,
  ArrowLeft,
} from 'lucide-react';
import type { UserProfile, VideoItem } from '../types';
import { MediaImage } from './MediaImage';
import { formatCount, formatTimeAgo } from '../lib/format';

interface VideoSectionProps {
  videos: VideoItem[];
  profile: UserProfile;
  onLikeVideo: (videoId: string) => void;
  onViewVideo: (videoId: string) => void;
  onCommentVideo: (videoId: string, text: string) => Promise<void>;
  onStartWatchParty: (video: VideoItem) => void;
  onOpenUploadVideo: () => void;
}

export const VideoSection: React.FC<VideoSectionProps> = ({
  videos,
  profile,
  onLikeVideo,
  onViewVideo,
  onCommentVideo,
  onStartWatchParty,
  onOpenUploadVideo,
}) => {
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeVideoId, setActiveVideoId] = useState<string | null>(null);
  const [commentText, setCommentText] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const categories = useMemo(() => {
    const cats = Array.from(new Set(videos.map((v) => v.category).filter(Boolean)));
    return ['All', ...cats];
  }, [videos]);

  const filteredVideos = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return videos.filter((v) => {
      const catOk = selectedCategory === 'All' || v.category === selectedCategory;
      const searchOk =
        !q ||
        v.title.toLowerCase().includes(q) ||
        v.channel.toLowerCase().includes(q) ||
        v.category.toLowerCase().includes(q);
      return catOk && searchOk;
    });
  }, [videos, selectedCategory, searchQuery]);

  const activeVideo = useMemo(
    () => videos.find((v) => v.id === activeVideoId) || null,
    [videos, activeVideoId]
  );

  const handleSelectVideo = (video: VideoItem) => {
    setActiveVideoId(video.id);
    onViewVideo(video.id);
  };

  const handleSubmitComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeVideo || !commentText.trim() || submitting) return;
    setSubmitting(true);
    try {
      await onCommentVideo(activeVideo.id, commentText.trim());
      setCommentText('');
    } finally {
      setSubmitting(false);
    }
  };

  if (activeVideo) {
    const isLiked = activeVideo.likedBy.includes(profile.id);
    const upNext = videos.filter((v) => v.id !== activeVideo.id);

    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-4">
          <button
            type="button"
            onClick={() => setActiveVideoId(null)}
            className="inline-flex items-center gap-2 min-h-[44px] px-3 py-2 rounded-xl text-sm font-medium text-zinc-300 hover:text-white hover:bg-zinc-900 transition-colors whitespace-nowrap shrink-0"
          >
            <ArrowLeft className="w-4 h-4" />
            All Videos
          </button>

          <button
            type="button"
            onClick={() => onStartWatchParty(activeVideo)}
            className="inline-flex items-center gap-2 min-h-[44px] px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-sm font-semibold transition-colors whitespace-nowrap shrink-0"
          >
            <Tv className="w-4 h-4" />
            Watch With Friends
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <div className="lg:col-span-8 space-y-4">
            <div className="relative aspect-video w-full rounded-2xl overflow-hidden bg-black border border-zinc-800">
              <video
                key={activeVideo.id}
                src={activeVideo.videoUrl}
                poster={activeVideo.thumbnailUrl}
                controls
                autoPlay
                playsInline
                className="w-full h-full object-contain bg-black"
              />
            </div>

            <div className="space-y-3">
              <h1 className="text-xl sm:text-2xl font-semibold text-zinc-50 leading-snug">
                {activeVideo.title}
              </h1>

              <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-zinc-800/80">
                <div className="flex items-center gap-3">
                  <div
                    className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold text-white shrink-0"
                    style={{ backgroundColor: activeVideo.channelColor }}
                  >
                    {activeVideo.channel.slice(0, 1).toUpperCase()}
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-zinc-100">
                      {activeVideo.channel}
                    </div>
                    <div className="text-xs text-zinc-400 font-mono">
                      {formatCount(activeVideo.views)} views · {formatTimeAgo(activeVideo.createdAt)} · {activeVideo.category}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onLikeVideo(activeVideo.id)}
                    className={`inline-flex items-center gap-2 min-h-[44px] px-4 py-2 rounded-xl border text-sm font-medium transition-colors whitespace-nowrap shrink-0 ${
                      isLiked
                        ? 'bg-rose-600/15 border-rose-500/60 text-rose-400'
                        : 'bg-zinc-900 border-zinc-800 text-zinc-200 hover:bg-zinc-800'
                    }`}
                  >
                    <Heart className={`w-4 h-4 ${isLiked ? 'fill-rose-500 text-rose-500' : ''}`} />
                    <span className="font-mono">{formatCount(activeVideo.likes)}</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Comments */}
            <div className="bg-zinc-900/60 border border-zinc-800/80 rounded-2xl p-4 sm:p-5 space-y-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
                <MessageSquare className="w-4 h-4 text-zinc-400" />
                <span>Comments</span>
                <span className="text-xs text-zinc-400 font-mono">
                  ({activeVideo.comments.length})
                </span>
              </div>

              <form onSubmit={handleSubmitComment} className="flex gap-2">
                <input
                  type="text"
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  placeholder="Write a comment..."
                  className="flex-1 min-h-[44px] bg-zinc-950 border border-zinc-800 rounded-xl px-3.5 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-rose-500"
                />
                <button
                  type="submit"
                  disabled={!commentText.trim() || submitting}
                  className="min-h-[44px] px-4 rounded-xl bg-zinc-100 text-zinc-950 font-semibold text-sm hover:bg-white disabled:opacity-40 transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
                >
                  <Send className="w-4 h-4" />
                  Post
                </button>
              </form>

              <div className="space-y-3 pt-1">
                {activeVideo.comments.length === 0 ? (
                  <p className="text-xs text-zinc-500 py-2">
                    No comments yet. Start the conversation.
                  </p>
                ) : (
                  activeVideo.comments.map((c) => (
                    <div key={c.id} className="flex items-start gap-3">
                      <div
                        className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold text-white shrink-0 mt-0.5"
                        style={{ backgroundColor: c.authorColor }}
                      >
                        {c.author.slice(0, 1).toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-xs text-zinc-400">
                          <span className="font-semibold text-zinc-200">{c.author}</span>
                          <span className="mx-1.5">·</span>
                          <span>{formatTimeAgo(c.createdAt)}</span>
                        </div>
                        <p className="text-sm text-zinc-200 mt-0.5 break-words">{c.text}</p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* Up Next Queue */}
          <div className="lg:col-span-4 space-y-3">
            <h2 className="text-sm font-semibold text-zinc-300">Up Next</h2>
            <div className="space-y-3">
              {upNext.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => handleSelectVideo(v)}
                  className="w-full text-left flex gap-3 p-2 rounded-xl hover:bg-zinc-900/90 border border-transparent hover:border-zinc-800 transition-colors group"
                >
                  <div className="relative w-36 aspect-video rounded-lg overflow-hidden bg-zinc-900 shrink-0">
                    <MediaImage
                      src={v.thumbnailUrl}
                      alt={v.title}
                      className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform"
                    />
                    <span className="absolute bottom-1 right-1 bg-black/80 text-white text-[10px] font-mono px-1.5 py-0.5 rounded">
                      {v.duration}
                    </span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-zinc-100 line-clamp-2 leading-snug">
                      {v.title}
                    </div>
                    <div className="text-xs text-zinc-400 mt-1 truncate">
                      {v.channel}
                    </div>
                    <div className="text-xs text-zinc-500 font-mono mt-0.5">
                      {formatCount(v.views)} views · {formatTimeAgo(v.createdAt)}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Search + Upload Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-xl">
          <Search className="w-4 h-4 text-zinc-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search videos, channels, movies..."
            className="w-full min-h-[44px] bg-zinc-900/90 border border-zinc-800 rounded-xl pl-10 pr-4 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-rose-500"
          />
        </div>

        <button
          type="button"
          onClick={onOpenUploadVideo}
          className="inline-flex items-center justify-center gap-2 min-h-[44px] px-4 py-2 rounded-xl bg-zinc-900 border border-zinc-800 hover:border-zinc-700 hover:bg-zinc-800 text-sm font-medium text-zinc-100 transition-colors whitespace-nowrap shrink-0"
        >
          <Upload className="w-4 h-4 text-rose-500" />
          Upload Video
        </button>
      </div>

      {/* Category Filter Buttons */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        {categories.map((cat) => {
          const active = cat === selectedCategory;
          return (
            <button
              key={cat}
              type="button"
              onClick={() => setSelectedCategory(cat)}
              className={`min-h-[40px] px-4 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                active
                  ? 'bg-zinc-100 text-zinc-950'
                  : 'bg-zinc-900 text-zinc-400 hover:text-zinc-100 border border-zinc-800/80'
              }`}
            >
              {cat}
            </button>
          );
        })}
      </div>

      {/* Video Grid */}
      {filteredVideos.length === 0 ? (
        <div className="py-16 text-center bg-zinc-900/40 border border-zinc-800/60 rounded-2xl">
          <p className="text-sm text-zinc-400">No videos match that search.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {filteredVideos.map((video) => (
            <article
              key={video.id}
              className="group bg-zinc-900/50 border border-zinc-800/80 rounded-2xl overflow-hidden flex flex-col hover:border-zinc-700 transition-colors"
            >
              <button
                type="button"
                onClick={() => handleSelectVideo(video)}
                className="relative aspect-video w-full bg-zinc-950 overflow-hidden text-left"
              >
                <MediaImage
                  src={video.thumbnailUrl}
                  alt={video.title}
                  className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-200"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-transparent to-transparent" />
                <div className="absolute bottom-2.5 left-3 right-3 flex items-center justify-between">
                  <span className="inline-flex items-center gap-1.5 text-xs font-medium text-white">
                    <Play className="w-3.5 h-3.5 fill-white" />
                    Play
                  </span>
                  <span className="bg-black/80 text-zinc-100 text-[11px] font-mono px-1.5 py-0.5 rounded">
                    {video.duration}
                  </span>
                </div>
              </button>

              <div className="p-4 flex-1 flex flex-col justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div
                    className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-semibold text-white shrink-0 mt-0.5"
                    style={{ backgroundColor: video.channelColor }}
                  >
                    {video.channel.slice(0, 1).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <button
                      type="button"
                      onClick={() => handleSelectVideo(video)}
                      className="text-left text-sm font-semibold text-zinc-100 hover:text-rose-400 transition-colors line-clamp-2 leading-snug"
                    >
                      {video.title}
                    </button>
                    <div className="text-xs text-zinc-400 mt-1">
                      {video.channel} · {video.category}
                    </div>
                    <div className="text-xs text-zinc-500 font-mono mt-0.5">
                      {formatCount(video.views)} views · {formatCount(video.likes)} likes · {formatTimeAgo(video.createdAt)}
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-zinc-800/70">
                  <button
                    type="button"
                    onClick={() => handleSelectVideo(video)}
                    className="text-xs font-medium text-zinc-300 hover:text-white min-h-[36px] px-2"
                  >
                    Open Player
                  </button>
                  <button
                    type="button"
                    onClick={() => onStartWatchParty(video)}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-rose-400 hover:text-rose-300 min-h-[36px] px-2 whitespace-nowrap"
                  >
                    <Tv className="w-3.5 h-3.5" />
                    Group Watch
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
};
