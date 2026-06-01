'use client';

import { Link as LinkIcon } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { NotionDocument } from '@/lib/services/notionService';
import { colorForType } from './typeColors';

interface DocumentRowProps {
  doc: NotionDocument;
}

function formatLastEdited(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const diffMs = Date.now() - date.getTime();
  const day = 24 * 60 * 60 * 1000;
  if (diffMs < day) return 'Updated today';
  if (diffMs < 2 * day) return 'Updated yesterday';
  if (diffMs < 7 * day) return `Updated ${Math.floor(diffMs / day)} days ago`;
  return `Updated ${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
}

function DocIcon({ icon }: { icon: NotionDocument['icon'] }) {
  if (!icon) return null;
  if (icon.type === 'emoji') {
    return (
      <span className="flex h-6 w-6 shrink-0 items-center justify-center text-base leading-none">
        {icon.value}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={icon.value}
      alt=""
      className="h-6 w-6 shrink-0 rounded-sm object-cover"
    />
  );
}

export function DocumentRow({ doc }: DocumentRowProps) {
  const targetUrl = doc.url ?? doc.notionPageUrl;

  const openDoc = () => {
    if (!targetUrl) return;
    window.open(targetUrl, '_blank', 'noopener,noreferrer');
  };

  const copyLink = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!targetUrl) return;
    try {
      await navigator.clipboard.writeText(targetUrl);
      toast('Link Copied!');
    } catch {
      toast.error('Could not copy link');
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openDoc();
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={openDoc}
      onKeyDown={onKeyDown}
      className="group flex w-full cursor-pointer items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 text-left shadow-xs transition-all duration-150 hover:bg-accent hover:border-accent-foreground/20 active:translate-y-px active:shadow-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      <DocIcon icon={doc.icon} />

      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-semibold text-foreground">
          {doc.name || 'Untitled'}
        </span>
        <span className="truncate text-xs text-muted-foreground">
          {formatLastEdited(doc.lastEditedTime)}
        </span>
      </div>

      <div className="hidden shrink-0 flex-wrap items-center justify-end gap-1.5 sm:flex">
        {doc.types.map(t => {
          const c = colorForType(t);
          return (
            <Badge
              key={t}
              variant="outline"
              className={`${c.badge} font-medium`}
            >
              {t}
            </Badge>
          );
        })}
      </div>

      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={copyLink}
            aria-label="Copy link"
            className="ml-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <LinkIcon className="h-4 w-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top">Copy Link</TooltipContent>
      </Tooltip>
    </div>
  );
}
