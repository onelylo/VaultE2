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
  const dragging = useRef(false);
  const startY = useRef(0);

  useEffect(() => {
    if (!isOpen) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen) setTranslateY(0);
  }, [isOpen]);

  if (!isOpen || !imageUrl) return null;

  const bgOpacity = Math.max(0, 1 - translateY / 350);

  return createPortal(
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{
        zIndex: 999999,
        backgroundColor: `rgba(0,0,0,${0.92 * bgOpacity})`,
        backdropFilter: `blur(${Math.max(0, 12 - translateY / 15)}px)`,
        touchAction: 'none',
      }}
      onClick={onClose}
      onTouchStart={(e) => {
        if (e.touches.length === 1) {
          dragging.current = true;
          startY.current = e.touches[0].clientY;
        }
      }}
      onTouchMove={(e) => {
        if (!dragging.current || e.touches.length !== 1) return;
        const dy = e.touches[0].clientY - startY.current;
        if (dy > 0) setTranslateY(dy);
      }}
      onTouchEnd={() => {
        dragging.current = false;
        if (translateY > 100) onClose();
        else setTranslateY(0);
      }}
    >
      <img
        src={imageUrl}
        alt=""
        className="max-w-[85vw] max-h-[85vh] object-contain select-none pointer-events-none"
        style={{
          transform: `translateY(${translateY}px)`,
          transition: dragging.current ? 'none' : 'transform 0.25s ease-out, opacity 0.3s',
          opacity: Math.max(0, 1 - translateY / 200),
        }}
      />
    </div>,
    document.body
  );
};
