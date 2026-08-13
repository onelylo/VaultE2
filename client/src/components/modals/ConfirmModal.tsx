import React from 'react';
import { AlertTriangle, X } from 'lucide-react';

interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  isDangerous?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

export const ConfirmModal: React.FC<ConfirmModalProps> = ({
  isOpen,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  isDangerous = true,
  onConfirm,
  onClose,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[99999] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-[fadeIn_0.15s_ease-out]">
      <div
        className="w-full max-w-sm rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-color)] p-6 shadow-2xl flex flex-col gap-4 text-[var(--text-main)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className={`p-2.5 rounded-xl ${isDangerous ? 'bg-red-500/10 text-red-500' : 'bg-[var(--accent-primary)]/10 text-[var(--accent-primary)]'}`}>
              <AlertTriangle className="w-5 h-5"/>
            </div>
            <h3 className="text-base font-bold">{title}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-[var(--text-muted)] hover:text-[var(--text-main)] transition-colors p-1"
          >
            <X className="w-4 h-4"/>
          </button>
        </div>

        <p className="text-xs text-[var(--text-muted)] leading-relaxed">
          {description}
        </p>

        <div className="flex items-center justify-end gap-2 mt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl border border-[var(--border-color)] text-xs font-semibold hover:bg-[var(--hover-color)] transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={() => {
              onConfirm();
              onClose();
            }}
            className={`px-4 py-2 rounded-xl text-xs font-semibold text-white transition-opacity ${
              isDangerous ? 'bg-red-600 hover:bg-red-700' : 'bg-[var(--accent-primary)] hover:opacity-90'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
