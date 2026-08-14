import React, { useState, useRef, useEffect, useLayoutEffect } from 'react';

const QUICK_REACTIONS = ['👍', '👎', '❤️', '🔥', '😂', '😮', '😢', '🎉', '🚀', '👀', '✅', '💯', '🤔', '👏', '💪', '🙏'];

interface ReactionPickerProps {
  onSelect: (emoji: string) => void;
  existingEmojis?: string[];
  triggerClassName?: string;
  triggerStyle?: React.CSSProperties;
  triggerOnMouseEnter?: (e: React.MouseEvent) => void;
  triggerOnMouseLeave?: (e: React.MouseEvent) => void;
  triggerLabel?: string;
}

export const ReactionPicker: React.FC<ReactionPickerProps> = ({ onSelect, existingEmojis = [], triggerClassName, triggerStyle, triggerOnMouseEnter, triggerOnMouseLeave, triggerLabel }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [customEmoji, setCustomEmoji] = useState('');
  const [position, setPosition] = useState<'top' | 'bottom'>('top');
  const [align, setAlign] = useState<'left' | 'right'>('left');
  const ref = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    window.addEventListener('mousedown', handleClick);
    return () => window.removeEventListener('mousedown', handleClick);
  }, [isOpen]);

  // Viewport boundary detection
  useLayoutEffect(() => {
    if (!isOpen || !ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const popupHeight = 280; // approximate height of reaction picker
    const popupWidth = 270; // approximate width

    // Vertical: prefer top, flip to bottom if not enough space
    if (rect.top < popupHeight + 10) {
      setPosition('bottom');
    } else {
      setPosition('top');
    }

    // Horizontal: prefer left, flip to right if overflow
    if (rect.left + popupWidth > window.innerWidth) {
      setAlign('right');
    } else {
      setAlign('left');
    }
  }, [isOpen]);

  return (
    <div ref={ref} className="relative inline-flex">
      <button
        onClick={(e) => { e.stopPropagation(); setIsOpen(!isOpen); }}
        className={triggerClassName || "p-1 rounded-md transition-smooth text-xs opacity-0 group-hover:opacity-100 focus:opacity-100"}
        style={triggerStyle || { color: 'var(--text-muted)' }}
        onMouseEnter={triggerOnMouseEnter || (e => e.currentTarget.style.color = 'var(--text-main)')}
        onMouseLeave={triggerOnMouseLeave || (e => e.currentTarget.style.color = 'var(--text-muted)')}
        title={triggerLabel || "Add reaction"}
      >
        {triggerClassName ? <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg> : "😊"}
      </button>
      {isOpen && (
        <div
          ref={popupRef}
          className={`absolute ${align === 'right' ? 'right-0' : 'left-0'} ${position === 'top' ? 'bottom-full mb-1' : 'top-full mt-1'} flex flex-col p-1.5 rounded-xl shadow-2xl z-50 animate-scaleIn`}
          style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)' }}
          onClick={e => e.stopPropagation()}
        >
          <div className="grid grid-cols-8 gap-0.5">
            {QUICK_REACTIONS.map(emoji => (
              <button
                key={emoji}
                onClick={() => { onSelect(emoji); setIsOpen(false); }}
                className="w-8 h-8 flex items-center justify-center rounded-lg text-sm transition-smooth hover:scale-110"
                style={{
                  backgroundColor: existingEmojis.includes(emoji) ? 'color-mix(in srgb, var(--accent-primary) 30%, transparent)' : 'transparent',
                }}
                onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--hover-color)'}
                onMouseLeave={e => e.currentTarget.style.backgroundColor = existingEmojis.includes(emoji) ? 'color-mix(in srgb, var(--accent-primary) 30%, transparent)' : 'transparent'}
              >
                {emoji}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1 mt-1 pt-1" style={{ borderTop: '1px solid var(--border-color)' }}>
            <input
              type="text"
              value={customEmoji}
              onChange={e => setCustomEmoji(e.target.value)}
              placeholder="Type emoji..."
              className="flex-1 text-xs px-2 py-1 rounded-md focus:outline-none"
              style={{ backgroundColor: 'var(--bg-input)', border: '1px solid var(--border-color)', color: 'var(--text-main)' }}
              onKeyDown={e => {
                if (e.key === 'Enter' && customEmoji.trim()) {
                  onSelect(customEmoji.trim());
                  setCustomEmoji('');
                  setIsOpen(false);
                }
              }}
            />
            <button
              onClick={() => { if (customEmoji.trim()) { onSelect(customEmoji.trim()); setCustomEmoji(''); setIsOpen(false); } }}
              className="px-2 py-1 text-[10px] font-bold rounded-md transition-smooth"
              style={{ backgroundColor: 'var(--accent-primary)', color: 'var(--accent-text)' }}
            >
              ADD
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
