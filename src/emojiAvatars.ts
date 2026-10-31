export const emojiAvatarGroups = [
  { label: 'Faces', choices: [
    { emoji: '🙂', label: 'Smile' },
    { emoji: '😊', label: 'Happy' },
    { emoji: '😄', label: 'Grin' },
    { emoji: '😎', label: 'Cool' },
    { emoji: '🤓', label: 'Nerd' },
    { emoji: '🤩', label: 'Star eyes' },
    { emoji: '🥳', label: 'Celebrate' },
    { emoji: '😌', label: 'Calm' },
    { emoji: '😺', label: 'Happy cat' },
    { emoji: '🤖', label: 'Robot' },
    { emoji: '👽', label: 'Alien' },
    { emoji: '👻', label: 'Ghost' },
  ] },
  { label: 'Animals', choices: [
    { emoji: '🐼', label: 'Panda' },
    { emoji: '🐨', label: 'Koala' },
    { emoji: '🦊', label: 'Fox' },
    { emoji: '🐯', label: 'Tiger' },
    { emoji: '🐱', label: 'Cat' },
    { emoji: '🐶', label: 'Dog' },
    { emoji: '🦁', label: 'Lion' },
    { emoji: '🐸', label: 'Frog' },
    { emoji: '🐻', label: 'Bear' },
    { emoji: '🐰', label: 'Rabbit' },
    { emoji: '🐧', label: 'Penguin' },
    { emoji: '🦉', label: 'Owl' },
  ] },
  { label: 'Nature', choices: [
    { emoji: '🌻', label: 'Sunflower' },
    { emoji: '🌵', label: 'Cactus' },
    { emoji: '🌲', label: 'Evergreen' },
    { emoji: '🍀', label: 'Clover' },
    { emoji: '🌸', label: 'Blossom' },
    { emoji: '🌈', label: 'Rainbow' },
    { emoji: '☀️', label: 'Sun' },
    { emoji: '🌙', label: 'Moon' },
    { emoji: '⭐', label: 'Star' },
    { emoji: '🌊', label: 'Wave' },
    { emoji: '🍄', label: 'Mushroom' },
    { emoji: '🪴', label: 'Plant' },
  ] },
  { label: 'Interests', choices: [
    { emoji: '🚀', label: 'Rocket' },
    { emoji: '🎨', label: 'Art' },
    { emoji: '🎮', label: 'Gaming' },
    { emoji: '🎧', label: 'Headphones' },
    { emoji: '🎸', label: 'Guitar' },
    { emoji: '📚', label: 'Books' },
    { emoji: '💻', label: 'Computer' },
    { emoji: '⚽', label: 'Football' },
    { emoji: '🏀', label: 'Basketball' },
    { emoji: '☕', label: 'Coffee' },
    { emoji: '💡', label: 'Idea' },
    { emoji: '🛸', label: 'Flying saucer' },
  ] },
] as const

const allowedEmojis = new Set<string>(emojiAvatarGroups.flatMap(group => group.choices.map(choice => choice.emoji)))

export function getAvatarEmoji(value: unknown): string {
  return typeof value === 'string' && allowedEmojis.has(value) ? value : '🙂'
}
