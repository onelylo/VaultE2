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
  const [translateY, setTranslateY] = useState(0);
  const [scale, setScale] = useState(1);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartY = useRef(0);
  const lastTouchDist = useRef(0);

  useEffect(() => {
    if (!isOpen) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen) { setTranslateY(0); setScale(1); }
  }, [isOpen]);

  // Zoom via trackpad pinch (ctrl+scroll) — only on the image
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: WheelEvent) => {
      if (e.ctrlKey) {
        e.preventDefault();
        e.stopPropagation();
        setScale(prev => Math.min(5, Math.max(0.5, prev - e.deltaY * 0.005)));
      }
    };
    document.addEventListener('wheel', handler, { passive: false });
    return () => document.removeEventListener('wheel', handler);
  }, [isOpen]);

  // Touch pinch-to-zoom on image
  const getTouchDist = (touches: React.TouchList) => {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  };

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      lastTouchDist.current = getTouchDist(e.touches);
      return;
    }
    if (scale > 1) return; // Don't swipe when zoomed
    dragStartY.current = e.touches[0].clientY;
    setIsDragging(true);
  }, [scale]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      e.preventDefault();
      const dist = getTouchDist(e.touches);
      const delta = dist / lastTouchDist.current;
      lastTouchDist.current = dist;
      setScale(prev => Math.min(5, Math.max(0.5, prev * delta)));
      return;
    }
    if (!isDragging || scale > 1) return;
    const delta = e.touches[0].clientY - dragStartY.current;
    if (delta > 0) setTranslateY(delta);
  }, [isDragging, scale]);

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
      {/* Backdrop */}
      <div
        className="fixed inset-0"
        style={{
          zIndex: 999998,
          touchAction: 'none',
          backgroundColor: `rgba(0,0,0,${0.92 * bgOpacity})`,
          backdropFilter: `blur(${Math.max(0, 12 - translateY / 15)}px)`,
          transition: isDragging ? 'none' : 'background-color 0.3s, backdrop-filter 0.3s',
        }}
        onClick={onClose}
        onTouchStart={(e) => { if (e.touches.length === 1 && scale <= 1) { dragStartY.current = e.touches[0].clientY; setIsDragging(true); } }}
        onTouchMove={(e) => { if (!isDragging || scale > 1 || e.touches.length > 1) return; const d = e.touches[0].clientY - dragStartY.current; if (d > 0) setTranslateY(d); }}
        onTouchEnd={() => { setIsDragging(false); if (translateY > 100) onClose(); else setTranslateY(0); }}
      />

      {/* Image — zoomable, draggable */}
      <img
        src={imageUrl}
        alt={fileName || 'Image'}
        className="fixed inset-0 m-auto select-none"
        style={{
          zIndex: 999999,
          maxWidth: '85vw',
          maxHeight: '85vh',
          width: 'auto',
          height: 'auto',
          objectFit: 'contain',
          transform: `translateY(${translateY}px) scale(${scale})`,
          transition: isDragging ? 'none' : 'transform 0.25s cubic-bezier(0.25, 1, 0.5, 1), opacity 0.3s',
          opacity: imgOpacity,
          touchAction: 'none',
          cursor: scale > 1 ? 'grab' : 'default',
        }}
        onTouchStart={(e) => {
          if (e.touches.length === 2) {
            lastTouchDist.current = getTouchDist(e.touches);
            return;
          }
          if (scale > 1) return;
          dragStartY.current = e.touches[0].clientY;
          setIsDragging(true);
        }}
        onTouchMove={(e) => {
          if (e.touches.length === 2) {
            e.preventDefault();
            const dist = getTouchDist(e.touches);
            const delta = dist / lastTouchDist.current;
            lastTouchDist.current = dist;
            setScale(prev => Math.min(5, Math.max(0.5, prev * delta)));
            return;
          }
          if (!isDragging || scale > 1) return;
          const d = e.touches[0].clientY - dragStartY.current;
          if (d > 0) setTranslateY(d);
        }}
        onTouchEnd={() => {
          setIsDragging(false);
          if (translateY > 100) onClose();
          else setTranslateY(0);
        }}
      />
    </>,
    document.body
  );
};
