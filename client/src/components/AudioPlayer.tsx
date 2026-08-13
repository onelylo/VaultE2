import React, { useState, useRef, useEffect } from 'react';
import { Play, Pause } from 'lucide-react';

interface AudioPlayerProps {
  src: string;
  fileName?: string;
}

export const AudioPlayer: React.FC<AudioPlayerProps> = ({ src, fileName }) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleEnded = () => { setIsPlaying(false); setProgress(0); };
    const handleTimeUpdate = () => {
      const current = audio.currentTime;
      const duration = audio.duration || 1;
      setProgress((current / duration) * 100);
    };

    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('timeupdate', handleTimeUpdate);

    return () => {
      audio.pause();
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('timeupdate', handleTimeUpdate);
    };
  }, [src]);

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play();
    }
    setIsPlaying(!isPlaying);
  };

  return (
    <div className="flex items-center gap-3 p-3 rounded-xl bg-[var(--bg-app)] border border-[var(--border-color)] w-64 select-none">
      <button
        type="button"
        onClick={togglePlay}
        className="w-9 h-9 rounded-full bg-[var(--accent-primary)] text-white flex items-center justify-center shrink-0 hover:opacity-90 transition-opacity"
      >
        {isPlaying ? <Pause className="w-4 h-4"/> : <Play className="w-4 h-4 ml-0.5"/>}
      </button>

      <div className="flex-1 flex flex-col gap-1">
        <span className="text-xs font-medium text-[var(--text-main)] truncate max-w-[140px]">
          {fileName || 'Voice Message'}
        </span>
        <div className="w-full h-1.5 bg-[var(--border-color)] rounded-full overflow-hidden">
          <div
            className="h-full bg-[var(--accent-primary)] transition-all duration-100"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      <audio
        ref={audioRef}
        src={src}
        className="hidden"
      />
    </div>
  );
};
