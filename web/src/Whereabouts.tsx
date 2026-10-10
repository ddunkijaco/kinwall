// Where everyone is, from Home Assistant: the hook every screen reads it with, and the badge (a word
// and an emoji, never color alone). whereabouts.ts has the logic.
import { useEffect, useState } from 'react'
import { api } from './api.ts'
import { placeBadge, placeSentence, type Place, type Whereabouts } from './whereabouts.ts'

const EVERY_MS = 60_000 // the server keeps Home Assistant's answer a minute; nothing pushes changes

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
    api.getWhereabouts().then(r => { if (!canceled) setW(r) }).catch(() => { if (!canceled) setW(null) })
    return () => { canceled = true }
  }, [refreshTick, tick])
  return w
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
