import React, { useEffect, useState } from 'react';
import { ExternalLink, Globe } from 'lucide-react';

interface LinkPreviewData {
  url: string;
  title: string | null;
  description: string | null;
  image: string | null;
}

const previewCache = new Map<string, LinkPreviewData>();

export const LinkPreview: React.FC<{ url: string }> = ({ url }) => {
  const [data, setData] = useState<LinkPreviewData | null>(() => previewCache.get(url) || null);
  const [loading, setLoading] = useState(!previewCache.has(url));

  useEffect(() => {
    if (previewCache.has(url)) {
      setData(previewCache.get(url)!);
      return;
    }

    let cancelled = false;
    setLoading(true);

    fetch(`/api/url-preview?url=${encodeURIComponent(url)}`)
      .then(r => r.json())
      .then((result: LinkPreviewData) => {
        if (cancelled) return;
        previewCache.set(url, result);
        setData(result);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [url]);

  if (loading) {
    return (
      <div className="mt-1.5 p-3 rounded-xl border animate-pulse" style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-surface)' }}>
        <div className="h-3 w-24 rounded" style={{ backgroundColor: 'var(--bg-input)' }} />
        <div className="h-2 w-full rounded mt-2" style={{ backgroundColor: 'var(--bg-input)' }} />
      </div>
    );
  }

  if (!data || (!data.title && !data.description && !data.image)) return null;

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-1.5 block rounded-xl border overflow-hidden transition-all hover:shadow-md group/preview max-w-sm"
      style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-surface)' }}
      onClick={e => e.stopPropagation()}
    >
      {data.image && (
        <div className="h-28 overflow-hidden bg-black/10">
          <img
            src={data.image}
            alt=""
            className="w-full h-full object-cover group-hover/preview:scale-105 transition-transform duration-300"
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
          />
        </div>
      )}
      <div className="p-3">
        <div className="flex items-center gap-1.5 mb-1">
          <Globe className="w-3 h-3 shrink-0" style={{ color: 'var(--text-muted)' }} />
          <span className="text-[10px] truncate" style={{ color: 'var(--text-muted)' }}>
            {new URL(url).hostname}
          </span>
          <ExternalLink className="w-2.5 h-2.5 ml-auto opacity-0 group-hover/preview:opacity-100 transition-opacity" style={{ color: 'var(--text-muted)' }} />
        </div>
        {data.title && (
          <p className="text-xs font-semibold line-clamp-2" style={{ color: 'var(--text-main)' }}>{data.title}</p>
        )}
        {data.description && (
          <p className="text-[10px] line-clamp-2 mt-0.5" style={{ color: 'var(--text-muted)' }}>{data.description}</p>
        )}
      </div>
    </a>
  );
};
