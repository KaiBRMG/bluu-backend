/**
 * The composer's emoji set.
 *
 * A curated list rather than a picker library, for two reasons. The repo's UI
 * rule is shadcn primitives only — a third-party picker brings its own popover,
 * its own theming and ~40KB of sprite data. And the full Unicode set is the
 * wrong content anyway: an operator writing to a fan reaches for the same three
 * dozen faces and hearts all shift, and having to scroll past flags and
 * kitchenware to find them is slower than a short list.
 *
 * Ordered by how often it is actually reached for on this surface, not by
 * Unicode block. Every glyph is in the standard system emoji font on macOS and
 * Windows 10+, so nothing renders as a tofu box.
 */

export interface EmojiGroup {
  name: string;
  emoji: string[];
}

export const EMOJI_GROUPS: EmojiGroup[] = [
  {
    name: 'Flirty',
    emoji: [
      '😘', '😍', '🥰', '😏', '😉', '🤤', '🥵', '😈', '👅', '💋',
      '🔥', '💦', '🍑', '🍆', '🙈', '👀', '😻', '💫', '✨', '🫦',
    ],
  },
  {
    name: 'Smileys',
    emoji: [
      '😀', '😁', '😂', '🤣', '😊', '🙂', '😌', '😅', '😇', '🙃',
      '😎', '🤗', '🤭', '🤫', '😴', '🥱', '😢', '🥺', '😭', '😳',
      '😱', '🤔', '🙄', '😒', '😤', '😡', '🥴', '🤪', '😜', '😝',
    ],
  },
  {
    name: 'Hearts',
    emoji: [
      '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔',
      '❣️', '💕', '💞', '💓', '💗', '💖', '💘', '💝', '♥️', '💌',
    ],
  },
  {
    name: 'Gestures',
    emoji: [
      '👋', '🤙', '👌', '🤞', '🤝', '👏', '🙌', '🙏', '💪', '🫶',
      '👍', '👎', '✌️', '🤗', '🫂', '🤷', '🤦', '💁', '🙋', '🫡',
    ],
  },
  {
    name: 'Money',
    emoji: [
      '💰', '💵', '💸', '🤑', '💎', '🎁', '🛍️', '👑', '🏆', '⭐',
      '🥂', '🍾', '🎉', '🎊', '🔓', '🔒', '⏳', '📩', '📸', '🎥',
    ],
  },
  {
    name: 'Things',
    emoji: [
      '☀️', '🌙', '⭐', '🌸', '🌹', '🍓', '🍒', '🍭', '☕', '🍷',
      '🎵', '🛏️', '🚿', '🏖️', '✈️', '🚗', '🐱', '🐶', '🦋', '🌈',
    ],
  },
];
