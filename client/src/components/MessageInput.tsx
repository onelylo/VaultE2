import React, { useRef, useState } from 'react';
import { Send, Paperclip, X, FileText, Loader2 } from 'lucide-react';
import { MAX_ATTACHMENT_BYTES, formatFileSize, generateImageThumbnail } from '../lib/attachments';

interface PendingFile {
  file: File;
  previewUrl?: string;
}

interface MessageInputProps {
  onSendMessage: (text: string) => void;
  onSendFiles: (files: File[], text?: string) => void;
  disabled: boolean;
  isAnnouncementChannel?: boolean;
  userRole?: string;
}

export const MessageInput: React.FC<MessageInputProps> = ({ onSendMessage, onSendFiles, disabled, isAnnouncementChannel = false, userRole = 'MEMBER' }) => {
  const [text, setText] = useState('');
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isPreparing, setIsPreparing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (disabled || isPreparing) return;
    if (pendingFiles.length > 0) {
      onSendFiles(pendingFiles.map(pf => pf.file), text.trim() || undefined);
      setPendingFiles([]);
      setText('');
      return;
    }
    if (text.trim()) {
      onSendMessage(text.trim());
      setText('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e as any);
    }
  };

  const addFiles = async (fileList: FileList | File[]) => {
    const files = Array.from(fileList);
    setIsPreparing(true);
    const newPending: PendingFile[] = [];
    for (const file of files) {
      if (file.size > MAX_ATTACHMENT_BYTES) {
        alert(`File "${file.name}" exceeds the 25 MB limit (${formatFileSize(file.size)}).`);
        continue;
      }
      const pf: PendingFile = { file };
      if (file.type.startsWith('image/')) {
        try { pf.previewUrl = await generateImageThumbnail(file); } catch { /* skip */ }
      }
      newPending.push(pf);
    }
    if (newPending.length > 0) {
      setPendingFiles(prev => [...prev, ...newPending]);
    }
    setIsPreparing(false);
    textareaRef.current?.focus();
  };

  const removeFile = (index: number) => {
    setPendingFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    addFiles(e.dataTransfer.files);
  };

  const canSend = !disabled && !isPreparing && (text.trim() || pendingFiles.length > 0);
  const placeholderText = disabled ? 'Select a conversation to start messaging…' : pendingFiles.length > 0 ? 'Add a message (optional)…' : 'Type a message…';

  return (
    <div
      onDragOver={e => { e.preventDefault(); if (!disabled) setIsDragging(true); }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
      className="p-3 rounded-2xl transition-smooth"
      style={{
        backgroundColor: 'var(--bg-surface)',
        border: isDragging ? '2px dashed var(--accent-primary)' : '1px solid var(--border-color)',
      }}
    >
      {pendingFiles.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-2">
          {pendingFiles.map((pf, i) => (
            <div key={`${pf.file.name}-${i}`} className="flex items-center space-x-2 rounded-xl p-2 animate-fadeInUp" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
              {pf.previewUrl ? (
                <img src={pf.previewUrl} alt="thumbnail" className="w-10 h-10 object-cover rounded-lg" style={{ border: '1px solid var(--border-color)' }} />
              ) : (
                <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ backgroundColor: 'var(--bg-input)', border: '1px solid var(--border-color)' }}>
                  <FileText className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />
                </div>
              )}
              <div className="min-w-0 max-w-[120px]">
                <p className="text-[11px] font-semibold truncate" style={{ color: 'var(--text-main)' }}>{pf.file.name}</p>
                <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{formatFileSize(pf.file.size)}</p>
              </div>
              <button
                type="button"
                onClick={() => removeFile(i)}
                className="p-1 rounded-lg flex-shrink-0 transition-smooth"
                style={{ color: 'var(--text-muted)' }}
                onMouseEnter={e => { e.currentTarget.style.color = '#f87171'; e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.1)'; }}
                onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.backgroundColor = 'transparent'; }}
                title="Remove file"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex items-center gap-2 max-w-5xl mx-auto p-1.5 rounded-2xl transition-smooth" style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="flex-shrink-0 h-11 w-11 flex items-center justify-center rounded-xl active:scale-95 transition-smooth"
          style={{ color: 'var(--text-muted)' }}
          onMouseEnter={e => e.currentTarget.style.color = 'var(--text-main)'}
          onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}
          title="Attach file(s)"
        >
          <Paperclip className="h-5 w-5" />
        </button>

        <input ref={fileInputRef} type="file" multiple className="hidden" onChange={e => { addFiles(e.target.files || []); e.target.value = ''; }} />

        <div className="flex-1 min-w-0 flex items-center">
          {isAnnouncementChannel && userRole === 'MEMBER' ? (
            <div className="py-2.5 px-3 text-sm italic text-center rounded-xl w-full" style={{ color: 'var(--text-muted)', backgroundColor: 'var(--bg-input)', border: '1px solid var(--border-color)' }}>
              Only Admins and Supervisors can post in this announcement channel.
            </div>
          ) : (
            <textarea
              ref={textareaRef}
              value={text}
              onChange={e => setText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={placeholderText}
              rows={1}
              className="w-full bg-transparent py-2.5 px-2 text-sm focus:outline-none resize-none min-h-[44px] max-h-32 leading-relaxed"
              style={{ color: 'var(--text-main)' }}
            />
          )}
        </div>

        {(!isAnnouncementChannel || userRole !== 'MEMBER') && (
          <button
            type="submit"
            disabled={!canSend}
            className="flex-shrink-0 h-11 w-11 flex items-center justify-center rounded-xl font-bold active:scale-95 disabled:opacity-30 transition-smooth"
            style={{ backgroundColor: 'var(--accent-primary)', color: 'var(--accent-text)' }}
            title={canSend ? (pendingFiles.length > 0 ? `Send ${pendingFiles.length} file(s)` : 'Send message') : 'Type a message to send'}
          >
            {isPreparing ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
          </button>
        )}
      </form>

      {isDragging && (
        <div className="mt-3 p-4 rounded-xl border-2 border-dashed text-center text-xs font-bold animate-fadeIn" style={{ borderColor: 'var(--accent-primary)', color: 'var(--accent-primary)', backgroundColor: 'color-mix(in srgb, var(--accent-primary) 5%, transparent)' }}>
          DROP FILES TO ENCRYPT & ATTACH
        </div>
      )}
    </div>
  );
};
