// node --test test/ (npm test). Whereabouts from Home Assistant: the badge's word and emoji, what a
// screen reader hears, and when the "Where everyone is" card shows.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { placeBadge, placeSentence, whereaboutsRows } from '../src/whereabouts.ts'

const members = [
  { id: 'm1', name: 'Alex', sort: 0 },
  { id: 'm2', name: 'Sam', sort: 1 },
  { id: 'm3', name: 'Maya', sort: 2 },
  { id: 'm4', name: 'Leo', sort: 3 },
]

test('placeBadge: a word with an emoji for every place, so color is never the only signal', () => {
  assert.deepEqual(placeBadge({ kind: 'home' }), { emoji: '🏠', word: 'Home' })
  assert.deepEqual(placeBadge({ kind: 'place', name: 'School' }), { emoji: '📍', word: 'School' })
  assert.deepEqual(placeBadge({ kind: 'out' }), { emoji: '🚶', word: 'Out' })
})

test('placeSentence: whole sentences a screen reader can say', () => {
  assert.equal(placeSentence('Alex', { kind: 'home' }), 'Alex is home')
  assert.equal(placeSentence('Sam', { kind: 'place', name: 'School' }), 'Sam is at School')
  assert.equal(placeSentence('Maya', { kind: 'out' }), 'Maya is out')
})

test('whereaboutsRows: members in family order, only those with known whereabouts', () => {
  const rows = whereaboutsRows({ members: [
    { memberId: 'm3', place: { kind: 'out' } },
    { memberId: 'm1', place: { kind: 'home' } },
    { memberId: 'gone', place: { kind: 'home' } }, // a member this device doesn't know
  ] }, members)
  assert.deepEqual(rows.map(r => [r.member.name, r.badge.word, r.sentence]), [['Alex', 'Home', 'Alex is home'], ['Maya', 'Out', 'Maya is out']])
})

test('whereaboutsRows: nothing known (or nothing loaded) is no rows, so the card hides', () => {
  assert.deepEqual(whereaboutsRows({ members: [] }, members), [])
  assert.deepEqual(whereaboutsRows(null, members), [])
})
