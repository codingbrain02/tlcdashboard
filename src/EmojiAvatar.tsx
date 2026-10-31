import { getAvatarEmoji } from './emojiAvatars'

export default function EmojiAvatar({ value, className = '' }: { value: unknown; className?: string }) {
  return <span aria-hidden="true" data-emoji-avatar className={'emoji-avatar grid shrink-0 place-items-center rounded-full ' + className}>{getAvatarEmoji(value)}</span>
}
