import assert from 'node:assert/strict'
import { emojiAvatarGroups, getAvatarEmoji } from '../../src/emojiAvatars.ts'

Deno.test('Emoji catalog is unique, labelled and restricted to single emoji graphemes', () => {
  const choices = emojiAvatarGroups.flatMap<{ emoji: string; label: string }>(group => group.choices)
  assert.equal(choices.length, 48)
  assert.equal(new Set(choices.map(choice => choice.emoji)).size, choices.length)
  const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' })
  for (const choice of choices) {
    assert.equal([...segmenter.segment(choice.emoji)].length, 1)
    assert.ok(choice.label)
    assert.equal(getAvatarEmoji(choice.emoji), choice.emoji)
  }
})

Deno.test('Arbitrary images, URLs, HTML and malformed values never render as avatars', () => {
  for (const value of [null, undefined, {}, 123, '', 'hello', '🐼🐼', 'https://example.com/photo.png', 'data:image/png;base64,AAA', '<img src=x>']) {
    assert.equal(getAvatarEmoji(value), '🙂')
  }
})

Deno.test('Frontend emoji choices exactly match the database allowlist', async () => {
  const migration = await Deno.readTextFile(new URL('../migrations/202611010007_employee_emoji_avatar.sql', import.meta.url))
  const databaseChoices = [...migration.matchAll(/^ {4}'([^']+)'/gm)].map(match => match[1])
  assert.deepEqual(databaseChoices, emojiAvatarGroups.flatMap(group => group.choices.map(choice => choice.emoji)))
})
