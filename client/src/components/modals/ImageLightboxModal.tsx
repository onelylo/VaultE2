import React, { useEffect, useCallback, useState, useRef } from 'react';
import { createPortal } from 'react-dom';

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
}) => {
  const [scale, setScale] = useState(1);
  const [offsetX, setOffsetX] = useState(0);
  const [offsetY, setOffsetY] = useState(0);
  const [swipeY, setSwipeY] = useState(0);
  const dragging = useRef(false);
  const lastPos = useRef({ x: 0, y: 0 });
  const lastPinchDist = useRef(0);

  useEffect(() => {
    if (!isOpen) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [isOpen, onClose]);

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
          maxWidth: '85vw',
          maxHeight: '85vh',
          width: 'auto',
          height: 'auto',
          objectFit: 'contain',
          transform: `translate(${offsetX}px, ${offsetY + swipeY}px) scale(${scale})`,
          transition: dragging.current ? 'none' : 'transform 0.25s ease-out, opacity 0.3s',
          opacity: imgOpacity,
        }}
      />
    </>,
    document.body
  );
};
