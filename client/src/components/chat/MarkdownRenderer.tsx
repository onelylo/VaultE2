import React from 'react';

type Token = { type: string; content: string };

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  // Match: ```code blocks```, `inline code`, **bold**, *italic*, ~~strikethrough~~, and plain text
  const regex = /(```[\s\S]*?```|`[^`]+`|\*\*(.+?)\*\*|\*(.+?)\*|~~(.+?)~~)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({ type: 'text', content: text.slice(lastIndex, match.index) });
    }
    if (match[1].startsWith('```')) {
      tokens.push({ type: 'codeblock', content: match[1].slice(3, -3).trim() });
    } else if (match[1].startsWith('`')) {
      tokens.push({ type: 'code', content: match[1].slice(1, -1) });
    } else if (match[1].startsWith('**')) {
      tokens.push({ type: 'bold', content: match[2]! });
    } else if (match[1].startsWith('*')) {
      tokens.push({ type: 'italic', content: match[3]! });
    } else if (match[1].startsWith('~~')) {
      tokens.push({ type: 'strikethrough', content: match[4]! });
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    tokens.push({ type: 'text', content: text.slice(lastIndex) });
  }
  return tokens;
}

function renderTokens(tokens: Token[]): React.ReactNode[] {
  return tokens.map((token, i) => {
    switch (token.type) {
      case 'bold':
        return <strong key={i} className="font-bold">{token.content}</strong>;
      case 'italic':
        return <em key={i} className="italic">{token.content}</em>;
      case 'strikethrough':
        return <s key={i} className="line-through opacity-60">{token.content}</s>;
      case 'code':
        return (
          <code key={i} className="px-1.5 py-0.5 rounded text-xs font-mono bg-black/20 dark:bg-white/10" style={{ backgroundColor: 'color-mix(in srgb, var(--text-main) 8%, transparent)' }}>
            {token.content}
          </code>
        );
      case 'codeblock':
        return (
          <pre key={i} className="my-1 p-3 rounded-lg text-xs font-mono overflow-x-auto" style={{ backgroundColor: 'color-mix(in srgb, var(--text-main) 8%, transparent)' }}>
            <code>{token.content}</code>
          </pre>
        );
      default:
        return <span key={i}>{token.content}</span>;
    }
  });
}

export const MarkdownRenderer: React.FC<{ text: string; className?: string }> = ({ text, className }) => {
  // Handle multi-line messages: split by newlines, render code blocks separately
  const lines = text.split('\n');
  const elements: React.ReactNode[] = [];

  let inCodeBlock = false;
  let codeContent = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.trimStart().startsWith('```')) {
      if (inCodeBlock) {
        // End of code block
        elements.push(
          <pre key={`cb-${i}`} className="my-1 p-3 rounded-lg text-xs font-mono overflow-x-auto" style={{ backgroundColor: 'color-mix(in srgb, var(--text-main) 8%, transparent)' }}>
            <code>{codeContent.trim()}</code>
          </pre>
        );
        codeContent = '';
        inCodeBlock = false;
      } else {
        // Start of code block
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      codeContent += (codeContent ? '\n' : '') + line;
      continue;
    }

    // Regular line — parse inline markdown
    const tokens = tokenize(line);
    elements.push(
      <React.Fragment key={i}>
        {renderTokens(tokens)}
        {i < lines.length - 1 && <br />}
      </React.Fragment>
    );
  }

  // If we ended while still in a code block, render it
  if (inCodeBlock && codeContent) {
    elements.push(
      <pre key="cb-end" className="my-1 p-3 rounded-lg text-xs font-mono overflow-x-auto" style={{ backgroundColor: 'color-mix(in srgb, var(--text-main) 8%, transparent)' }}>
        <code>{codeContent.trim()}</code>
      </pre>
    );
  }

  return <div className={className}>{elements}</div>;
};
