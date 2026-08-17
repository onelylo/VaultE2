import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, CheckCircle, AlertTriangle, Info, AlertCircle } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

interface Toast {
  id: number;
  message: string;
  type: ToastType;
  duration: number;
}

let nextId = 0;
let listeners: ((toasts: Toast[]) => void)[] = [];
let toasts: Toast[] = [];

function notify() {
  for (const l of listeners) l([...toasts]);
}

export function showToast(message: string, type: ToastType = 'info', duration = 4000) {
  const id = nextId++;
  toasts = [...toasts, { id, message, type, duration }];
  notify();
  if (duration > 0) {
    setTimeout(() => dismissToast(id), duration);
  }
}

function dismissToast(id: number) {
  toasts = toasts.filter(t => t.id !== id);
  notify();
}

const ICONS: Record<ToastType, typeof Info> = {
  success: CheckCircle,
  error: AlertCircle,
  warning: AlertTriangle,
  info: Info,
};

const COLORS: Record<ToastType, { bg: string; border: string; text: string; icon: string }> = {
  success: { bg: 'rgba(34,197,94,0.1)', border: 'rgba(34,197,94,0.3)', text: '#4ade80', icon: '#4ade80' },
  error: { bg: 'rgba(239,68,68,0.1)', border: 'rgba(239,68,68,0.3)', text: '#f87171', icon: '#f87171' },
  warning: { bg: 'rgba(251,191,36,0.1)', border: 'rgba(251,191,36,0.3)', text: '#fbbf24', icon: '#fbbf24' },
  info: { bg: 'rgba(96,165,250,0.1)', border: 'rgba(96,165,250,0.3)', text: '#60a5fa', icon: '#60a5fa' },
};

function ToastItem({ toast }: { toast: Toast }) {
  const [exiting, setExiting] = useState(false);
  const Icon = ICONS[toast.type];
  const colors = COLORS[toast.type];

  useEffect(() => {
    const t = setTimeout(() => setExiting(true), toast.duration - 200);
    return () => clearTimeout(t);
  }, [toast.duration]);

  return (
    <div
      className={`flex items-start gap-2.5 px-4 py-3 rounded-xl text-xs max-w-sm transition-all duration-200 ${exiting ? 'opacity-0 translate-x-4' : 'opacity-100 translate-x-0'}`}
      style={{ backgroundColor: colors.bg, border: `1px solid ${colors.border}`, boxShadow: '0 8px 24px rgba(0,0,0,0.2)' }}
    >
      <Icon className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: colors.icon }} />
      <span className="flex-1 leading-relaxed" style={{ color: colors.text }}>{toast.message}</span>
      <button onClick={() => dismissToast(toast.id)} className="flex-shrink-0 mt-0.5 opacity-60 hover:opacity-100 transition-opacity" style={{ color: colors.text }}>
        <X className="w-3 h-3" />
      </button>
    </div>
  );
}

export function ToastContainer() {
  const [items, setItems] = useState<Toast[]>([]);
  const listenerRef = useRef(setItems);
  listenerRef.current = setItems;

  useEffect(() => {
    const handler = (t: Toast[]) => listenerRef.current(t);
    listeners.push(handler);
    return () => { listeners = listeners.filter(l => l !== handler); };
  }, []);

  if (items.length === 0) return null;
  return createPortal(
    <div className="fixed top-5 right-4 z-[99999] flex flex-col gap-2 pointer-events-none">
      {items.map(t => <div key={t.id} className="pointer-events-auto"><ToastItem toast={t} /></div>)}
    </div>,
    document.body
  );
}
