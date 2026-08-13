import React, { useState, useRef, useCallback } from 'react';
import {
  Lock, Check, CheckCheck, Clock, Reply, Pencil, Trash2, Trash,
  Camera, Mic, Paperclip, Copy, ChevronRight,
} from 'lucide-react';
import type { LocalMessage, User, Channel } from '../../types/chat';
import { AttachmentMessage } from '../AttachmentMessage';

const DeliveryIcon: React.FC<{ status: LocalMessage['status'] }> = ({ status }) => {
  if (status === 'pending_sync') {
    return (
      <span title="Queued locally — will send when online">
        <Clock className="w-3 h-3 text-slate-500" />
      </span>
    );
  }
  if (status === 'read') {
    return (
      <span title="Seen by recipient">
        <CheckCheck className="w-3 h-3 text-sky-500 drop-shadow-[0_0_6px_rgba(56,189,248,0.6)]" />
      </span>
    );
  }
  if (status === 'delivered') {
    return (
      <span title="Delivered to recipient device">
        <CheckCheck className="w-3 h-3 text-slate-400" />
      </span>
    );
  }
  return (
    <span title="Sent to server relay">
      <Check className="w-3 h-3 text-slate-500" />
    </span>
  );
};

interface MessageItemProps {
  msg: LocalMessage;
  currentUserId: string;
  selectedUser: User | null;
  selectedChannel: Channel | null;
  messages: LocalMessage[];
  userLookup: Map<string, string>;
  chatType: 'dm' | 'channel';
  editingMsgId: string | null;
  editText: string;
  setEditText: (text: string) => void;
  setEditingMsgId: (id: string | null) => void;
  handleSaveEdit: (msgId: string) => void;
  handleStartReply: (msg: LocalMessage) => void;
  handleStartEdit: (msg: LocalMessage) => void;
  setPendingDeleteForMeId: (id: string | null) => void;
  setPendingDeleteEveryoneId: (id: string | null) => void;
  resolveKey: (msg: LocalMessage) => Promise<CryptoKey | null>;
  onImageClick: (url: string, name?: string) => void;
}

export const MessageItem: React.FC<MessageItemProps> = ({
  msg,
  currentUserId,
  selectedUser,
  selectedChannel,
  messages,
  userLookup,
  chatType,
  editingMsgId,
  editText,
  setEditText,
  setEditingMsgId,
  handleSaveEdit,
  handleStartReply,
  handleStartEdit,
  setPendingDeleteForMeId,
  setPendingDeleteEveryoneId,
  resolveKey,
  onImageClick,
}) => {
  const isSelf = msg.senderId === currentUserId;
  const hasAttachment = Boolean(msg.attachment || msg.attachmentMeta);
  const timeStr = new Date(Number(msg.timestamp ?? Date.now())).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  // Long-press support for mobile action menu
  const [showActions, setShowActions] = useState(false);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressNextClick = useRef(false);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    suppressNextClick.current = false;
    longPressTimer.current = setTimeout(() => {
      setShowActions(true);
      suppressNextClick.current = true;
    }, 500);
  }, []);

  const handleTouchEnd = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  const handleTouchMove = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  // Close action menu when clicking anywhere else
  React.useEffect(() => {
    if (!showActions) return;
    const handler = () => setShowActions(false);
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [showActions]);

  const senderName = isSelf
    ? 'YOU'
    : selectedUser
    ? selectedUser.fullName || selectedUser.username
    : userLookup.get(msg.senderId) || msg.senderId;

  const replyToMsg = msg.replyTo ? messages.find(m => m.id === msg.replyTo) : null;
  const replyToSenderName = replyToMsg
    ? replyToMsg.senderId === currentUserId
      ? 'You'
      : selectedUser
      ? selectedUser.fullName || selectedUser.username
      : userLookup.get(replyToMsg.senderId) || replyToMsg.senderId
    : null;

  return (
    <div
      id={`msg-${msg.id}`}
      className={`relative group flex items-center gap-2 w-full max-w-lg animate-messageIn ${isSelf ? 'ml-auto flex-row-reverse' : 'mr-auto flex-row'}`}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onTouchMove={handleTouchMove}
      onClick={() => {
        if (suppressNextClick.current) { suppressNextClick.current = false; return; }
        if (showActions) setShowActions(false);
      }}
    >
      {/* Message Bubble Container */}
      <div
        data-bubble
        className={`rounded-2xl border p-3.5 shadow-sm max-w-[85%] leading-relaxed ${
          msg.isDeleted
            ? 'bg-[var(--bg-surface)]/60 border-[var(--border-color)] text-[var(--text-muted)] italic'
            : isSelf
            ? 'bg-[var(--bg-surface)] border-[var(--border-color)] text-[var(--text-main)] rounded-tr-sm'
            : 'bg-[var(--bg-card)] border-[var(--bg-surface)] text-[var(--text-main)] rounded-tl-sm'
        } ${msg.status === 'pending_sync' ? 'opacity-70' : 'opacity-100'}`}
      >
        {msg.isDeleted ? (
          <p className="text-xs text-[var(--text-muted)] italic">This message was deleted</p>
        ) : editingMsgId === msg.id ? (
          <div className="space-y-2">
            <textarea
              value={editText}
              onChange={e => setEditText(e.target.value)}
              className="w-full bg-[var(--bg-input)] border border-[var(--border-color)] rounded-lg p-2 text-xs text-[var(--text-main)] focus:outline-none font-sans"
              rows={2}
            />
            <div className="flex justify-end space-x-2 font-mono text-xs">
              <button
                onClick={() => setEditingMsgId(null)}
                className="px-2 py-1 text-[var(--text-muted)] hover:text-[var(--text-main)]"
              >
                Cancel
              </button>
              <button
                onClick={() => handleSaveEdit(msg.id)}
                className="px-3 py-1 bg-[var(--accent-primary)] text-[var(--accent-text)] font-bold rounded-md"
              >
                Save
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* CHANNEL CHATS ONLY: Sender name inside top of bubble */}
            {chatType === 'channel' && !isSelf && (
              <span className="text-xs font-bold text-[var(--accent-primary)] block mb-1">
                {senderName}
              </span>
            )}

            {/* Quoted Reply Block */}
            {replyToMsg && replyToSenderName && (
              <div
                onClick={() => {
                  const el = document.getElementById(`msg-${replyToMsg.id}`);
                  if (el) {
                    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    const bubble = el.querySelector('[data-bubble]') as HTMLElement;
                    const target = bubble || el;
                    target.style.transition = 'box-shadow 0.4s ease';
                    target.style.boxShadow = '0 0 16px 3px var(--accent-primary)';
                    setTimeout(() => {
                      target.style.transition = 'box-shadow 0.8s ease';
                      target.style.boxShadow = 'none';
                    }, 1200);
                  }
                }}
                className="p-2.5 rounded-xl bg-[var(--bg-app)]/80 border-l-4 border-[var(--accent-primary)] flex items-center justify-between gap-3 text-xs cursor-pointer hover:bg-[var(--hover-color)] transition-colors mb-2 select-none group/reply"
              >
                <div className="flex flex-col min-w-0 flex-1">
                  <span className="font-semibold text-[var(--accent-primary)] block mb-0.5 truncate">
                    {replyToSenderName}
                  </span>
                  <div className="text-[var(--text-muted)] line-clamp-1 break-all flex items-center gap-1.5">
                    {replyToMsg.attachmentMeta?.mimeType?.startsWith('image/') && (
                      <span className="text-amber-400 font-medium flex items-center gap-1"><Camera className="w-3 h-3"/> Photo</span>
                    )}
                    {replyToMsg.attachmentMeta?.mimeType?.startsWith('audio/') && (
                      <span className="text-emerald-400 font-medium flex items-center gap-1"><Mic className="w-3 h-3"/> Voice Note</span>
                    )}
                    {replyToMsg.attachmentMeta?.mimeType && !replyToMsg.attachmentMeta.mimeType.startsWith('image/') && !replyToMsg.attachmentMeta.mimeType.startsWith('audio/') && (
                      <span className="text-blue-400 font-medium flex items-center gap-1"><Paperclip className="w-3 h-3"/> File</span>
                    )}
                    <span>{replyToMsg.text || replyToMsg.attachmentMeta?.fileName || 'Attachment'}</span>
                  </div>
                </div>
                {replyToMsg.attachmentMeta?.mimeType?.startsWith('image/') && replyToMsg.attachmentMeta?.thumbnailDataUrl && (
                  <div className="w-10 h-10 rounded-lg overflow-hidden shrink-0 border border-[var(--border-color)] bg-[var(--bg-surface)]">
                    <img
                      src={replyToMsg.attachmentMeta.thumbnailDataUrl}
                      alt="Reply thumbnail"
                      className="w-full h-full object-cover"
                    />
                  </div>
                )}
              </div>
            )}

            {/* Attachment */}
            {!msg.isDeleted && msg.attachment && (
              <div className={msg.text ? 'mb-2' : ''}>
                <AttachmentMessage
                  message={msg}
                  isMe={isSelf}
                  resolveKey={resolveKey}
                  onImageClick={(url, name) => onImageClick(url, name)}
                />
              </div>
            )}

            {/* Message Text */}
            {(msg.text || !msg.attachment) && (
              <p className="text-sm break-words whitespace-pre-wrap">
                {msg.isDecrypted ? msg.text : 'Unable to decrypt message'}
              </p>
            )}

            {/* Edited marker */}
            {msg.isEdited && !msg.isDeleted && (
              <span className="ml-2 text-[10px] font-mono text-[var(--text-muted)] italic">
                (edited)
              </span>
            )}

            {/* Timestamp + Lock + Delivery */}
            <div className="mt-1.5 flex items-center justify-end space-x-1.5">
              <span className="text-[10px] text-[var(--text-muted)] select-none">{timeStr}</span>
              <Lock className="w-2.5 h-2.5 text-emerald-500/60" />
              {isSelf && <DeliveryIcon status={msg.status} />}
            </div>
          </>
        )}
      </div>

      {/* CONTEXTUAL ACTION MENU */}
      <div
        className={`${showActions ? 'opacity-100 scale-100' : 'opacity-0 scale-95 pointer-events-none group-hover:opacity-100 group-hover:scale-100 group-hover:pointer-events-auto'} transition-all duration-150 z-20 shrink-0`}
      >
        <div
          className="bg-[var(--bg-surface)] border border-[var(--border-color)] rounded-xl shadow-xl min-w-[160px] overflow-hidden"
          style={{ boxShadow: '0 8px 24px rgba(0,0,0,0.15)' }}
        >
          {/* Reply */}
          {!msg.isDeleted && editingMsgId !== msg.id && (
            <button
              type="button"
              onClick={() => { handleStartReply(msg); setShowActions(false); }}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-xs hover:bg-[var(--hover-color)] transition-colors text-left"
              style={{ color: 'var(--text-main)' }}
            >
              <Reply className="w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} />
              <span>Reply</span>
            </button>
          )}

          {/* Copy Text */}
          {!msg.isDeleted && msg.text && (
            <button
              type="button"
              onClick={() => { navigator.clipboard.writeText(msg.text); setShowActions(false); }}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-xs hover:bg-[var(--hover-color)] transition-colors text-left"
              style={{ color: 'var(--text-main)' }}
            >
              <Copy className="w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} />
              <span>Copy</span>
            </button>
          )}

          {/* Edit — own messages only, within 5m, not audio */}
          {isSelf && !msg.isDeleted && editingMsgId !== msg.id && !(msg.attachmentMeta?.mimeType?.startsWith('audio/')) && (Date.now() - msg.timestamp <= 5 * 60 * 1000) && (
            <button
              type="button"
              onClick={() => { handleStartEdit(msg); setShowActions(false); }}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-xs hover:bg-[var(--hover-color)] transition-colors text-left"
              style={{ color: 'var(--text-main)' }}
            >
              <Pencil className="w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} />
              <span>Edit</span>
            </button>
          )}

          {/* Divider before destructive actions */}
          {(isSelf || !msg.isDeleted) && (
            <div className="mx-2 my-0.5" style={{ borderTop: '1px solid var(--border-color)' }} />
          )}

          {/* Delete For Me — always visible */}
          <button
            type="button"
            onClick={() => { setPendingDeleteForMeId(msg.id); setShowActions(false); }}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-xs hover:bg-amber-500/10 transition-colors text-left"
            style={{ color: '#f59e0b' }}
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Delete for me</span>
          </button>

          {/* Delete For Everyone — own messages only, not deleted */}
          {isSelf && !msg.isDeleted && (
            <button
              type="button"
              onClick={() => { setPendingDeleteEveryoneId(msg.id); setShowActions(false); }}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-xs hover:bg-red-500/10 transition-colors text-left"
              style={{ color: '#ef4444' }}
            >
              <Trash className="w-3.5 h-3.5" />
              <span>Delete for everyone</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
