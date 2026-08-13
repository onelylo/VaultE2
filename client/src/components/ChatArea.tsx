import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db';
import {
  Lock, Shield, ShieldAlert, X, Paperclip, Send, Loader2, Smile, Reply,
  Search, Menu, ShieldCheck, Mic, ArrowDown, Info, FileText,
} from 'lucide-react';
import type { User, Channel, LocalMessage, UserKeyPair } from '../types/chat';
import { AttachmentMessage } from './AttachmentMessage';
import { EmojiPicker } from './EmojiPicker';
import { ImageLightboxModal } from './modals/ImageLightboxModal';
import { ConfirmModal } from './modals/ConfirmModal';
import { ProfileModal } from './ProfileModal';
import { MessageItem } from './chat/MessageItem';
import { MAX_ATTACHMENT_BYTES, formatFileSize, generateImageThumbnail } from '../lib/attachments';

const FIVE_MINUTES_MS = 5 * 60 * 1000;

interface ChatAreaProps {
  selectedUser: User | null;
  selectedChannel: Channel | null;
  currentUserId: string;
  currentUserKeys: UserKeyPair | null;
  allUsers: User[];
  peerFingerprint: string;
  mitmWarning?: boolean;
  isConnected?: boolean;
  typingUsers?: string[];
  fingerprint?: string;
  showFingerprintModal?: boolean;
  onCloseChat: () => void;
  onTrustNewKey?: (peer: User) => void;
  onEditMessage: (messageId: string, newText: string) => void;
  onDeleteForMe: (messageId: string) => void;
  onDeleteForEveryone: (messageId: string) => void;
  resolveMessageKey: (msg: LocalMessage) => Promise<CryptoKey | null>;
  onSendMessage: (text: string, replyTo?: string) => void;
  onSendFiles: (files: File[], text?: string) => void;
  uploadProgress: number | null;
  pinnedMessages: { messageId: string; pinnedBy: string; pinnedAt: number }[];
  onPin?: (messageId: string) => void;
  onUnpin?: (messageId: string) => void;
  onOpenChannelSettings?: (channel: Channel) => void;
  onOpenSearch?: () => void;
  onOpenFingerprintModal?: () => void;
  onCloseFingerprintModal?: () => void;
  onToggleSidebar?: () => void;
}

export const ChatArea: React.FC<ChatAreaProps> = ({
  selectedUser,
  selectedChannel,
  currentUserId,
  currentUserKeys,
  allUsers,
  peerFingerprint,
  mitmWarning,
  isConnected = true,
  typingUsers = [],
  fingerprint,
  showFingerprintModal,
  onCloseChat,
  onTrustNewKey,
  onEditMessage,
  onDeleteForMe,
  onDeleteForEveryone,
  resolveMessageKey,
  onSendMessage,
  onSendFiles,
  uploadProgress,
  pinnedMessages,
  onPin,
  onUnpin,
  onOpenChannelSettings,
  onOpenSearch,
  onOpenFingerprintModal,
  onCloseFingerprintModal,
  onToggleSidebar,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const onSendFilesRef = useRef(onSendFiles);
  onSendFilesRef.current = onSendFiles;

  const [editingMsgId, setEditingMsgId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');

  const [text, setText] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewDataUrl, setPreviewDataUrl] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isPreparing, setIsPreparing] = useState(false);

  const [activeReply, setActiveReply] = useState<{ msgId: string; senderName: string; text: string } | null>(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [activeLightbox, setActiveLightbox] = useState<{ url: string; name?: string } | null>(null);
  const [inspectedUser, setInspectedUser] = useState<User | null>(null);
  const [pendingDeleteForMeId, setPendingDeleteForMeId] = useState<string | null>(null);
  const [pendingDeleteEveryoneId, setPendingDeleteEveryoneId] = useState<string | null>(null);

  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const [showScrollDown, setShowScrollDown] = useState(false);
  const [micDenied, setMicDenied] = useState(false);

  // Cleanup voice recorder on unmount
  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.ondataavailable = null;
        mediaRecorderRef.current.onstop = null;
        mediaRecorderRef.current.stop();
        mediaRecorderRef.current.stream.getTracks().forEach(t => t.stop());
      }
      if (recordingIntervalRef.current) clearInterval(recordingIntervalRef.current);
    };
  }, []);

  const userLookup = useMemo(() => {
    const map = new Map<string, string>();
    for (const u of allUsers) {
      map.set(u.userId, u.fullName || u.username);
    }
    return map;
  }, [allUsers]);

  const messages = useLiveQuery(
    async () => {
      if (selectedChannel) {
        const msgs = await db.messages.where('channelId').equals(selectedChannel.id).toArray();
        return msgs.sort((a, b) => a.timestamp - b.timestamp);
      }
      if (selectedUser) {
        const all = await db.messages.toArray();
        return all
          .filter(
            m =>
              (!m.channelId && m.senderId === currentUserId && m.recipientId === selectedUser.userId) ||
              (!m.channelId && m.senderId === selectedUser.userId && m.recipientId === currentUserId)
          )
          .sort((a, b) => a.timestamp - b.timestamp);
      }
      return [];
    },
    [selectedUser?.userId, selectedChannel?.id, currentUserId],
    undefined
  );

  // Track whether user is near bottom for smart auto-scroll
  const isNearBottomRef = useRef(true);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    isNearBottomRef.current = distFromBottom < 200;
    setShowScrollDown(distFromBottom >= 200);
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.addEventListener('scroll', handleScroll, { passive: true });
      return () => scrollRef.current?.removeEventListener('scroll', handleScroll);
    }
  }, [handleScroll, selectedUser?.userId, selectedChannel?.id]);

  useEffect(() => {
    if (scrollRef.current) {
      if (isNearBottomRef.current) {
        scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
      } else {
        setShowScrollDown(true);
      }
    }
  }, [messages?.length]);

  // Textarea auto-resize
  const autoResize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 128) + 'px';
  }, []);

  useEffect(() => {
    autoResize();
  }, [text, autoResize]);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('[data-emoji-btn]') || target.closest('[data-emoji-picker]')) return;
      setShowEmojiPicker(false);
    };
    if (showEmojiPicker) {
      document.addEventListener('click', handleClick);
      return () => document.removeEventListener('click', handleClick);
    }
  }, [showEmojiPicker]);

  const doSend = () => {
    const disabled = !selectedUser && !selectedChannel;
    if (disabled) return;

    if (selectedFile) {
      onSendFiles([selectedFile], text.trim() || undefined);
      setSelectedFile(null);
      setPreviewDataUrl(null);
      setText('');
      setActiveReply(null);
      return;
    }

    if (text.trim()) {
      onSendMessage(text.trim(), activeReply?.msgId);
      setText('');
      setActiveReply(null);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    doSend();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape' && editingMsgId) {
      e.preventDefault();
      setEditingMsgId(null);
      setEditText('');
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      doSend();
    }
  };

  const handlePickFile = async (file: File) => {
    if (file.size > MAX_ATTACHMENT_BYTES) {
      alert(`File exceeds the 25 MB limit (${formatFileSize(file.size)}).`);
      return;
    }
    setIsPreparing(true);
    setSelectedFile(file);
    setPreviewDataUrl(null);
    try {
      if (file.type.startsWith('image/')) {
        const thumb = await generateImageThumbnail(file);
        setPreviewDataUrl(thumb);
      }
    } catch {
      console.error('[Attachment] Thumbnail generation failed');
    } finally {
      setIsPreparing(false);
    }
  };

  const handleFilesChosen = (files: FileList | null) => {
    const file = files?.[0];
    if (file) handlePickFile(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    handleFilesChosen(e.dataTransfer.files);
  };

  const handleEmojiSelect = (emoji: string) => {
    setText(prev => prev + emoji);
    setShowEmojiPicker(false);
    textareaRef.current?.focus();
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const file = new File([blob], `voice-message-${Date.now()}.webm`, { type: 'audio/webm' });
        onSendFilesRef.current([file]);
      };

      mediaRecorder.start();
      setIsRecording(true);
      setRecordingTime(0);
      recordingIntervalRef.current = setInterval(() => setRecordingTime(p => p + 1), 1000);
    } catch (err) {
      console.error('[Voice] Mic access denied:', err);
      setMicDenied(true);
      setTimeout(() => setMicDenied(false), 4000);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    if (recordingIntervalRef.current) {
      clearInterval(recordingIntervalRef.current);
      recordingIntervalRef.current = null;
    }
    setIsRecording(false);
    setRecordingTime(0);
  };

  const cancelRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.ondataavailable = null;
      mediaRecorderRef.current.onstop = null;
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach(t => t.stop());
    }
    if (recordingIntervalRef.current) {
      clearInterval(recordingIntervalRef.current);
      recordingIntervalRef.current = null;
    }
    audioChunksRef.current = [];
    setIsRecording(false);
    setRecordingTime(0);
  };

  const handleConfirmDeleteForMe = async () => {
    if (!pendingDeleteForMeId) return;
    const targetId = pendingDeleteForMeId;
    if (db?.messages) await db.messages.delete(targetId);
    setPendingDeleteForMeId(null);
  };

  const handleConfirmDeleteEveryone = () => {
    if (!pendingDeleteEveryoneId) return;
    onDeleteForEveryone?.(pendingDeleteEveryoneId);
    setPendingDeleteEveryoneId(null);
  };

  const handleStartReply = (msg: LocalMessage) => {
    const senderName = msg.senderId === currentUserId
      ? 'You'
      : selectedUser
      ? selectedUser.fullName || selectedUser.username
      : userLookup.get(msg.senderId) || msg.senderId;
    setActiveReply({ msgId: msg.id, senderName, text: msg.text });
    textareaRef.current?.focus();
  };

  const handleStartEdit = (msg: LocalMessage) => {
    setEditingMsgId(msg.id);
    setEditText(msg.text);
  };

  const handleSaveEdit = (msgId: string) => {
    if (editText.trim()) {
      onEditMessage(msgId, editText.trim());
    }
    setEditingMsgId(null);
  };

  const isAnnouncementChannel = selectedChannel?.isAnnouncement || false;
  const userRole = currentUserKeys?.role || 'MEMBER';
  const disabled = !selectedUser && !selectedChannel;
  const isReadOnly = isAnnouncementChannel && userRole === 'MEMBER';
  const canSend = !disabled && !isPreparing && !isReadOnly && (text.trim() || selectedFile);
  const placeholderText = disabled ? 'Select a conversation to start messaging...' : 'Type a message...';

  if (!selectedUser && !selectedChannel) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-[var(--bg-app)] text-[var(--text-muted)] p-8">
        <div className="w-16 h-16 rounded-2xl bg-[var(--bg-surface)] flex items-center justify-center mb-4 border border-[var(--border-color)]">
          <Shield className="w-8 h-8 text-[var(--text-muted)]" />
        </div>
        <p className="text-sm font-mono">Select a channel or team conversation to start end-to-end encrypted messaging.</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full bg-[var(--bg-app)]">
      {mitmWarning && (
        <div className="bg-rose-950/90 border-b border-rose-500/80 p-3 text-rose-200 font-mono text-xs flex items-center justify-between space-x-3 z-10">
          <div className="flex items-center space-x-3">
            <ShieldAlert className="w-5 h-5 text-rose-500 animate-bounce flex-shrink-0" />
            <div>
              <p className="font-bold text-rose-400">SECURITY ALERT: USER IDENTITY KEY HAS CHANGED</p>
              <p className="text-[11px] text-slate-300">
                The public key for {selectedUser?.username} does not match the pinned fingerprint.
              </p>
            </div>
          </div>
          {selectedUser && onTrustNewKey && (
            <button
              onClick={() => onTrustNewKey(selectedUser)}
              className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-slate-100 font-bold text-xs shadow transition-all shrink-0"
            >
              Trust & Pin New Key
            </button>
          )}
        </div>
      )}

      <header
        className="h-16 px-6 flex items-center justify-between border-b border-[var(--border-color)] bg-[var(--bg-surface)] shrink-0 z-10 select-none"
      >
        <div className="flex items-center space-x-3 min-w-0">
          {selectedChannel ? (
            <>
              <div
                onClick={() => onOpenChannelSettings?.(selectedChannel)}
                className="w-9 h-9 rounded-lg flex items-center justify-center font-bold text-sm cursor-pointer transition-smooth flex-shrink-0"
                style={{ backgroundColor: 'color-mix(in srgb, var(--accent-primary) 12%, transparent)', border: '1px solid color-mix(in srgb, var(--accent-primary) 30%, transparent)', color: 'var(--accent-primary)' }}
              >
                #
              </div>
              <div onClick={() => onOpenChannelSettings?.(selectedChannel)} className="cursor-pointer hover:opacity-80 transition-opacity rounded-lg px-2 py-1 min-w-0">
                <div className="flex items-center space-x-2">
                  <span className="font-bold text-sm" style={{ color: 'var(--text-main)' }}>#{selectedChannel.name}</span>
                  <span className="text-[9px] px-1.5 py-0.5 rounded font-bold flex-shrink-0" style={{ backgroundColor: 'var(--bg-input)', border: '1px solid var(--border-color)', color: 'var(--accent-primary)' }}>
                    {selectedChannel.type.toUpperCase()}
                  </span>
                  {selectedChannel.isAnnouncement && (
                    <span className="text-[8px] px-1.5 py-0.5 rounded font-bold flex items-center gap-1 flex-shrink-0" style={{ backgroundColor: 'rgba(245, 158, 11, 0.1)', border: '1px solid rgba(245, 158, 11, 0.3)', color: '#f59e0b' }}>
                      <Info className="w-2.5 h-2.5" />READ-ONLY
                    </span>
                  )}
                </div>
                <p className="text-[10px] truncate max-w-xs" style={{ color: 'var(--text-muted)' }}>{selectedChannel.description || 'Channel'}</p>
              </div>
            </>
          ) : selectedUser ? (
            <>
              <div className="relative flex-shrink-0" style={{ cursor: 'default' }}>
                <div className="w-9 h-9 rounded-lg flex items-center justify-center font-bold text-xs flex-shrink-0"
                  style={{ backgroundColor: 'color-mix(in srgb, var(--accent-primary) 12%, transparent)', border: '1px solid color-mix(in srgb, var(--accent-primary) 30%, transparent)', color: 'var(--accent-primary)' }}>
                  {selectedUser.username.substring(0, 2).toUpperCase()}
                </div>
                {selectedUser.avatarUrl && (
                  <img
                    src={selectedUser.avatarUrl}
                    alt={selectedUser.username}
                    className="w-9 h-9 rounded-lg absolute inset-0 object-cover cursor-zoom-in"
                    style={{ opacity: 0.9 }}
                    onMouseEnter={e => { e.currentTarget.style.opacity = '1'; }}
                    onMouseLeave={e => { e.currentTarget.style.opacity = '0.9'; }}
                    onError={(e) => { e.currentTarget.style.display = 'none'; }}
                  />
                )}
              </div>
              <div className="min-w-0 ml-3">
                <div className="flex items-center space-x-2">
                  <span className="font-semibold text-sm truncate" style={{ color: 'var(--text-main)' }}>
                    {selectedUser.fullName || selectedUser.username}
                  </span>
                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: selectedUser.isOnline ? '#34d399' : 'var(--text-muted)', boxShadow: selectedUser.isOnline ? '0 0 6px #34d399' : 'none' }} />
                </div>
                <span className="text-[10px] block" style={{ color: 'var(--text-muted)' }}>@{selectedUser.username}</span>
                {typingUsers.length > 0 && (
                  <div className="flex items-center gap-1.5 text-[10px] mt-0.5" style={{ color: 'var(--accent-primary)' }}>
                    <div className="flex space-x-1">
                      <span className="typing-dot" />
                      <span className="typing-dot" />
                      <span className="typing-dot" />
                    </div>
                    <span className="italic">{typingUsers[0]} is typing</span>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="flex items-center space-x-2 text-xs" style={{ color: 'var(--text-muted)' }}>
              <ShieldCheck className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />
              <span className="font-bold">VAULTCHAT WORKSPACE</span>
            </div>
          )}
        </div>

        <div className="flex items-center space-x-2">
          {onToggleSidebar && (
            <button onClick={onToggleSidebar} title="Open sidebar" className="md:hidden w-8 h-8 rounded-lg flex items-center justify-center transition-smooth"
              style={{ backgroundColor: 'var(--bg-input)', border: '1px solid var(--border-color)', color: 'var(--text-muted)' }}
              onMouseEnter={e => { e.currentTarget.style.color = 'var(--text-main)'; }} onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)'; }}>
              <Menu className="w-4 h-4" />
            </button>
          )}

          {(selectedUser || selectedChannel) && onOpenSearch && (
            <button onClick={onOpenSearch} title="Search messages (Ctrl+K)" className="w-8 h-8 rounded-lg flex items-center justify-center transition-smooth"
              style={{ backgroundColor: 'var(--bg-input)', border: '1px solid var(--border-color)', color: 'var(--text-muted)' }}
              onMouseEnter={e => { e.currentTarget.style.color = 'var(--text-main)'; }} onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)'; }}>
              <Search className="w-4 h-4" />
            </button>
          )}

          <div className="flex items-center space-x-1.5 text-[10px]" style={{ color: 'var(--text-muted)' }}>
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: isConnected ? '#34d399' : '#f59e0b', boxShadow: isConnected ? '0 0 6px #34d399' : 'none', animation: !isConnected ? 'pulse-soft 2s infinite' : 'none' }} />
            <span className="hidden sm:inline font-bold">{isConnected ? 'ONLINE' : 'RECONNECTING'}</span>
          </div>

          {(selectedUser || selectedChannel) && (
            <button onClick={onCloseChat} title="Close Conversation" className="w-8 h-8 rounded-lg flex items-center justify-center transition-smooth"
              style={{ backgroundColor: 'var(--bg-input)', border: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-6 space-y-4 font-sans relative">
        {messages === undefined ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="w-6 h-6 animate-spin text-[var(--text-muted)]" />
          </div>
        ) : messages.length === 0 ? (
          <div className="text-center my-12 text-[var(--text-muted)] font-mono text-xs space-y-2">
            <Lock className="w-8 h-8 text-[var(--text-muted)]/40 mx-auto" />
            <p className="text-[var(--text-muted)] font-bold">END-TO-END ENCRYPTED CHANNEL READY</p>
            <p className="text-[11px] text-[var(--text-muted)]/60">
              Messages are encrypted locally using AES-256-GCM before transport.
            </p>
          </div>
        ) : (
          messages.map(msg => (
            <MessageItem
              key={msg.id}
              msg={msg}
              currentUserId={currentUserId}
              selectedUser={selectedUser}
              selectedChannel={selectedChannel}
              messages={messages}
              userLookup={userLookup}
              chatType={selectedChannel ? 'channel' : 'dm'}
              editingMsgId={editingMsgId}
              editText={editText}
              setEditText={setEditText}
              setEditingMsgId={setEditingMsgId}
              handleSaveEdit={handleSaveEdit}
              handleStartReply={handleStartReply}
              handleStartEdit={handleStartEdit}
              setPendingDeleteForMeId={setPendingDeleteForMeId}
              setPendingDeleteEveryoneId={setPendingDeleteEveryoneId}
              resolveKey={resolveMessageKey}
              onImageClick={(url, name) => setActiveLightbox({ url, name })}
            />
          ))
        )}
        {showScrollDown && messages && messages.length > 0 && (
          <button
            onClick={() => {
              scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
              setShowScrollDown(false);
              isNearBottomRef.current = true;
            }}
            className="absolute bottom-4 right-4 w-9 h-9 rounded-full bg-[var(--bg-card)] border border-[var(--border-color)] shadow-lg flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-surface)] transition-all z-10"
            title="Scroll to latest messages"
          >
            <ArrowDown className="w-4 h-4" />
          </button>
        )}
      </div>

      <div className="mx-4 mb-4">
        {micDenied && (
          <div className="mb-2 px-3 py-2 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs flex items-center space-x-2 animate-slideDown">
            <ShieldAlert className="w-4 h-4 flex-shrink-0" />
            <span>Microphone access denied. Please allow microphone permission in your browser settings.</span>
          </div>
        )}
        {activeReply && (
          <div className="mb-2 flex items-center justify-between p-2.5 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-color)] text-xs">
            <div className="flex items-center space-x-2 truncate">
              <Reply className="w-3.5 h-3.5 text-[var(--accent-primary)] flex-shrink-0" />
              <span className="text-[var(--text-muted)]">Replying to <strong className="text-[var(--text-main)]">{activeReply.senderName}</strong>:</span>
              <span className="truncate text-[var(--text-muted)]">{activeReply.text}</span>
            </div>
            <button
              onClick={() => setActiveReply(null)}
              className="p-1 text-[var(--text-muted)] hover:text-[var(--text-main)] flex-shrink-0"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {selectedFile && (
          <div className="mb-2 flex items-center space-x-3 bg-[var(--bg-surface)] border border-[var(--border-color)] rounded-xl p-2.5 animate-[fadeIn_0.15s_ease-out]">
            {previewDataUrl ? (
              <img
                src={previewDataUrl}
                alt="thumbnail"
                className="w-14 h-14 object-cover rounded-lg border border-[var(--border-color)] bg-[var(--bg-card)]"
              />
            ) : (
              <div className="w-14 h-14 rounded-lg bg-[var(--bg-card)] border border-[var(--border-color)] flex items-center justify-center">
                <FileText className="w-6 h-6 text-[var(--accent-primary)]" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-[var(--text-main)] truncate">{selectedFile.name}</p>
              <p className="text-[10px] font-mono text-[var(--text-muted)] mt-0.5">
                {formatFileSize(selectedFile.size)} &middot; AES-256-GCM ENCRYPTED
              </p>
              {uploadProgress !== null && (
                <div className="mt-1 w-full bg-[var(--bg-card)] rounded-full h-1">
                  <div
                    className="bg-[var(--accent-primary)] h-1 rounded-full transition-all"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
              )}
            </div>
            {isPreparing ? (
              <Loader2 className="w-4 h-4 text-[var(--accent-primary)] animate-spin flex-shrink-0" />
            ) : (
              <button
                type="button"
                onClick={() => { setSelectedFile(null); setPreviewDataUrl(null); }}
                className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-rose-400 hover:bg-rose-500/10 transition-all flex-shrink-0"
                title="Remove file"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        )}

        <form
          onSubmit={handleSubmit}
          onDragOver={e => { e.preventDefault(); if (!disabled) setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          className={`rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-color)] shadow-lg p-2 flex items-center gap-2 transition-colors ${isDragging ? 'border-[var(--accent-primary)]/70' : ''}`}
        >
          <div className="relative" data-emoji-picker>
            <button
              type="button"
              data-emoji-btn
              onClick={() => setShowEmojiPicker(prev => !prev)}
              className="flex-shrink-0 h-10 w-10 flex items-center justify-center rounded-xl text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-card)] active:scale-95 transition-all"
              title="Emoji"
            >
              <Smile className="h-5 w-5" />
            </button>
            {showEmojiPicker && (
              <div className="absolute bottom-12 left-0 z-50">
                <EmojiPicker
                  onSelect={handleEmojiSelect}
                  isOpen={showEmojiPicker}
                />
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex-shrink-0 h-10 w-10 flex items-center justify-center rounded-xl text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-card)] active:scale-95 transition-all"
            title="Attach file"
          >
            <Paperclip className="h-5 w-5" />
          </button>

          {!isReadOnly && !isRecording && (
            <button
              type="button"
              onClick={startRecording}
              className="flex-shrink-0 h-10 w-10 flex items-center justify-center rounded-xl text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-card)] active:scale-95 transition-all"
              title="Record voice message"
            >
              <Mic className="h-5 w-5" />
            </button>
          )}

          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={e => { handleFilesChosen(e.target.files); e.target.value = ''; }}
          />

          <div className="flex-1 min-w-0">
            {isRecording ? (
              <div className="flex items-center gap-3 py-2.5 px-3">
                <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
                <span className="text-sm font-mono text-[var(--text-main)]">
                  {String(Math.floor(recordingTime / 60)).padStart(2, '0')}:{String(recordingTime % 60).padStart(2, '0')}
                </span>
                <button
                  type="button"
                  onClick={cancelRecording}
                  className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-rose-400 hover:bg-rose-500/10 transition-all"
                  title="Cancel recording"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ) : isReadOnly ? (
              <div className="py-2.5 px-3 text-sm text-[var(--text-muted)] italic bg-[var(--bg-card)] rounded-xl border border-[var(--border-color)] text-center">
                Only Admins and Supervisors can post in this announcement channel.
              </div>
            ) : (
              <textarea
                ref={textareaRef}
                value={text}
                onChange={e => { setText(e.target.value); autoResize(); }}
                onKeyDown={handleKeyDown}
                onInput={autoResize}
                placeholder={placeholderText}
                rows={1}
                className="w-full bg-transparent py-2.5 px-2 text-sm text-[var(--text-main)] placeholder-[var(--text-muted)] focus:outline-none resize-none min-h-[40px] max-h-32 leading-relaxed items-center"
              />
            )}
          </div>

          {!isReadOnly && (
            isRecording ? (
              <button
                type="button"
                onClick={stopRecording}
                className="flex-shrink-0 h-10 w-10 flex items-center justify-center rounded-xl bg-red-500 hover:bg-red-400 text-white font-bold active:scale-95 transition-all animate-pulse"
                title="Stop recording"
              >
                <Mic className="h-5 w-5" />
              </button>
            ) : (
              <button
                type="submit"
                disabled={!canSend}
                className="flex-shrink-0 h-10 w-10 flex items-center justify-center rounded-xl bg-[var(--accent-primary)] hover:opacity-90 text-[var(--accent-text)] font-bold active:scale-95 disabled:opacity-30 transition-all"
                title={canSend ? (selectedFile ? 'Send file' : 'Send message') : 'Type a message to send'}
              >
                <Send className="h-5 w-5" />
              </button>
            )
          )}
        </form>

        {isDragging && (
          <div className="mt-2 p-4 rounded-xl border-2 border-dashed border-[var(--accent-primary)]/60 bg-[var(--accent-primary)]/5 text-center font-mono text-xs text-[var(--accent-primary)] animate-[fadeIn_0.15s_ease-out]">
            DROP FILE TO ENCRYPT & ATTACH
          </div>
        )}
      </div>

<ImageLightboxModal
          imageUrl={activeLightbox?.url ?? ''}
          isOpen={!!activeLightbox}
          onClose={() => setActiveLightbox(null)}
          fileName={activeLightbox?.name ?? 'Media Preview'}
        />

      {inspectedUser && (
        <ProfileModal
          user={inspectedUser}
          currentUserId={currentUserId}
          onClose={() => setInspectedUser(null)}
        />
      )}

      <ConfirmModal
        isOpen={!!pendingDeleteForMeId}
        title="Delete message?"
        description="This message will be deleted for you. Other chat participants will still see it."
        confirmLabel="Delete for me"
        isDangerous={true}
        onConfirm={handleConfirmDeleteForMe}
        onClose={() => setPendingDeleteForMeId(null)}
      />

      <ConfirmModal
        isOpen={!!pendingDeleteEveryoneId}
        title="Delete message?"
        description="This message will be deleted for everyone in this chat. This action cannot be undone."
        confirmLabel="Delete for everyone"
        isDangerous={true}
        onConfirm={handleConfirmDeleteEveryone}
        onClose={() => setPendingDeleteEveryoneId(null)}
      />
    </div>
  );
};
