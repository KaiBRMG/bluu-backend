'use client';

import { useState } from 'react';
import { CheckIcon, CopyIcon } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

/** Icon button that copies a URL to the clipboard with a toast + check swap. */
export function CopyLinkButton({ url, className }: { url: string; className?: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(url);
      toast('Link Copied!');
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error('Failed to copy link');
    }
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn('size-6 shrink-0 text-muted-foreground hover:text-foreground', className)}
          onClick={copy}
          aria-label="Copy link"
        >
          {copied ? <CheckIcon className="size-3.5 text-green-600" /> : <CopyIcon className="size-3.5" />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>Copy link</TooltipContent>
    </Tooltip>
  );
}

/**
 * Truncated clickable link (opens in the system browser — Electron routes
 * window.open there) with a copy button beside it. Renders nothing when the
 * URL is empty so optional fields disappear cleanly.
 */
export function LinkWithCopy({
  url,
  label,
  className,
}: {
  url: string;
  label?: string; // display text; defaults to the URL itself
  className?: string;
}) {
  if (!url) return null;

  return (
    <span className={cn('inline-flex items-center gap-1 min-w-0 max-w-full', className)}>
      <button
        type="button"
        className="truncate text-sm text-primary underline-offset-4 hover:underline text-left"
        onClick={(e) => {
          e.stopPropagation();
          window.open(url, '_blank', 'noopener,noreferrer');
        }}
        title={url}
      >
        {label || url}
      </button>
      <CopyLinkButton url={url} />
    </span>
  );
}
