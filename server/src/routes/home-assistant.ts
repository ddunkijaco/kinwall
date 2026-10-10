// Whereabouts from Home Assistant (docs/using/whereabouts.md, AGENTS.md "Whereabouts"). Family level,
// one row in home_assistant (migration 0113).
//
// Connect, grown-ups only, one of two ways:
// - A Home Assistant URL and a long-lived access token. Hosted takes public https addresses only;
//   self-hosted and the add-on may reach the home network (ALLOW_PRIVATE_HA_URLS, set by node.ts).
// - In the add-on, "Use this Home Assistant": the Supervisor's token and its Core API proxy. Never
//   used until a grown-up asks.
// The token is sealed with the family key and never sent back.
//
// A grown-up links members to Home Assistant people (person.* only, one each way) and picks which
// zones are shown places. GET /api/whereabouts then gives each linked member a place name: Home, a
// shown place's Home Assistant name, or Out; unknown and unavailable leave the member out. Only the
// people's states and the zones' names are kept, in memory, for a minute; never coordinates, never
// in the database, never in a log. Wall screens get nothing unless the family turns that on, and
// connected apps (MCP) get nothing at all.
import { createRoute, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { createRouter } from '../router.ts';
import type { Env } from '../env.ts';
import type { KinwallDb } from '../db.ts';
import { emit } from '../bus.ts';
import { requestKey, isConnectedApp } from '../auth.ts';
import { checkRate } from '../ratelimit.ts';
import { decryptConfig, encryptConfig } from '../crypto.ts';
import { ErrorSchema } from '../schemas.ts';
import { isSafeOutboundUrl, outboundFetch } from '../outbound.ts';

type Ctx = Context<{ Bindings: Env }>;

const AAD = 'home-assistant'; // the sealed config's associated data
const SUPERVISOR_API = 'http://supervisor/core';
const CACHE_MS = 60_000;
const TIMEOUT_MS = 10_000;
const PERSON_ID = /^person\.[a-z0-9_]+$/;
const ZONE_ID = /^zone\.[a-z0-9_]+$/;

type Row = { config: string; url: string; via: 'token' | 'supervisor'; shown_places: string; problem: string | null };
type Config = { url?: string; token?: string; supervisor?: true };
/** What's kept of Home Assistant's states: each person's state and name, each zone's name. */
type States = { people: { id: string; name: string; state: string }[]; zones: { id: string; name: string }[] };

/** Home Assistant refused or couldn't be reached; the message carries a status at most, never a body. */
class HaError extends Error {}

const load = (db: KinwallDb) => db.prepare('SELECT config, url, via, shown_places, problem FROM home_assistant').first<Row>();
const shownPlaces = (row: Row): string[] => {
  try { const v = JSON.parse(row.shown_places); return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []; } catch { return []; }
};

/** Self-hosted and the add-on may reach Home Assistant on the home network; hosted may not. */
const allowPrivate = (env: Env) => env.ALLOW_PRIVATE_HA_URLS === '1';

/** A URL a grown-up typed, as the base to call (no trailing slash), or null if it isn't allowed here. */
function baseUrl(env: Env, raw: string): string | null {
  let url: URL;
  try { url = new URL(raw.trim()); } catch { return null; }
  if (url.username || url.password || url.search || url.hash) return null;
  if (allowPrivate(env) ? url.protocol !== 'https:' && url.protocol !== 'http:' : url.protocol !== 'https:' || !isSafeOutboundUrl(url.href)) return null;
  return url.href.replace(/\/+$/, '');
}

/** GET a Home Assistant API path. Redirects are refused (one could lead anywhere). */
async function haGet(env: Env, cfg: Config, path: string): Promise<unknown> {
  const supervisor = cfg.supervisor && env.SUPERVISOR_TOKEN;
  const base = supervisor ? SUPERVISOR_API : cfg.url;
  const token = supervisor ? env.SUPERVISOR_TOKEN : cfg.token;
  if (!base || !token) throw new HaError('Home Assistant is not set up');
  // The Supervisor's proxy is the add-on's own, not a person-supplied address.
  const doFetch = supervisor ? (input: string, init: RequestInit) => fetch(input, init) : outboundFetch(env, allowPrivate(env));
  let res: Response;
  try {
    res = await doFetch(`${base}${path}`, { headers: { authorization: `Bearer ${token}`, accept: 'application/json' }, redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw new HaError('Home Assistant could not be reached');
  }
  if (!res.ok) {
    await res.body?.cancel();
    throw new HaError(`Home Assistant answered HTTP ${res.status}`);
  }
  try { return await res.json(); } catch { throw new HaError('Home Assistant sent something unreadable'); }
}

const StatusSchema = z
  .object({
    connected: z.boolean(),
    url: z.string().optional().describe("The Home Assistant address (the add-on's own: \"This Home Assistant\")"),
    via: z.enum(['token', 'supervisor']).optional(),
    problem: z.enum(['reconnect']).nullable().describe("'reconnect': Home Assistant couldn't be reached or refused the token"),
    supervisor: z.boolean().describe('Running as the Home Assistant add-on with API access: "Use this Home Assistant" is offered'),
    privateUrls: z.boolean().describe('Home-network addresses are allowed (self-hosted and the add-on)'),
    shownPlaces: z.array(z.string()).describe('Zone ids shown by name'),
  })
  .openapi('HomeAssistant');

function status(env: Env, row: Row | null): z.infer<typeof StatusSchema> {
  const base = { supervisor: !!env.SUPERVISOR_TOKEN, privateUrls: allowPrivate(env) };
  if (!row) return { connected: false, problem: null, shownPlaces: [], ...base };
  return { connected: true, url: row.url, via: row.via, problem: row.problem === 'reconnect' ? 'reconnect' : null, shownPlaces: shownPlaces(row), ...base };
}

export const homeAssistantRoutes = createRouter();
// Connected apps (MCP and other AI connectors) never see or change any of it.
homeAssistantRoutes.use('/api/home-assistant/*', async (c, next) => {
  if (await isConnectedApp(c)) return c.json({ error: "Home Assistant is set up from a grown-up's own device" }, 403);
  await next();
});
const json = <T extends z.ZodTypeAny>(schema: T) => ({ 'application/json': { schema } });

homeAssistantRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/home-assistant',
    tags: ['Home Assistant'],
    summary: "The family's Home Assistant connection (grown-ups). The token is never returned.",
    security: [{ Bearer: [] }],
    responses: { 200: { description: 'ok', content: json(StatusSchema) } },
  }),
  async (c) => c.json(status(c.env, await load(c.env.DB)), 200),
);

const ConnectSchema = z.union([
  z.object({ url: z.string().min(1).max(500), token: z.string().min(1).max(1000) }).strict(),
  z.object({ supervisor: z.literal(true) }).strict(),
]).openapi('HomeAssistantConnect');

homeAssistantRoutes.openapi(
  createRoute({
    method: 'put',
    path: '/api/home-assistant',
    tags: ['Home Assistant'],
    summary: 'Connect (or reconnect) Home Assistant (grown-ups): a URL and long-lived token, or `supervisor: true` in the add-on',
    description: 'Checked against Home Assistant before saving. Reconnecting keeps member links and shown places. Hosted accepts public https addresses only.',
    security: [{ Bearer: [] }],
    request: { body: { content: json(ConnectSchema) } },
    responses: {
      200: { description: 'connected', content: json(StatusSchema) },
      400: { description: 'address not allowed, or not the add-on', content: json(ErrorSchema) },
      429: { description: 'too many tries', content: json(ErrorSchema) },
      502: { description: "Home Assistant couldn't be reached or refused the token", content: json(ErrorSchema) },
    },
  }),
  async (c) => {
    const body = c.req.valid('json');
    let cfg: Config;
    let shown: string;
    if ('supervisor' in body) {
      if (!c.env.SUPERVISOR_TOKEN) return c.json({ error: "This isn't the Home Assistant add-on, or it can't reach Home Assistant yet. Use a URL and token." }, 400);
      cfg = { supervisor: true };
      shown = 'This Home Assistant';
    } else {
      const url = baseUrl(c.env, body.url);
      if (!url) {
        return c.json({ error: allowPrivate(c.env) ? 'Enter the Home Assistant address, like http://homeassistant.local:8123' : 'Enter a public https address for Home Assistant, like one from Nabu Casa. Home-network addresses only work when you host Kinwall yourself.' }, 400);
      }
      cfg = { url, token: body.token.trim() };
      shown = url;
    }
    if (!(await checkRate(c.env.DB, 'home-assistant-connect', 20, 3600_000))) return c.json({ error: 'Too many tries. Wait a while and try again.' }, 429);
    try {
      await haGet(c.env, cfg, '/api/');
    } catch {
      return c.json({ error: cfg.supervisor
        ? "This add-on can't reach Home Assistant yet (it needs Home Assistant API access). Connect with an address and a token instead."
        : "Couldn't connect. Check the address and the token." }, 502);
    }
    await c.env.DB
      .prepare(
        "INSERT INTO home_assistant (id, config, url, via, created_at) VALUES (1, ?, ?, ?, ?) " +
          'ON CONFLICT(id) DO UPDATE SET config = excluded.config, url = excluded.url, via = excluded.via, problem = NULL',
      )
      .bind(await encryptConfig(c.env, AAD, cfg), shown, cfg.supervisor ? 'supervisor' : 'token', new Date().toISOString())
      .run();
    forget(c.env.DB);
    emit(c, 'settings.changed', {});
    return c.json(status(c.env, await load(c.env.DB)), 200);
  },
);

homeAssistantRoutes.openapi(
  createRoute({
    method: 'delete',
    path: '/api/home-assistant',
    tags: ['Home Assistant'],
    summary: 'Disconnect Home Assistant (grown-ups): forgets the token, every member link and the shown places',
    security: [{ Bearer: [] }],
    responses: { 200: { description: 'ok', content: json(StatusSchema) } },
  }),
  async (c) => {
    await c.env.DB.batch([c.env.DB.prepare('DELETE FROM home_assistant_people'), c.env.DB.prepare('DELETE FROM home_assistant')]);
    forget(c.env.DB);
    emit(c, 'settings.changed', {});
    return c.json(status(c.env, null), 200);
  },
);

// ---- Home Assistant's states, kept for a minute per family, in memory only ----
const cache = new WeakMap<object, { at: number; states: States }>();
function forget(db: KinwallDb) { cache.delete(db); }

/** People (person.*) and zones (zone.*, not Home) from /api/states: ids, names and people's states. Nothing else is kept. */
function parseStates(raw: unknown): States {
  const out: States = { people: [], zones: [] };
  if (!Array.isArray(raw)) return out;
  for (const e of raw as { entity_id?: unknown; state?: unknown; attributes?: { friendly_name?: unknown } }[]) {
    const id = typeof e?.entity_id === 'string' ? e.entity_id : '';
    const name = typeof e?.attributes?.friendly_name === 'string' && e.attributes.friendly_name ? e.attributes.friendly_name : id;
    if (PERSON_ID.test(id)) out.people.push({ id, name, state: typeof e.state === 'string' ? e.state : 'unknown' });
    else if (ZONE_ID.test(id) && id !== 'zone.home') out.zones.push({ id, name });
  }
  const byName = (a: { name: string; id: string }, b: { name: string; id: string }) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
  out.people.sort(byName);
  out.zones.sort(byName);
  return out;
}

async function setProblem(db: KinwallDb, row: Row, problem: 'reconnect' | null): Promise<void> {
  if ((row.problem ?? null) === problem) return;
  await db.prepare('UPDATE home_assistant SET problem = ?').bind(problem).run();
  row.problem = problem;
}

/** The family's Home Assistant states, from the minute's cache or fetched. Throws HaError (and marks
 * the connection 'reconnect') when Home Assistant can't be reached; a later success clears it. */
async function states(env: Env, row: Row): Promise<States> {
  const hit = cache.get(env.DB);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.states;
  try {
    const fresh = parseStates(await haGet(env, (await decryptConfig(env, AAD, row.config)) as Config, '/api/states'));
    cache.set(env.DB, { at: Date.now(), states: fresh });
    await setProblem(env.DB, row, null);
    return fresh;
  } catch (err) {
    cache.delete(env.DB);
    // The message is ours and carries an HTTP status at most: never a body, a state or a token.
    console.warn('home assistant:', err instanceof HaError ? err.message : 'failed');
    await setProblem(env.DB, row, 'reconnect');
    throw err instanceof HaError ? err : new HaError('Home Assistant failed');
  }
}

const NOT_CONNECTED = { error: 'Home Assistant is not connected' };
const UNREACHABLE = { error: "Can't reach Home Assistant. Reconnect it in Settings." };

const PeopleSchema = z
  .object({ people: z.array(z.object({ id: z.string(), name: z.string(), memberId: z.string().nullable().describe('The member linked to this Home Assistant person') })) })
  .openapi('HomeAssistantPeople');

homeAssistantRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/home-assistant/people',
    tags: ['Home Assistant'],
    summary: 'Home Assistant people (person.*) and which member each is linked to (grown-ups). Names only, never positions.',
    security: [{ Bearer: [] }],
    responses: {
      200: { description: 'ok', content: json(PeopleSchema) },
      409: { description: 'not connected', content: json(ErrorSchema) },
      502: { description: "Home Assistant couldn't be reached", content: json(ErrorSchema) },
    },
  }),
  async (c) => {
    const row = await load(c.env.DB);
    if (!row) return c.json(NOT_CONNECTED, 409);
    let s: States;
    try { s = await states(c.env, row); } catch { return c.json(UNREACHABLE, 502); }
    const links = new Map((await c.env.DB.prepare('SELECT member_id, person_id FROM home_assistant_people').all<{ member_id: string; person_id: string }>()).results.map((l) => [l.person_id, l.member_id]));
    return c.json({ people: s.people.map((p) => ({ id: p.id, name: p.name, memberId: links.get(p.id) ?? null })) }, 200);
  },
);

const ZonesSchema = z
  .object({ zones: z.array(z.object({ id: z.string(), name: z.string(), shown: z.boolean() })) })
  .openapi('HomeAssistantZones');

homeAssistantRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/home-assistant/zones',
    tags: ['Home Assistant'],
    summary: 'Home Assistant zones other than Home, and whether each is a shown place (grown-ups). Names only, never positions.',
    security: [{ Bearer: [] }],
    responses: {
      200: { description: 'ok', content: json(ZonesSchema) },
      409: { description: 'not connected', content: json(ErrorSchema) },
      502: { description: "Home Assistant couldn't be reached", content: json(ErrorSchema) },
    },
  }),
  async (c) => {
    const row = await load(c.env.DB);
    if (!row) return c.json(NOT_CONNECTED, 409);
    let s: States;
    try { s = await states(c.env, row); } catch { return c.json(UNREACHABLE, 502); }
    const shown = new Set(shownPlaces(row));
    return c.json({ zones: s.zones.map((z) => ({ ...z, shown: shown.has(z.id) })) }, 200);
  },
);

homeAssistantRoutes.openapi(
  createRoute({
    method: 'put',
    path: '/api/home-assistant/shown-places',
    tags: ['Home Assistant'],
    summary: 'Choose which Home Assistant zones show by name (grown-ups). Home always shows; every other place reads "Out".',
    security: [{ Bearer: [] }],
    request: { body: { content: json(z.object({ zones: z.array(z.string().regex(ZONE_ID, 'must be a zone id like zone.school')).max(200) })) } },
    responses: {
      200: { description: 'saved', content: json(StatusSchema) },
      400: { description: 'not zone ids', content: json(ErrorSchema) },
      409: { description: 'not connected', content: json(ErrorSchema) },
    },
  }),
  async (c) => {
    const { zones } = c.req.valid('json');
    const res = await c.env.DB.prepare('UPDATE home_assistant SET shown_places = ?').bind(JSON.stringify([...new Set(zones)].filter((z) => z !== 'zone.home'))).run();
    if (!res.meta.changes) return c.json(NOT_CONNECTED, 409);
    emit(c, 'settings.changed', {});
    return c.json(status(c.env, await load(c.env.DB)), 200);
  },
);

export type Place = { kind: 'home' } | { kind: 'place'; name: string } | { kind: 'out' };

/** What a Home Assistant person's state shows as: Home, a shown place by its Home Assistant name, or
 * Out (not_home, or a zone that isn't shown). Unknown, unavailable or anything unreadable: null. A
 * person in a zone has that zone's name as their state. */
function placeFor(state: string, zones: States['zones'], shown: Set<string>): Place | null {
  if (state === 'home') return { kind: 'home' };
  if (state === 'unknown' || state === 'unavailable' || !state) return null;
  const zone = zones.find((z) => z.name === state);
  return zone && shown.has(zone.id) ? { kind: 'place', name: zone.name } : { kind: 'out' };
}

const PlaceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('home') }),
  z.object({ kind: z.literal('place'), name: z.string().describe("A shown place's Home Assistant name") }),
  z.object({ kind: z.literal('out') }),
]);
const WhereaboutsSchema = z
  .object({ members: z.array(z.object({ memberId: z.string(), place: PlaceSchema })).describe('Linked members with known whereabouts; anyone else is left out') })
  .openapi('Whereabouts');

/** A wall screen: a display key that isn't a member's own device. */
async function isWall(c: Ctx): Promise<boolean> {
  const key = await requestKey(c);
  return key?.scope === 'display' && (!key.owner || key.owner === 'shared');
}

homeAssistantRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/whereabouts',
    tags: ['Home Assistant'],
    summary: 'Where each linked member is right now: Home, a shown place, or Out. Read live from Home Assistant, kept a minute in memory, never stored.',
    description:
      "Wall screens get an empty list unless the family turned on `whereaboutsOnWalls`; connected apps always do. Members whose Home Assistant person is unknown or unavailable are left out, " +
      "and when Home Assistant can't be reached the list is empty (GET /api/home-assistant then shows `problem: 'reconnect'`). Never coordinates.",
    security: [{ Bearer: [] }],
    responses: { 200: { description: 'ok', content: json(WhereaboutsSchema) } },
  }),
  async (c) => {
    const none = { members: [] };
    const db = c.env.DB;
    if (await isConnectedApp(c)) return c.json(none, 200);
    if ((await isWall(c)) && (await db.prepare("SELECT value FROM settings WHERE key = 'whereaboutsOnWalls'").first<{ value: string }>())?.value !== 'true') return c.json(none, 200);
    const row = await load(db);
    if (!row) return c.json(none, 200);
    const links = (await db.prepare('SELECT member_id, person_id FROM home_assistant_people').all<{ member_id: string; person_id: string }>()).results;
    if (!links.length) return c.json(none, 200);
    let s: States;
    try { s = await states(c.env, row); } catch { return c.json(none, 200); }
    const shown = new Set(shownPlaces(row));
    const members = links.flatMap((l) => {
      const person = s.people.find((p) => p.id === l.person_id);
      const place = person && placeFor(person.state, s.zones, shown);
      return place ? [{ memberId: l.member_id, place }] : [];
    });
    return c.json({ members }, 200);
  },
);

const LinkParams = z.object({ memberId: z.string().openapi({ param: { name: 'memberId', in: 'path' } }) });

homeAssistantRoutes.openapi(
  createRoute({
    method: 'put',
    path: '/api/home-assistant/links/{memberId}',
    tags: ['Home Assistant'],
    summary: "Link a member to a Home Assistant person (grown-ups). Replaces the member's link; a Home Assistant person links to one member only.",
    security: [{ Bearer: [] }],
    request: { params: LinkParams, body: { content: json(z.object({ personId: z.string().regex(PERSON_ID, 'must be a Home Assistant person like person.maya') })) } },
    responses: {
      200: { description: 'linked', content: json(z.object({ memberId: z.string(), personId: z.string() })) },
      400: { description: 'not a Home Assistant person', content: json(ErrorSchema) },
      404: { description: 'no such member', content: json(ErrorSchema) },
      409: { description: 'not connected, or that Home Assistant person is linked to someone else', content: json(ErrorSchema) },
    },
  }),
  async (c) => {
    const { memberId } = c.req.valid('param');
    const { personId } = c.req.valid('json');
    const db = c.env.DB;
    if (!(await load(db))) return c.json(NOT_CONNECTED, 409);
    if (!(await db.prepare('SELECT 1 FROM members WHERE id = ?').bind(memberId).first())) return c.json({ error: 'No such member' }, 404);
    const taken = await db.prepare('SELECT member_id FROM home_assistant_people WHERE person_id = ? AND member_id != ?').bind(personId, memberId).first();
    if (taken) return c.json({ error: 'That Home Assistant person is linked to someone else. Unlink them first.' }, 409);
    await db.prepare('INSERT INTO home_assistant_people (member_id, person_id) VALUES (?, ?) ON CONFLICT(member_id) DO UPDATE SET person_id = excluded.person_id').bind(memberId, personId).run();
    emit(c, 'settings.changed', {});
    return c.json({ memberId, personId }, 200);
  },
);

homeAssistantRoutes.openapi(
  createRoute({
    method: 'delete',
    path: '/api/home-assistant/links/{memberId}',
    tags: ['Home Assistant'],
    summary: 'Unlink a member from their Home Assistant person (grown-ups)',
    security: [{ Bearer: [] }],
    request: { params: LinkParams },
    responses: { 200: { description: 'unlinked', content: json(z.object({ ok: z.boolean() })) } },
  }),
  async (c) => {
    const { memberId } = c.req.valid('param');
    await c.env.DB.prepare('DELETE FROM home_assistant_people WHERE member_id = ?').bind(memberId).run();
    emit(c, 'settings.changed', {});
    return c.json({ ok: true }, 200);
  },
);
