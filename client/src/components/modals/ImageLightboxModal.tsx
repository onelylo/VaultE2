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
  const [translateY, setTranslateY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartY = useRef(0);

  useEffect(() => {
    if (!isOpen) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen) setTranslateY(0);
  }, [isOpen]);

  // Touch-only swipe down to close
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    dragStartY.current = e.touches[0].clientY;
    setIsDragging(true);
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!isDragging) return;
    const delta = e.touches[0].clientY - dragStartY.current;
    if (delta > 0) setTranslateY(delta);
  }, [isDragging]);

  const handleTouchEnd = useCallback(() => {
    setIsDragging(false);
    if (translateY > 100) onClose();
    else setTranslateY(0);
  }, [translateY, onClose]);

  if (!isOpen || !imageUrl) return null;

  const bgOpacity = Math.max(0, 1 - translateY / 350);
  const imgOpacity = Math.max(0, 1 - translateY / 200);

  return createPortal(
    <>
      {/* Backdrop — prevents app zoom, swiping, and scrolling */}
      <div
        className="fixed inset-0"
        style={{ zIndex: 999998, touchAction: 'none', backgroundColor: `rgba(0,0,0,${0.92 * bgOpacity})`, backdropFilter: `blur(${Math.max(0, 12 - translateY / 15)}px)`, transition: isDragging ? 'none' : 'background-color 0.3s, backdrop-filter 0.3s' }}
        onClick={onClose}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      />

      {/* Image — on top of backdrop, pannable via touch */}
      <img
        src={imageUrl}
        alt={fileName || 'Image'}
        className="fixed inset-0 m-auto pointer-events-none select-none"
        style={{
          zIndex: 999999,
          maxWidth: '80vw',
          maxHeight: '80vh',
          width: 'auto',
          height: 'auto',
          objectFit: 'contain',
          transform: `translateY(${translateY}px)`,
          transition: isDragging ? 'none' : 'transform 0.3s cubic-bezier(0.25, 1, 0.5, 1), opacity 0.3s',
          opacity: imgOpacity,
          touchAction: 'none',
        }}
      />

      {/* Tiny close hint at bottom */}
      <div
        className="fixed bottom-6 left-0 right-0 flex justify-center pointer-events-none"
        style={{ zIndex: 1000000, opacity: Math.max(0, 1 - translateY / 100), transition: isDragging ? 'none' : 'opacity 0.3s' }}
      >
        <div
          className="px-3 py-1.5 rounded-full cursor-pointer pointer-events-auto"
          style={{ backgroundColor: 'rgba(255,255,255,0.15)', backdropFilter: 'blur(8px)' }}
          onClick={onClose}
        >
          <span className="text-[11px] text-white/70 font-medium">Swipe down to close</span>
        </div>
      </div>
    </>,
    document.body
  );
};
