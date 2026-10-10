# Kinwall

A shared family calendar and household board for a wall display, tablets and phones.

## Language

### Family

**Member**:
One person in the family, a grown-up or a kid, shown with their own color and avatar.
_Avoid_: User, profile, person

**Grown-up**:
A member with parent access, who can change settings and do parent-only actions.
_Avoid_: Admin, parent, owner

**Wall screen**:
A screen on the wall that everyone in the room can see, visitors included.
_Avoid_: Display key, kiosk

### Whereabouts

**Whereabouts**:
The place a member is right now, as Home Assistant reports it, given only as a place name and never as a position on a map.
_Avoid_: Location, presence, tracking

**Home Assistant person**:
The person in the family's Home Assistant that a member is linked to, the only source of that member's whereabouts.
_Avoid_: Device tracker, entity

**Shown place**:
A Home Assistant zone that a grown-up chose to show by name. Home is always a shown place.
_Avoid_: Visible zone, allowed zone

**Out**:
What a member's whereabouts read when they're outside every shown place, whether they're in a zone that isn't shown or in no zone at all.
_Avoid_: Away, not home, unknown
