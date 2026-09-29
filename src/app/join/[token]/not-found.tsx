import { IconLinkOff } from '@tabler/icons-react';
import { cn } from '@/lib/utils';
import { AZURE, PANEL, STAGE_GROUND } from '@/app/model-submissions/_lib/theme';

/**
 * A link that does not resolve: mistyped, or replaced by a newer invite (a
 * re-send rotates the link and the old one stops working). One message for
 * every refusal, deliberately — telling a stranger WHY a token failed would let
 * them probe which ones exist.
 */
export default function JoinNotFound() {
  return (
    <main translate="no" className="notranslate grid min-h-dvh place-items-center px-5 text-white" style={STAGE_GROUND}>
      <div className="flex w-full max-w-md flex-col items-start gap-6 py-16">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo/HQ2.webp" alt="Bluu Rock" width={1374} height={868} className="h-11 w-auto" />
        <div className={cn(PANEL, 'flex w-full flex-col gap-4 rounded-2xl px-6 py-7')}>
          <span
            className="grid size-11 place-items-center rounded-full"
            style={{ backgroundColor: 'rgba(0,184,245,0.12)' }}
            aria-hidden
          >
            <IconLinkOff className="size-5" style={{ color: AZURE }} />
          </span>
          <h1 className="text-2xl leading-tight font-semibold tracking-[-0.02em]">This link isn’t active</h1>
          <p className="text-base leading-relaxed text-white/65">
            Onboarding links are personal, and a new one replaces the old. Open the most recent
            “Welcome to BLUU ROCK” email, or reply to it and we’ll send you a fresh link.
          </p>
        </div>
      </div>
    </main>
  );
}
