import React, { useRef, useState } from 'react';
import { Camera, Heart, MapPin, MessageSquare, Send } from 'lucide-react';
import type { PhotoItem, UserProfile } from '../types';
import { MediaImage } from './MediaImage';
import { formatCount, formatTimeAgo } from '../lib/format';

interface PhotoSectionProps {
  photos: PhotoItem[];
  profile: UserProfile;
  onLikePhoto: (photoId: string) => void;
  onCommentPhoto: (photoId: string, text: string) => Promise<void>;
  onCreatePhoto: (payload: {
    file: File;
    caption: string;
    location: string;
  }) => Promise<void>;
}

export const PhotoSection: React.FC<PhotoSectionProps> = ({
  photos,
  profile,
  onLikePhoto,
  onCommentPhoto,
  onCreatePhoto,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string>('');
  const [caption, setCaption] = useState('');
  const [location, setLocation] = useState('');
  const [uploading, setUploading] = useState(false);

  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
  const [expandedComments, setExpandedComments] = useState<Record<string, boolean>>({});

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSelectedFile(file);
    const reader = new FileReader();
    reader.onload = () => setPreviewUrl(String(reader.result || ''));
    reader.readAsDataURL(file);
  };

  const handlePublish = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile || uploading) return;
    setUploading(true);
    try {
      await onCreatePhoto({
        file: selectedFile,
        caption: caption.trim(),
        location: location.trim(),
      });
      setSelectedFile(null);
      setPreviewUrl('');
      setCaption('');
      setLocation('');
      if (fileInputRef.current) fileInputRef.current.value = '';
    } finally {
      setUploading(false);
    }
  };

  const handleSubmitComment = async (photoId: string, e: React.FormEvent) => {
    e.preventDefault();
    const text = (commentDrafts[photoId] || '').trim();
    if (!text) return;
    setCommentDrafts((prev) => ({ ...prev, [photoId]: '' }));
    await onCommentPhoto(photoId, text);
  };

  return (
    <div className="space-y-6">
      {/* Quick Pic Upload Composer */}
      <section className="bg-zinc-900/70 border border-zinc-800 rounded-2xl p-4 sm:p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-zinc-100">Share a Photo</h2>
            <p className="text-xs text-zinc-400 mt-0.5">
              Upload from camera or gallery — instantly visible to everyone in the feed.
            </p>
          </div>
          <label className="inline-flex items-center justify-center gap-2 min-h-[44px] px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-sm font-semibold cursor-pointer transition-colors whitespace-nowrap shrink-0">
            <Camera className="w-4 h-4" />
            <span>{selectedFile ? 'Change Pic' : 'Choose Pic'}</span>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleFileChange}
              className="hidden"
            />
          </label>
        </div>

        {selectedFile && previewUrl && (
          <form onSubmit={handlePublish} className="mt-4 pt-4 border-t border-zinc-800 grid grid-cols-1 md:grid-cols-12 gap-4 items-start">
            <div className="md:col-span-5 aspect-[4/3] rounded-xl overflow-hidden bg-zinc-950 border border-zinc-800">
              <img
                src={previewUrl}
                alt="Selected photo preview"
                className="w-full h-full object-cover"
              />
            </div>
            <div className="md:col-span-7 space-y-3">
              <input
                type="text"
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                placeholder="Write a caption for your photo..."
                className="w-full min-h-[44px] bg-zinc-950 border border-zinc-800 rounded-xl px-3.5 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-rose-500"
              />
              <div className="relative">
                <MapPin className="w-4 h-4 text-zinc-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="Location (optional)"
                  className="w-full min-h-[44px] bg-zinc-950 border border-zinc-800 rounded-xl pl-10 pr-3.5 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-rose-500"
                />
              </div>
              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedFile(null);
                    setPreviewUrl('');
                  }}
                  className="min-h-[44px] px-4 rounded-xl text-sm font-medium text-zinc-400 hover:text-zinc-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={uploading}
                  className="min-h-[44px] px-5 rounded-xl bg-zinc-100 text-zinc-950 font-semibold text-sm hover:bg-white disabled:opacity-50 transition-colors"
                >
                  {uploading ? 'Uploading...' : 'Post Photo'}
                </button>
              </div>
            </div>
          </form>
        )}
      </section>

      {/* Instagram-style Photo Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {photos.map((photo) => {
          const isLiked = photo.likedBy.includes(profile.id);
          const showComments = Boolean(expandedComments[photo.id]);

          return (
            <article
              key={photo.id}
              className="bg-zinc-900/50 border border-zinc-800/80 rounded-2xl overflow-hidden flex flex-col"
            >
              {/* Post Header */}
              <div className="px-4 py-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-semibold text-white shrink-0"
                    style={{ backgroundColor: photo.authorColor }}
                  >
                    {photo.author.slice(0, 1).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-zinc-100 truncate">
                      {photo.author}
                    </div>
                    <div className="text-xs text-zinc-400 truncate">
                      {photo.location ? `${photo.location} · ` : ''}
                      {formatTimeAgo(photo.createdAt)}
                    </div>
                  </div>
                </div>
              </div>

              {/* Photo Frame (double-tap to like) */}
              <div
                onDoubleClick={() => onLikePhoto(photo.id)}
                className="relative aspect-[4/3] w-full bg-zinc-950 cursor-pointer select-none overflow-hidden"
                title="Double-tap to like"
              >
                <MediaImage
                  src={photo.imageUrl}
                  alt={photo.caption || `Photo by ${photo.author}`}
                  className="w-full h-full object-cover"
                />
              </div>

              {/* Actions & Caption */}
              <div className="p-4 space-y-3">
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => onLikePhoto(photo.id)}
                    className={`inline-flex items-center gap-1.5 min-h-[44px] px-3 rounded-xl text-sm font-medium transition-colors ${
                      isLiked
                        ? 'text-rose-400 bg-rose-500/10'
                        : 'text-zinc-300 hover:bg-zinc-800/80'
                    }`}
                  >
                    <Heart className={`w-5 h-5 ${isLiked ? 'fill-rose-500 text-rose-500' : ''}`} />
                    <span className="font-mono">{formatCount(photo.likes)}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      setExpandedComments((prev) => ({
                        ...prev,
                        [photo.id]: !prev[photo.id],
                      }))
                    }
                    className="inline-flex items-center gap-1.5 min-h-[44px] px-3 rounded-xl text-sm font-medium text-zinc-300 hover:bg-zinc-800/80 transition-colors"
                  >
                    <MessageSquare className="w-5 h-5" />
                    <span className="font-mono">{photo.comments.length}</span>
                  </button>
                </div>

                {photo.caption && (
                  <p className="text-sm text-zinc-200 leading-relaxed">
                    <span className="font-semibold text-zinc-100 mr-2">{photo.author}</span>
                    {photo.caption}
                  </p>
                )}

                {showComments && (
                  <div className="pt-2 border-t border-zinc-800/80 space-y-3">
                    {photo.comments.map((c) => (
                      <div key={c.id} className="text-sm">
                        <span className="font-semibold text-zinc-200 mr-2">{c.author}</span>
                        <span className="text-zinc-300">{c.text}</span>
                        <span className="text-xs text-zinc-500 ml-2">{formatTimeAgo(c.createdAt)}</span>
                      </div>
                    ))}
                  </div>
                )}

                <form onSubmit={(e) => handleSubmitComment(photo.id, e)} className="flex gap-2 pt-1">
                  <input
                    type="text"
                    value={commentDrafts[photo.id] || ''}
                    onChange={(e) =>
                      setCommentDrafts((prev) => ({
                        ...prev,
                        [photo.id]: e.target.value,
                      }))
                    }
                    placeholder="Add a comment..."
                    className="flex-1 min-h-[40px] bg-zinc-950 border border-zinc-800 rounded-xl px-3 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-rose-500"
                  />
                  <button
                    type="submit"
                    disabled={!(commentDrafts[photo.id] || '').trim()}
                    aria-label="Send comment"
                    className="min-h-[40px] min-w-[40px] px-3 rounded-xl bg-zinc-800 text-zinc-100 hover:bg-zinc-700 disabled:opacity-40 inline-flex items-center justify-center transition-colors"
                  >
                    <Send className="w-4 h-4" />
                  </button>
                </form>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
};
