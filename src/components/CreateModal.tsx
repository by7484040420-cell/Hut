import React, { useState } from 'react';
import { Camera, Film, X } from 'lucide-react';

interface CreateModalProps {
  initialMode: 'video' | 'photo';
  onClose: () => void;
  onCreateVideo: (payload: {
    file: File;
    thumbnailFile?: File;
    title: string;
    category: string;
  }) => Promise<void>;
  onCreatePhoto: (payload: {
    file: File;
    caption: string;
    location: string;
  }) => Promise<void>;
}

const VIDEO_CATEGORIES = ['Cinema', 'Music', 'Food', 'Travel', 'Vlog', 'Gaming'];

export const CreateModal: React.FC<CreateModalProps> = ({
  initialMode,
  onClose,
  onCreateVideo,
  onCreatePhoto,
}) => {
  const [mode, setMode] = useState<'video' | 'photo'>(initialMode);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Video state
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [thumbFile, setThumbFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('Cinema');

  // Photo state
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [caption, setCaption] = useState('');
  const [location, setLocation] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (mode === 'video') {
      if (!videoFile) {
        setError('Please select a video file (.mp4 or .webm).');
        return;
      }
      if (!title.trim()) {
        setError('Please enter a video title.');
        return;
      }
      setSubmitting(true);
      try {
        await onCreateVideo({
          file: videoFile,
          thumbnailFile: thumbFile || undefined,
          title: title.trim(),
          category,
        });
        onClose();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Upload failed');
      } finally {
        setSubmitting(false);
      }
    } else {
      if (!photoFile) {
        setError('Please choose a photo from your device.');
        return;
      }
      setSubmitting(true);
      try {
        await onCreatePhoto({
          file: photoFile,
          caption: caption.trim(),
          location: location.trim(),
        });
        onClose();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Upload failed');
      } finally {
        setSubmitting(false);
      }
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="w-full sm:max-w-lg bg-zinc-900 border border-zinc-800 rounded-t-3xl sm:rounded-2xl p-5 space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-zinc-100">Upload Media</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close upload modal"
            className="min-h-[40px] min-w-[40px] rounded-xl text-zinc-400 hover:text-white hover:bg-zinc-800 flex items-center justify-center"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-1 p-1 bg-zinc-950 border border-zinc-800 rounded-xl">
          <button
            type="button"
            onClick={() => setMode('video')}
            className={`min-h-[40px] rounded-lg text-sm font-medium inline-flex items-center justify-center gap-2 transition-colors ${
              mode === 'video' ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Film className="w-4 h-4" />
            Video / Movie
          </button>
          <button
            type="button"
            onClick={() => setMode('photo')}
            className={`min-h-[40px] rounded-lg text-sm font-medium inline-flex items-center justify-center gap-2 transition-colors ${
              mode === 'photo' ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Camera className="w-4 h-4" />
            Photo Post
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === 'video' ? (
            <>
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1.5">
                  Video File (MP4, WebM, MOV)
                </label>
                <input
                  type="file"
                  accept="video/*"
                  onChange={(e) => {
                    const f = e.target.files?.[0] || null;
                    setVideoFile(f);
                    if (f && !title) {
                      setTitle(f.name.replace(/\.[^/.]+$/, ''));
                    }
                  }}
                  className="block w-full text-xs text-zinc-300 file:mr-3 file:py-2.5 file:px-4 file:rounded-xl file:border-0 file:bg-zinc-800 file:text-zinc-100 file:font-medium hover:file:bg-zinc-700 cursor-pointer"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1.5">
                  Thumbnail Image (optional)
                </label>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => setThumbFile(e.target.files?.[0] || null)}
                  className="block w-full text-xs text-zinc-300 file:mr-3 file:py-2 file:px-4 file:rounded-xl file:border-0 file:bg-zinc-800 file:text-zinc-100 file:font-medium hover:file:bg-zinc-700 cursor-pointer"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1.5">
                  Title
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Give your video or movie a title"
                  className="w-full min-h-[44px] bg-zinc-950 border border-zinc-800 rounded-xl px-3.5 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-rose-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1.5">
                  Category
                </label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="w-full min-h-[44px] bg-zinc-950 border border-zinc-800 rounded-xl px-3.5 text-sm text-zinc-100 focus:outline-none focus:border-rose-500"
                >
                  {VIDEO_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
            </>
          ) : (
            <>
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1.5">
                  Photo File (JPG, PNG, WebP)
                </label>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => setPhotoFile(e.target.files?.[0] || null)}
                  className="block w-full text-xs text-zinc-300 file:mr-3 file:py-2.5 file:px-4 file:rounded-xl file:border-0 file:bg-zinc-800 file:text-zinc-100 file:font-medium hover:file:bg-zinc-700 cursor-pointer"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1.5">
                  Caption
                </label>
                <input
                  type="text"
                  value={caption}
                  onChange={(e) => setCaption(e.target.value)}
                  placeholder="Write something about this pic..."
                  className="w-full min-h-[44px] bg-zinc-950 border border-zinc-800 rounded-xl px-3.5 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-rose-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1.5">
                  Location (optional)
                </label>
                <input
                  type="text"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="City or spot"
                  className="w-full min-h-[44px] bg-zinc-950 border border-zinc-800 rounded-xl px-3.5 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-rose-500"
                />
              </div>
            </>
          )}

          {error && <p className="text-xs text-rose-400">{error}</p>}

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="min-h-[44px] px-4 rounded-xl text-sm font-medium text-zinc-400 hover:text-white"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="min-h-[44px] px-5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-semibold text-sm disabled:opacity-50 transition-colors"
            >
              {submitting ? 'Uploading...' : mode === 'video' ? 'Publish Video' : 'Publish Photo'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
