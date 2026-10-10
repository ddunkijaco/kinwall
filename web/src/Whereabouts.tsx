// Where everyone is, from Home Assistant: the hook every screen reads it with, and the badge (a word
// and an emoji, never color alone). whereabouts.ts has the logic.
import { useEffect, useState } from 'react'
import { api } from './api.ts'
import { placeBadge, placeSentence, type Place, type Whereabouts } from './whereabouts.ts'

const EVERY_MS = 60_000 // the server keeps Home Assistant's answer a minute; nothing pushes changes
const SHARED_MS = 5_000 // the header, the Board and a profile ask at once: one request answers them all

let shared: { at: number; answer: Promise<Whereabouts> } | null = null
function fetchShared(): Promise<Whereabouts> {
  if (!shared || Date.now() - shared.at > SHARED_MS) shared = { at: Date.now(), answer: api.getWhereabouts() }
  return shared.answer
}

/** Whereabouts, fetched again every minute and whenever `refreshTick` moves. Gone (null) when they
 * can't be read: the card and badges quietly disappear. */
export function useWhereabouts(refreshTick: number): Whereabouts | null {
  const [w, setW] = useState<Whereabouts | null>(null)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), EVERY_MS)
    return () => clearInterval(id)
  }, [])
  useEffect(() => {
    let canceled = false
    fetchShared().then(r => { if (!canceled) setW(r) }).catch(() => { if (!canceled) setW(null) })
    return () => { canceled = true }
  }, [refreshTick, tick])
  return w
}

/** The emoji alone, on the corner of a member's avatar in the header (the avatar's label says the sentence). */
export function PlaceDot({ place }: { place: Place }) {
  return <span className={`where-dot where-${place.kind}`} aria-hidden="true">{placeBadge(place).emoji}</span>
}

/** "🏠 Home", "📍 School", "🚶 Out". With `name`, a screen reader hears the whole sentence. */
export function PlaceBadge({ place, name }: { place: Place; name?: string }) {
  const b = placeBadge(place)
  return (
    <span className={`where-badge where-${place.kind}`} {...(name ? { role: 'img', 'aria-label': placeSentence(name, place) } : {})}>
      <span aria-hidden="true">{b.emoji}</span>
      <span {...(name ? { 'aria-hidden': true } : {})}>{b.word}</span>
    </span>
  )
}
