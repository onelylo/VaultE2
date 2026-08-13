import React, { useEffect, useCallback, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Download } from 'lucide-react';

interface ImageLightboxModalProps {
  imageUrl: string | null;
  isOpen: boolean;
  onClose: () => void;
  fileName?: string;
}

export const ImageLightboxModal: React.FC<ImageLightboxModalProps> = ({
  imageUrl,
  isOpen,
  onClose,
  fileName,
}) => {
  const [zoomed, setZoomed] = useState(false);
  const [translateY, setTranslateY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartY = useRef(0);
  const imgRef = useRef<HTMLImageElement>(null);

  // Keyboard handling
  useEffect(() => {
    if (!isOpen) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (zoomed) setZoomed(false);
        else onClose();
      }
    };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [isOpen, zoomed, onClose]);

  // Reset state when closing
  useEffect(() => {
    if (!isOpen) {
      setZoomed(false);
      setTranslateY(0);
    }
  }, [isOpen]);

  // Swipe down to close
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (zoomed) return;
    dragStartY.current = e.touches[0].clientY;
    setIsDragging(true);
  }, [zoomed]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!isDragging || zoomed) return;
    const delta = e.touches[0].clientY - dragStartY.current;
    if (delta > 0) {
      setTranslateY(delta);
    }
  }, [isDragging, zoomed]);

  const handleTouchEnd = useCallback(() => {
    setIsDragging(false);
    if (translateY > 150) {
      onClose();
    } else {
      setTranslateY(0);
    }
  }, [translateY, onClose]);

  // Mouse drag down to close
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (zoomed) return;
    if ((e.target as HTMLElement).closest('button')) return;
    dragStartY.current = e.clientY;
    setIsDragging(true);
  }, [zoomed]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging || zoomed) return;
    const delta = e.clientY - dragStartY.current;
    if (delta > 0) {
      setTranslateY(delta);
    }
  }, [isDragging, zoomed]);

  const handleMouseUp = useCallback(() => {
    if (!isDragging) return;
    setIsDragging(false);
    if (translateY > 150) {
      onClose();
    } else {
      setTranslateY(0);
    }
  }, [isDragging, translateY, onClose]);

  if (!isOpen || !imageUrl) return null;

  const handleDownload = () => {
    const a = document.createElement('a');
    a.href = imageUrl;
    a.download = fileName || 'image';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const bgOpacity = Math.max(0, 1 - translateY / 400);

  return createPortal(
    <div
      id="image-lightbox-portal"
      role="dialog"
      aria-modal="true"
      aria-label={fileName || 'Image preview'}
      className="fixed inset-0 w-screen h-screen flex items-center justify-center m-0 p-0 select-none"
      style={{
        zIndex: 999999,
        backgroundColor: `rgba(0,0,0,${0.9 * bgOpacity})`,
        backdropFilter: `blur(${Math.max(0, 8 - translateY / 20)}px)`,
        transition: isDragging ? 'none' : 'background-color 0.3s, backdrop-filter 0.3s',
        cursor: isDragging ? 'grabbing' : 'default',
      }}
      onClick={onClose}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={() => { setIsDragging(false); setTranslateY(0); }}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* Top Header — hides when zoomed */}
      <div
        className={`absolute top-0 left-0 right-0 h-16 px-6 flex items-center justify-between text-white z-[1000000] transition-opacity duration-200 ${zoomed ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}
        style={{ background: 'linear-gradient(to bottom, rgba(0,0,0,0.8), transparent)' }}
      >
        <span className="text-sm font-medium text-slate-200 truncate">{fileName || 'Media Preview'}</span>
        <div className="flex items-center gap-2">
          <button
            onClick={(e) => { e.stopPropagation(); handleDownload(); }}
            className="p-2 hover:bg-white/10 rounded-full text-sm cursor-pointer transition-colors"
            title="Download"
          >
            <Download className="w-4 h-4" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onClose(); }}
            className="p-2 hover:bg-white/10 rounded-full text-xl font-bold cursor-pointer transition-colors"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Image */}
      <img
        ref={imgRef}
        src={imageUrl}
        alt={fileName || 'Enlarged media'}
        className="max-w-[75vw] max-h-[75vh] w-auto h-auto object-contain rounded-2xl shadow-2xl select-none"
        style={{
          transform: `scale(${zoomed ? 2.5 : 1.05}) translateY(${translateY}px)`,
          transition: isDragging ? 'none' : 'transform 0.3s cubic-bezier(0.25, 1, 0.5, 1)',
          opacity: bgOpacity,
          cursor: zoomed ? 'zoom-out' : 'zoom-in',
        }}
        onClick={(e) => { e.stopPropagation(); setZoomed(!zoomed); }}
      />
    </div>,
    document.body
  );
};
