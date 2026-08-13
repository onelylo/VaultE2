import React from 'react';
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
  fileName,
}) => {
  if (!isOpen || !imageUrl) return null;

  return createPortal(
    <div
      id="image-lightbox-portal"
      className="fixed inset-0 w-screen h-screen flex items-center justify-center bg-black/90 backdrop-blur-md m-0 p-0"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        width: '100vw',
        height: '100vh',
        zIndex: 999999, // Max explicit z-index to outrank fixed sidebar
        margin: 0,
        padding: 0
      }}
      onClick={onClose}
    >
      {/* Top Header */}
      <div
        className="absolute top-0 left-0 right-0 h-16 px-6 flex items-center justify-between text-white z-[1000000] bg-gradient-to-b from-black/80 to-transparent"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="text-sm font-medium text-slate-200 truncate">{fileName || 'Media Preview'}</span>
        <button
          onClick={onClose}
          className="p-2 hover:bg-white/10 rounded-full text-xl font-bold cursor-pointer transition-colors"
        >
          ✕
        </button>
      </div>

      {/* Centered Image */}
      <div
        className="relative w-full h-full flex items-center justify-center p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <img
          src={imageUrl}
          alt={fileName || 'Enlarged media'}
          className="max-w-[95vw] max-h-[90vh] w-auto h-auto object-contain rounded-lg shadow-2xl border border-white/10 select-none"
        />
      </div>
    </div>,
    document.body
  );
};