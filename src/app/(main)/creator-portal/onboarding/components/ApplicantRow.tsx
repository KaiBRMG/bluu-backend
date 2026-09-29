'use client';

import { useState } from 'react';
import { IconBrandTelegram, IconBrandWhatsapp, IconCheck, IconCopy, IconMailForward } from '@tabler/icons-react';
import { Loader2Icon } from 'lucide-react';
import { formatDistanceToNowStrict } from 'date-fns';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { copyText } from '@/lib/copyText';
import { ONBOARDING_STAGE_META, stripAt, telegramUrl, whatsappUrl, type OnboardingStage } from '@/lib/creatorOnboarding';
import { cn } from '@/lib/utils';
import type { OnboardingSummary } from '@/types/creatorOnboarding';

interface ApplicantRowProps {
  /** The row, with its derived stage. */
  onboarding: OnboardingSummary & { stage: OnboardingStage };
  onOpen: () => void;
  onResend: () => Promise<boolean>;
}

const shortDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
const ago = (iso: string | null) => (iso ? formatDistanceToNowStrict(new Date(iso), { addSuffix: true }) : 'never');

/**
 * One applicant. Two lines, the whole row opens their answers (an `inset-0`
 * button under the content, so there is no dead strip anywhere on the row),
 * and the trailing lane sits above it with the one action this stage calls for:
 *
 *   - Completed → **Message on Telegram** (the page's main action), or WhatsApp
 *     when they somehow have no handle, plus copy-handle.
 *   - Anything else → **Send new link**, which rotates the link and re-sends the
 *     welcome email. The nudge for someone who stalled or never opened it.
 */
export function ApplicantRow({ onboarding: o, onOpen, onResend }: ApplicantRowProps) {
  const { stage } = o;
  const [copied, setCopied] = useState(false);
  const [sending, setSending] = useState(false);
  const meta = ONBOARDING_STAGE_META[stage];
  const pct = o.requiredTotal ? Math.round((o.requiredAnswered / o.requiredTotal) * 100) : 0;
  const handle = stripAt(o.telegram);

  const facts: string[] = [];
  if (stage === 'completed' && o.completedAt) facts.push(`Finished ${shortDate(o.completedAt)}`);
  if (stage === 'started') facts.push(`${pct}% done`, `active ${ago(o.lastActivityAt)}`);
  if (stage === 'stalled') facts.push(`Stopped at ${pct}%`, `last active ${ago(o.lastActivityAt ?? o.openedAt)}`);
  if (stage === 'invited' && o.invitedAt) facts.push(`Invited ${ago(o.invitedAt)}`, 'link not opened yet');
  facts.push(o.track === 'of' ? 'Has OnlyFans' : 'New to OnlyFans');
  if (o.inviteCount > 1) facts.push(`link sent ${o.inviteCount}×`);
  if (o.invitedByName) facts.push(`by ${o.invitedByName}`);

  const copyHandle = async () => {
    // copyText goes through Electron's main process first — the web clipboard
    // API fails whenever the window is not focused.
    if (!(await copyText(`@${handle}`))) {
      toast.error('Could not copy');
      return;
    }
    setCopied(true);
    toast.success(`Copied @${handle}`);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <li className="group relative flex items-center gap-4 px-4 py-3 transition-colors hover:bg-white/[0.035]">
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Open ${o.name}’s onboarding answers`}
        className="absolute inset-0 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none focus-visible:ring-inset"
      />

      <div className="pointer-events-none min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate font-medium text-white">{o.name}</span>
          {o.stageName && <span className="truncate text-sm text-zinc-400">“{o.stageName}”</span>}
          <span className={cn('shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium', meta.classes)}>
            {meta.label}
          </span>
        </div>
        <p className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5 text-[11px] text-zinc-400 tabular-nums">
          {facts.map((f, i) => (
            <span key={f} className="inline-flex items-center gap-1.5">
              {i > 0 && <span aria-hidden>·</span>}
              {f}
            </span>
          ))}
        </p>
        {(stage === 'started' || stage === 'stalled') && (
          <div className="mt-2 h-1 w-40 overflow-hidden rounded-full bg-white/[0.08]" aria-hidden>
            <div
              className={cn('h-full rounded-full', stage === 'stalled' ? 'bg-orange-400/70' : 'bg-blue-400/80')}
              style={{ width: `${pct}%` }}
            />
          </div>
        )}
      </div>

      <div className="relative z-10 flex shrink-0 items-center gap-1.5">
        {stage === 'completed' ? (
          handle ? (
            <>
              <Button asChild size="sm" variant="outline" className="h-8 gap-1.5 border-white/[0.12] bg-white/[0.03]">
                {/* target=_blank: main.js hands it to the system browser, which opens Telegram. */}
                <a href={telegramUrl(handle)} target="_blank" rel="noopener noreferrer">
                  <IconBrandTelegram className="size-4 text-zinc-300" aria-hidden />
                  Message @{handle}
                </a>
              </Button>
              <Button
                size="icon"
                variant="ghost"
                onClick={copyHandle}
                aria-label={`Copy @${handle}`}
                className="size-8 text-zinc-400 hover:text-white"
              >
                {copied ? <IconCheck className="size-4 text-green-400" /> : <IconCopy className="size-4" />}
              </Button>
            </>
          ) : o.whatsapp ? (
            <Button asChild size="sm" variant="outline" className="h-8 gap-1.5 border-white/[0.12] bg-white/[0.03]">
              <a href={whatsappUrl(o.whatsapp)} target="_blank" rel="noopener noreferrer">
                <IconBrandWhatsapp className="size-4 text-zinc-300" aria-hidden />
                WhatsApp
              </a>
            </Button>
          ) : null
        ) : (
          <Button
            size="sm"
            variant="ghost"
            disabled={sending}
            onClick={async () => {
              setSending(true);
              await onResend();
              setSending(false);
            }}
            className="h-8 gap-1.5 text-zinc-300 hover:text-white"
            title="Emails a fresh link; the old one stops working"
          >
            {sending ? <Loader2Icon className="activity-spinner size-3.5 animate-spin" /> : <IconMailForward className="size-4" />}
            Send new link
          </Button>
        )}
      </div>
    </li>
  );
}
