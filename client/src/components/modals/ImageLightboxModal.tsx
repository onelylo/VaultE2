import React, { useEffect, useCallback, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, X, Loader2 } from 'lucide-react';
import { downloadEncryptedAttachment, decryptBinaryData } from '../../lib/attachments';
import { socket } from '../../lib/socket';
import { getMessageKey } from '../../lib/db';

interface ImageLightboxModalProps {
  messageIds: string[];
  currentIndex: number;
  isOpen: boolean;
  onClose: () => void;
  onNavigate?: (index: number) => void;
  currentUserKeys: any;
  privateKeyObject: any;
  allUsers: any[];
  selectedChannel: any;
  selectedPeer: any;
}

export const ImageLightboxModal: React.FC<ImageLightboxModalProps> = ({
  messageIds,
  currentIndex,
  isOpen,
  onClose,
  onNavigate,
  currentUserKeys,
  privateKeyObject,
  allUsers,
  selectedChannel,
  selectedPeer,
}) => {
  const [scale, setScale] = useState(1);
  const [offsetX, setOffsetX] = useState(0);
  const [offsetY, setOffsetY] = useState(0);
  const [swipeY, setSwipeY] = useState(0);
  const [images, setImages] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState<Set<string>>(new Set());
  const dragging = useRef(false);
  const lastPos = useRef({ x: 0, y: 0 });
  const lastPinchDist = useRef(0);

  const hasMultiple = messageIds.length > 1;
  const canGoLeft = hasMultiple && currentIndex > 0;
  const canGoRight = hasMultiple && currentIndex < messageIds.length - 1;

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

  const loadImage = useCallback(async (messageId: string) => {
    if (loading.has(messageId) || images.has(messageId)) return;
    
    setLoading(prev => new Set(prev).add(messageId));
    try {
      const token = localStorage.getItem('vaultchat_jwt') || sessionStorage.getItem('vaultchat_jwt');
      if (!token) throw new Error('No auth token');

      // Get message from server to get attachment info
      const res = await fetch(`http://localhost:3001/api/messages/${messageId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error('Failed to fetch message');
      const message = await res.json();

      if (!message?.attachment) return;

      // Get decryption key
      let key: CryptoKey | null = null;
      if (message.channelId) {
        // Channel message - get channel key
        const { getOrGenerateChannelKey } = await import('../lib/crypto');
        const { db } = await import('../lib/db');
        key = await getOrGenerateChannelKey(message.channelId, db);
      } else {
        // DM - derive shared key
        const peerId = message.senderId === currentUserKeys?.userId ? message.recipientId : message.senderId;
        const peer = allUsers.find(u => u.userId === peerId);
        if (peer?.publicKey) {
          const { getOrDeriveSharedKey } = await import('../lib/crypto');
          key = await getOrDeriveSharedKey(privateKeyObject, peer.publicKey);
        }
      }
      if (!key) return;

      // Download and decrypt
      const token = localStorage.getItem('vaultchat_jwt') || sessionStorage.getItem('vaultchat_jwt');
      const ciphertext = await (await import('../lib/attachments')).downloadEncryptedAttachment(token, message.attachment.attachmentId);
      const decrypted = await decryptBinaryData(ciphertext, message.attachment.binaryIv, key);
      const blob = new Blob([decrypted], { type: 'image/jpeg' }); // Assume JPEG, could use mimeType
      const url = URL.createObjectURL(blob);
      
      setImages(prev => new Map(prev).set(messageId, URL.createObjectURL(blob)));
    } catch (e) {
      console.error('[Lightbox] Failed to load image:', e);
    } finally {
      setLoading(prev => {
        const next = new Set(loading);
        next.delete(messageId);
        return next;
      });
    }
  }, [currentUserKeys, privateKeyObject, allUsers, selectedChannel, selectedPeer]);

  useEffect(() => {
    if (isOpen && messageIds.length > 0) {
      loadImage(messageIds[currentIndex]);
      if (messageIds[currentIndex + 1]) loadImage(messageIds[currentIndex + 1]);
      if (messageIds[currentIndex - 1]) loadImage(messageIds[currentIndex - 1]);
    }
  }, [messageIds, currentIndex, isOpen, loadImage]);

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

  if (!isOpen || !messageIds.length) return null;

  const currentMsgId = messageIds[currentIndex];
  const imageUrl = images.get(currentMsgId);
  const isLoading = loading.has(currentMsgId);

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
            setOffsetX(prev => prev + dx);
            setOffsetY(prev => prev + dy);
          } else {
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
      <div className="fixed inset-0 flex items-center justify-center z-[999999] pointer-events-none">
        {isLoading ? (
          <div className="flex items-center justify-center">
            <Loader2 className="w-8 h-8 animate-spin text-white" />
          </div>
        ) : imageUrl ? (
          <img
            src={imageUrl}
            alt=""
            className="select-none pointer-events-none"
            style={{
              zIndex: 999999,
              maxWidth: '95vw',
              maxHeight: '95vh',
              width: 'auto',
              height: 'auto',
              objectFit: 'contain',
              transform: `translate(${offsetX}px, ${offsetY + swipeY}px) scale(${scale})`,
              transition: dragging.current ? 'none' : 'transform 0.25s ease-out, opacity 0.3s',
              opacity: imgOpacity,
              imageRendering: 'auto',
            }}
            key={currentMsgId}
          />
        ) : (
          <div className="text-red-400 text-center">Failed to load image</div>
        )}
      </div>

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
            {messageIds.map((msgId, idx) => (
              <button
                key={msgId}
                onClick={(e) => { e.stopPropagation(); onNavigate?.(idx); }}
                className={`w-12 h-12 rounded-lg overflow-hidden flex-shrink-0 border-2 transition-all ${
                  idx === currentIndex 
                    ? 'border-white scale-110 shadow-lg' 
                    : 'border-transparent opacity-60 hover:opacity-100'
                }`}
              >
                <img src={images.get(msgId) || ''} alt="" className="w-full h-full object-cover" />
              </button>
            ))}
          </div>
          {/* Counter */}
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[1000000] px-3 py-1.5 rounded-full bg-black/50 text-white text-xs font-medium">
            {currentIndex + 1} / {messageIds.length}
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

const hasMultiple = messageIds.length > 1;
const canGoLeft = hasMultiple && currentIndex > 0;
const canGoRight = hasMultiple && currentIndex < messageIds.length - 1;
const bgOpacity = Math.max(0, 1 - swipeY / 350);
const imgOpacity = Math.max(0, 1 - swipeY / 200);
const currentMsgId = messageIds[currentIndex];
const imageUrl = images.get(currentMsgId);
const isLoading = loading.has(currentMsgId);
const dragging = useRef(false);
const lastPos = useRef({ x: 0, y: 0 });
const lastPinchDist = useRef(0);
const swipeY = useRef(0);

export const ImageLightboxModal: React.FC<any> = ({
  messageIds,
  currentIndex,
  isOpen,
  onClose,
  onNavigate,
  currentUserKeys,
  privateKeyObject,
  allUsers,
  selectedChannel,
  selectedPeer,
}) => {
  const [scale, setScale] = useState(1);
  const [offsetX, setOffsetX] = useState(0);
  const [offsetY, setOffsetY] = useState(0);
  const [swipeY, setSwipeY] = useState(0);
  const [images, setImages] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState<Set<string>>(new Set());
  const dragging = useRef(false);
  const lastPos = useRef({ x: 0, y: 0 });
  const lastPinchDist = useRef(0);
  const swipeY = useRef(0);

  // ... (rest of the implementation)
  
  if (!isOpen || !messageIds.length) return null;

  // ... rest of component
};

export default ImageLightboxModal;