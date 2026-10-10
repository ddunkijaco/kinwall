// Whereabouts from Home Assistant (GET /api/whereabouts): where each linked member is, as a place
// name only. The badge pairs a word with an emoji, so color is never the only signal.

export type Place = { kind: 'home' } | { kind: 'place'; name: string } | { kind: 'out' }
export interface Whereabouts { members: { memberId: string; place: Place }[] }

export function placeBadge(place: Place): { emoji: string; word: string } {
  if (place.kind === 'home') return { emoji: '🏠', word: 'Home' }
  if (place.kind === 'place') return { emoji: '📍', word: place.name }
  return { emoji: '🚶', word: 'Out' }
}

/** What a screen reader says: "Alex is home", "Sam is at School", "Maya is out". */
export function placeSentence(name: string, place: Place): string {
  if (place.kind === 'home') return `${name} is home`
  if (place.kind === 'place') return `${name} is at ${place.name}`
  return `${name} is out`
}

type MemberLike = { id: string; name: string; sort: number }
export interface WhereaboutsRow<M extends MemberLike> { member: M; place: Place; badge: { emoji: string; word: string }; sentence: string }

/** The card's rows: members this device knows, in family order. None: the card hides itself. */
export function whereaboutsRows<M extends MemberLike>(w: Whereabouts | null, members: M[]): WhereaboutsRow<M>[] {
  if (!w) return []
  const place = new Map(w.members.map(x => [x.memberId, x.place]))
  return [...members].sort((a, b) => a.sort - b.sort).flatMap(member => {
    const p = place.get(member.id)
    return p ? [{ member, place: p, badge: placeBadge(p), sentence: placeSentence(member.name, p) }] : []
  })
}
