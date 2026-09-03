/**
 * Telegram haptic feedback.
 *
 * The portal runs inside Telegram's webview, which exposes a native haptics
 * API. Completing a piece of work is the portal's one physical moment, and on a
 * phone a tap that produces a real click is the difference between "I think
 * that worked" and "that worked".
 *
 * **Every call is optional and silent.** `telegramWebApp.ts` loads the SDK for
 * `ready()`/`expand()` only and treats its absence as survivable — a blocked or
 * slow CDN must never break sign-in. The same rule applies here: if the SDK is
 * missing, an older client does not implement `HapticFeedback`, or the call
 * throws, nothing happens and nothing is logged. Haptics are a garnish, and a
 * garnish may never become a failure mode.
 */

type ImpactStyle = "light" | "medium" | "heavy" | "rigid" | "soft";
type NotificationType = "error" | "success" | "warning";

interface HapticFeedbackApi {
  impactOccurred?: (style: ImpactStyle) => void;
  notificationOccurred?: (type: NotificationType) => void;
  selectionChanged?: () => void;
}

function haptics(): HapticFeedbackApi | null {
  if (typeof window === "undefined") return null;
  // `TelegramWebApp` in telegramWebApp.ts declares only what the sign-in path
  // needs. Widen locally rather than there: that file is the session lock, and
  // a garnish has no business growing its surface.
  const webApp = window.Telegram?.WebApp as
    | { HapticFeedback?: HapticFeedbackApi }
    | undefined;
  return webApp?.HapticFeedback ?? null;
}

/** A physical tick. Used on a press that changes something. */
export function tapFeedback(style: ImpactStyle = "light"): void {
  try {
    haptics()?.impactOccurred?.(style);
  } catch {
    /* see the header: never a failure mode */
  }
}

/** The completion beat — paired with the seal animation on the spine. */
export function successFeedback(): void {
  try {
    haptics()?.notificationOccurred?.("success");
  } catch {
    /* see the header */
  }
}

/** A failed mutation, paired with the error toast. */
export function errorFeedback(): void {
  try {
    haptics()?.notificationOccurred?.("error");
  } catch {
    /* see the header */
  }
}
