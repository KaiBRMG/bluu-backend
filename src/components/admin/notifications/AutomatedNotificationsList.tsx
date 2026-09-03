'use client';

import { SendHorizontal } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { notificationTypeBadge } from '@/lib/notificationTypeBadge';
import {
  AUTOMATED_NOTIFICATIONS,
  AUTOMATED_NOTIFICATION_CATEGORIES,
  AUTOMATED_CREATOR_NOTIFICATIONS,
  type AutomatedNotification,
  type AutomatedCreatorNotification,
} from '@/lib/automatedNotifications';

/**
 * Read-only reference for every notification the system sends automatically.
 * Nothing here is fetched or mutable — the catalogue is derived from the
 * notification factories, so it cannot drift from what users receive.
 */

/** Renders `{token}` placeholders as inline chips so the template shape is legible. */
function TemplateText({ text }: { text: string }) {
  const parts = text.split(/(\{[^}]+\})/g);

  return (
    <>
      {parts.map((part, i) =>
        /^\{[^}]+\}$/.test(part) ? (
          <code
            key={i}
            className="mx-0.5 rounded bg-white/[0.08] px-1 py-0.5 font-mono text-xs text-zinc-300"
          >
            {part.slice(1, -1)}
          </code>
        ) : (
          part
        ),
      )}
    </>
  );
}

function MetaRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <dt className="w-24 shrink-0 text-xs text-zinc-400">{label}</dt>
      <dd className="min-w-0 flex-1 text-sm text-zinc-300">{children}</dd>
    </div>
  );
}

function NotificationRow({ entry }: { entry: AutomatedNotification }) {
  const typeMeta = notificationTypeBadge(entry.content.type);

  return (
    <AccordionItem value={entry.id} className="border-white/[0.07] last:border-b-0">
      <AccordionTrigger className="items-center rounded-none px-3 py-3 transition-colors hover:bg-accent/50 hover:no-underline">
        <div className="flex min-w-0 flex-1 items-center gap-3 text-left">
          <span className="min-w-0 flex-1 truncate text-sm font-medium">
            {entry.content.title}
          </span>
          <span className="hidden min-w-0 shrink truncate text-xs text-zinc-400 sm:block">
            {entry.recipients}
          </span>
          {entry.telegramEnabled && (
            <span
              className="inline-flex shrink-0 items-center gap-1 text-xs font-normal text-muted-foreground"
              title="Also sent as a Telegram alert"
            >
              <SendHorizontal className="h-3 w-3" />
              Telegram
            </span>
          )}
          <Badge variant="outline" className={`shrink-0 ${typeMeta.className}`}>
            {typeMeta.label}
          </Badge>
        </div>
      </AccordionTrigger>

      <AccordionContent className="px-3 pb-4">
        <div className="rounded-md border border-white/[0.07] bg-white/[0.04] p-3 text-sm break-words whitespace-pre-wrap text-zinc-300">
          <TemplateText text={entry.content.message} />
        </div>

        <dl className="mt-3 space-y-2">
          <MetaRow label="Fires when">{entry.trigger}</MetaRow>
          <MetaRow label="Recipients">{entry.recipients}</MetaRow>
          <MetaRow label="Links to">
            {entry.content.actionUrl ? (
              <TemplateText text={entry.content.actionUrl} />
            ) : (
              <span className="text-zinc-400">Nothing — informational only</span>
            )}
          </MetaRow>
          <MetaRow label="Sent by">
            {entry.sources.map(src => (
              <div key={src} className="font-mono text-xs break-all text-zinc-400">
                {src}
              </div>
            ))}
          </MetaRow>
        </dl>
      </AccordionContent>
    </AccordionItem>
  );
}

/** A creator-facing entry — no `type`/`actionUrl` (no in-app tray), always Telegram. */
function CreatorNotificationRow({ entry }: { entry: AutomatedCreatorNotification }) {
  return (
    <AccordionItem value={entry.id} className="border-white/[0.07] last:border-b-0">
      <AccordionTrigger className="items-center rounded-none px-3 py-3 transition-colors hover:bg-accent/50 hover:no-underline">
        <div className="flex min-w-0 flex-1 items-center gap-3 text-left">
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{entry.event}</span>
          <span className="hidden min-w-0 shrink truncate text-xs text-zinc-400 sm:block">
            {entry.recipients}
          </span>
          <span
            className="inline-flex shrink-0 items-center gap-1 text-xs font-normal text-muted-foreground"
            title="Sent as a Telegram message — creators have no in-app tray"
          >
            <SendHorizontal className="h-3 w-3" />
            Telegram
          </span>
        </div>
      </AccordionTrigger>

      <AccordionContent className="px-3 pb-4">
        <div className="rounded-md border border-white/[0.07] bg-white/[0.04] p-3 text-sm break-words whitespace-pre-wrap text-zinc-300">
          <TemplateText text={entry.message} />
        </div>

        <dl className="mt-3 space-y-2">
          <MetaRow label="Fires when">{entry.trigger}</MetaRow>
          <MetaRow label="Recipients">{entry.recipients}</MetaRow>
          <MetaRow label="Sent by">
            {entry.sources.map(src => (
              <div key={src} className="font-mono text-xs break-all text-zinc-400">
                {src}
              </div>
            ))}
          </MetaRow>
        </dl>
      </AccordionContent>
    </AccordionItem>
  );
}

export default function AutomatedNotificationsList() {
  return (
    <div className="mt-6 space-y-6">
      <p className="max-w-[70ch] text-sm text-muted-foreground">
        Sent by the system when an event occurs — nobody triggers these by hand, and they
        cannot be edited or unsent. Values shown as{' '}
        <code className="rounded bg-white/[0.08] px-1 py-0.5 font-mono text-xs text-zinc-300">
          chips
        </code>{' '}
        are filled in per notification.
      </p>

      {AUTOMATED_NOTIFICATION_CATEGORIES.map(category => {
        const entries = AUTOMATED_NOTIFICATIONS.filter(n => n.category === category);
        if (entries.length === 0) return null;

        return (
          <section key={category}>
            <div className="mb-2 flex items-center gap-2">
              <h2 className="text-sm font-semibold">{category}</h2>
              <Badge variant="secondary" className="tabular-nums">
                {entries.length}
              </Badge>
            </div>

            <Accordion
              type="multiple"
              className="overflow-hidden rounded-lg border border-white/[0.07] bg-white/[0.025]"
            >
              {entries.map(entry => (
                <NotificationRow key={entry.id} entry={entry} />
              ))}
            </Accordion>
          </section>
        );
      })}

      {AUTOMATED_CREATOR_NOTIFICATIONS.length > 0 && (
        <section>
          <div className="mb-2 flex items-center gap-2">
            <h2 className="text-sm font-semibold">Creators</h2>
            <Badge variant="secondary" className="tabular-nums">
              {AUTOMATED_CREATOR_NOTIFICATIONS.length}
            </Badge>
          </div>
          <p className="mb-2 max-w-[70ch] text-xs text-muted-foreground">
            Sent to creators, not staff — Telegram only, since the creator portal has no
            in-app notification tray.
          </p>

          <Accordion
            type="multiple"
            className="overflow-hidden rounded-lg border border-white/[0.07] bg-white/[0.025]"
          >
            {AUTOMATED_CREATOR_NOTIFICATIONS.map(entry => (
              <CreatorNotificationRow key={entry.id} entry={entry} />
            ))}
          </Accordion>
        </section>
      )}
    </div>
  );
}
