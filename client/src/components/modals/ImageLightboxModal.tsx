import React, { useEffect, useCallback, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';

interface ImageLightboxModalProps {
  imageUrl: string | null;
  isOpen: boolean;
  onClose: () => void;
  fileName?: string;
  allImages?: string[];
  currentIndex?: number;
  onNavigate?: (index: number) => void;
}

export const ImageLightboxModal: React.FC<ImageLightboxModalProps> = ({
  imageUrl,
  isOpen,
  onClose,
  fileName,
  allImages = [],
  currentIndex = 0,
  onNavigate,
}) => {
  const [scale, setScale] = useState(1);
  const [offsetX, setOffsetX] = useState(0);
  const [offsetY, setOffsetY] = useState(0);
  const [swipeY, setSwipeY] = useState(0);
  const dragging = useRef(false);
  const lastPos = useRef({ x: 0, y: 0 });
  const lastPinchDist = useRef(0);

  const hasMultiple = allImages.length > 1;
  const canGoLeft = hasMultiple && currentIndex > 0;
  const canGoRight = hasMultiple && currentIndex < allImages.length - 1;

  const goLeft = useCallback(() => {
    if (canGoLeft && onNavigate) {
      onNavigate(currentIndex - 1);
      setScale(1); setOffsetX(0); setOffsetY(0);
    }
  }, [canGoLeft, currentIndex, onNavigate]);

  const goRight = useCallback(() => {
    if (canGoRight && onNavigate) {
      onNavigate(currentIndex + 1);
      setScale(1); setOffsetX(0); setOffsetY(0);
    }
  }, [canGoRight, currentIndex, onNavigate]);

  useEffect(() => {
    if (!isOpen) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft') goLeft();
      if (e.key === 'ArrowRight') goRight();
    };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [isOpen, onClose, goLeft, goRight]);

  useEffect(() => {
    if (!isOpen) { setScale(1); setOffsetX(0); setOffsetY(0); setSwipeY(0); }
  }, [isOpen]);

  // Desktop: Ctrl+scroll to zoom image only
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: WheelEvent) => {
      if (e.ctrlKey) {
        e.preventDefault();
        e.stopPropagation();
        setScale(prev => Math.min(5, Math.max(1, prev - e.deltaY * 0.005)));
      }
    };
    document.addEventListener('wheel', handler, { passive: false });
    return () => document.removeEventListener('wheel', handler);
  }, [isOpen]);

  if (!isOpen || !imageUrl) return null;

  const bgOpacity = Math.max(0, 1 - swipeY / 350);
  const imgOpacity = Math.max(0, 1 - swipeY / 200);

  return createPortal(
    <>
      {/* Backdrop — blocks app zoom via data-lightbox-open attr */}
      <div
        data-lightbox-open
        className="fixed inset-0"
        style={{
          zIndex: 999998,
          touchAction: 'none',
          backgroundColor: `rgba(0,0,0,${0.92 * bgOpacity})`,
          backdropFilter: `blur(${Math.max(0, 12 - swipeY / 15)}px)`,
          transition: dragging.current ? 'none' : 'background-color 0.3s, backdrop-filter 0.3s',
        }}
        onClick={onClose}
        onTouchStart={(e) => {
          if (e.touches.length === 2) {
            lastPinchDist.current = Math.hypot(
              e.touches[0].clientX - e.touches[1].clientX,
              e.touches[0].clientY - e.touches[1].clientY
            );
            return;
          }
          dragging.current = true;
          lastPos.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        }}
        onTouchMove={(e) => {
          if (e.touches.length === 2) {
            e.preventDefault();
            const dist = Math.hypot(
              e.touches[0].clientX - e.touches[1].clientX,
              e.touches[0].clientY - e.touches[1].clientY
            );
            const delta = dist / lastPinchDist.current;
            lastPinchDist.current = dist;
            setScale(prev => Math.min(5, Math.max(1, prev * delta)));
            return;
          }
          if (!dragging.current) return;
          const dx = e.touches[0].clientX - lastPos.current.x;
          const dy = e.touches[0].clientY - lastPos.current.y;
          lastPos.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
          if (scale > 1) {
            // Pan the image
            setOffsetX(prev => prev + dx);
            setOffsetY(prev => prev + dy);
          } else {
            // Swipe down to close (only when not zoomed)
            if (dy > 0) setSwipeY(dy);
          }
        }}
        onTouchEnd={() => {
          dragging.current = false;
          if (scale <= 1 && swipeY > 100) {
            onClose();
          } else {
            setSwipeY(0);
          }
        }}
      />

      {/* Image — zoomable + pannable */}
      <img
        src={imageUrl}
        alt=""
        className="fixed inset-0 m-auto select-none pointer-events-none"
        style={{
          zIndex: 999999,
          maxWidth: '90vw',
          maxHeight: '90vh',
          width: 'auto',
          height: 'auto',
          objectFit: 'contain',
          transform: `translate(${offsetX}px, ${offsetY + swipeY}px) scale(${scale})`,
          transition: dragging.current ? 'none' : 'transform 0.25s ease-out, opacity 0.3s',
          opacity: imgOpacity,
          imageRendering: 'auto',
        }}
        // Force browser to load fresh image on navigation
        key={imageUrl}
      />

      {/* Navigation arrows */}
      {hasMultiple && (
        <>
          {canGoLeft && (
            <button
              onClick={(e) => { e.stopPropagation(); goLeft(); }}
              className="fixed left-4 top-1/2 -translate-y-1/2 z-[1000000] w-10 h-10 rounded-full bg-black/50 hover:bg-black/70 text-white flex items-center justify-center transition-colors"
            >
              <ChevronLeft className="w-6 h-6" />
            </button>
          )}
          {canGoRight && (
            <button
              onClick={(e) => { e.stopPropagation(); goRight(); }}
              className="fixed right-4 top-1/2 -translate-y-1/2 z-[1000000] w-10 h-10 rounded-full bg-black/50 hover:bg-black/70 text-white flex items-center justify-center transition-colors"
            >
              <ChevronRight className="w-6 h-6" />
            </button>
          )}
          {/* Thumbnail strip */}
          <div className="fixed bottom-16 left-1/2 -translate-x-1/2 z-[1000000] flex gap-1.5 px-3 py-2 rounded-xl bg-black/40 backdrop-blur-sm max-w-[90vw] overflow-x-auto">
            {allImages.map((img, idx) => (
              <button
                key={idx}
                onClick={(e) => { e.stopPropagation(); onNavigate?.(idx); }}
                className={`w-12 h-12 rounded-lg overflow-hidden flex-shrink-0 border-2 transition-all ${
                  idx === currentIndex 
                    ? 'border-white scale-110 shadow-lg' 
                    : 'border-transparent opacity-60 hover:opacity-100'
                }`}
              >
                <img src={img} alt="" className="w-full h-full object-cover" />
              </button>
            ))}
          </div>
          {/* Counter */}
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[1000000] px-3 py-1.5 rounded-full bg-black/50 text-white text-xs font-medium">
            {currentIndex + 1} / {allImages.length}
          </div>
        </>
      )}

      {/* Close button */}
      <button
        onClick={onClose}
        className="fixed top-4 right-4 z-[1000000] w-10 h-10 rounded-full bg-black/50 hover:bg-black/70 text-white flex items-center justify-center transition-colors"
      >
        <X className="w-5 h-5" />
      </button>
    </>,
    document.body
  );
};
