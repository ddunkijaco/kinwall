// Whereabouts from Home Assistant (routes/home-assistant.ts, AGENTS.md "Whereabouts"): a grown-up
// connects the family's Home Assistant, links members to Home Assistant people and picks shown
// places; everyone else reads only a place name (Home, a shown place, or Out). Home Assistant is
// faked; nothing here reaches the network.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import { createApiKey } from '../src/auth.ts';
import type { Env } from '../src/env.ts';

const MIGRATIONS = path.join(import.meta.dirname, '..', 'migrations');
const ADMIN = 'kw_test_admin';
const KEY = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
const HA_URL = 'https://ha.example.com';
const TOKEN = 'FAKE-HA-LONG-LIVED-TOKEN';
const SUPERVISOR = 'FAKE-SUPERVISOR-TOKEN';
const APP = { 'X-Kinwall-Source': 'mcp' };
// Zone names that must never reach a log line.
const SCHOOL = 'zz-Lincoln School';
const SECRET_PLACE = 'zz-Dentist';

type Person = { id: string; name: string; state: string };

/** A fake Home Assistant REST API at HA_URL (and the Supervisor's proxy): /api/ answers when the
 * bearer token is right; /api/states lists people and zones, zones with coordinates the way
 * Home Assistant sends them. */
function fakeHa() {
  const h = {
    calls: [] as { url: string; auth: string | null }[],
    down: false, // unreachable
    status: 200, // what /api/states answers when not down
    people: [
      { id: 'person.alex', name: 'Alex', state: 'home' },
      { id: 'person.sam', name: 'Sam', state: SCHOOL },
      { id: 'person.maya', name: 'Maya', state: 'not_home' },
      { id: 'person.leo', name: 'Leo', state: 'unknown' },
    ] as Person[],
    zones: [
      { id: 'zone.home', name: 'Home' },
      { id: 'zone.school', name: SCHOOL },
      { id: 'zone.dentist', name: SECRET_PLACE },
    ],
  };
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const fetch = (async (input: unknown, init: RequestInit = {}) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    const auth = new Headers(init.headers).get('authorization');
    h.calls.push({ url: url.href, auth });
    if (h.down) throw new TypeError('fetch failed');
    const base = url.origin === 'http://supervisor' ? 'http://supervisor/core' : url.origin;
    const want = base === 'http://supervisor/core' ? SUPERVISOR : TOKEN;
    if (auth !== `Bearer ${want}`) return json({ message: 'Unauthorized' }, 401);
    const p = url.href.slice(base.length);
    if (p === '/api/') return json({ message: 'API running.' });
    if (p === '/api/states') {
      if (h.status !== 200) return json({ message: 'nope' }, h.status);
      return json([
        ...h.people.map((x) => ({ entity_id: x.id, state: x.state, attributes: { friendly_name: x.name, latitude: 47.61, longitude: -122.33, gps_accuracy: 12, source: 'device_tracker.phone' } })),
        ...h.zones.map((z) => ({ entity_id: z.id, state: '1', attributes: { friendly_name: z.name, latitude: 47.6, longitude: -122.3, radius: 100 } })),
        { entity_id: 'device_tracker.phone', state: 'home', attributes: { latitude: 47.61, longitude: -122.33 } },
      ]);
    }
    return json({ message: 'Not found' }, 404);
  }) as typeof globalThis.fetch;
  return { h, fetch };
}

async function setup(opts: { extra?: Partial<Env> } = {}) {
  const db = openDb(':memory:');
  applyMigrations(db, MIGRATIONS);
  const env = { DB: db as unknown as D1Database, ADMIN_API_KEY: ADMIN, ENCRYPTION_KEY: KEY, ...opts.extra } as Env;
  const raw = (p: string, method = 'GET', body?: unknown, key = ADMIN, headers: Record<string, string> = {}) =>
    createApp().request(p, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...headers } }, env);
  const req = async (p: string, method = 'GET', body?: unknown, key = ADMIN, headers: Record<string, string> = {}) => {
    const res = await raw(p, method, body, key, headers);
    const text = await res.text();
    return { status: res.status, text, json: (text ? JSON.parse(text) : null) as any };
  };
  const member = async (name: string, grownUp = false) => (await req('/api/members', 'POST', { name, color: '#7ED9A6', ...(grownUp ? { grownUp } : {}) })).json.id as string;
  const key = async (owner: string | null, scope: 'admin' | 'display' = 'display') => (await createApiKey(db as never, `k-${owner ?? scope}`, scope, { owner })).key;
  const rows = (q: string) => db.prepare(q).all<Record<string, any>>().results;
  return { env, db, req, member, key, rows };
}

/** Runs `fn` with Home Assistant faked and every console line captured. */
async function withHa<T>(fake: ReturnType<typeof fakeHa>, fn: () => Promise<T>, logs: string[] = []): Promise<T> {
  const realFetch = globalThis.fetch;
  const real = { log: console.log, warn: console.warn, error: console.error, info: console.info, debug: console.debug };
  const capture = (...a: unknown[]) => { logs.push(a.map((x) => (x instanceof Error ? `${x.message} ${x.stack}` : typeof x === 'string' ? x : JSON.stringify(x))).join(' ')); };
  globalThis.fetch = fake.fetch;
  Object.assign(console, { log: capture, warn: capture, error: capture, info: capture, debug: capture });
  try {
    return await fn();
  } finally {
    globalThis.fetch = realFetch;
    Object.assign(console, real);
  }
}

test('a grown-up connects with a URL and token; the token never comes back', async () => {
  const t = await setup();
  const fake = fakeHa();
  await withHa(fake, async () => {
    assert.deepEqual((await t.req('/api/home-assistant')).json.connected, false);
    const res = await t.req('/api/home-assistant', 'PUT', { url: `${HA_URL}/`, token: TOKEN });
    assert.equal(res.status, 200, res.text);
    assert.equal(res.json.connected, true);
    assert.equal(res.json.url, HA_URL);
    assert.equal(res.json.problem, null);
    assert.ok(!res.text.includes(TOKEN));
    const status = await t.req('/api/home-assistant');
    assert.equal(status.json.connected, true);
    assert.ok(!status.text.includes(TOKEN));
    assert.ok(!JSON.stringify(t.rows('SELECT * FROM home_assistant')).includes(TOKEN), 'sealed at rest');
  });
});

test('a wrong token or an unreachable Home Assistant is refused and nothing is saved', async () => {
  const t = await setup();
  const fake = fakeHa();
  await withHa(fake, async () => {
    const bad = await t.req('/api/home-assistant', 'PUT', { url: HA_URL, token: 'FAKE-WRONG-TOKEN' });
    assert.equal(bad.status, 502);
    fake.h.down = true;
    assert.equal((await t.req('/api/home-assistant', 'PUT', { url: HA_URL, token: TOKEN })).status, 502);
    assert.equal(t.rows('SELECT * FROM home_assistant').length, 0);
  });
});

test('hosted takes public https addresses only; self-hosted may reach the home network', async () => {
  const fake = fakeHa();
  const hosted = await setup();
  await withHa(fake, async () => {
    for (const url of ['http://ha.example.com', 'https://192.168.1.10:8123', 'https://10.0.0.5', 'https://homeassistant.local:8123', 'https://localhost:8123', 'https://[fd00::1]', 'https://169.254.1.1', 'ftp://ha.example.com']) {
      const res = await hosted.req('/api/home-assistant', 'PUT', { url, token: TOKEN });
      assert.equal(res.status, 400, url);
    }
    assert.equal(fake.h.calls.length, 0, 'never called');
    assert.equal((await hosted.req('/api/home-assistant')).json.privateUrls, false);
  });
  const selfHosted = await setup({ extra: { ALLOW_PRIVATE_HA_URLS: '1' } });
  const lan = fakeHa();
  // The LAN Home Assistant answers like the public one.
  const lanFetch = lan.fetch;
  lan.fetch = ((input: unknown, init?: RequestInit) => lanFetch(String(input).replace('http://192.168.1.10:8123', HA_URL), init)) as typeof fetch;
  await withHa(lan, async () => {
    const res = await selfHosted.req('/api/home-assistant', 'PUT', { url: 'http://192.168.1.10:8123', token: TOKEN });
    assert.equal(res.status, 200, res.text);
    assert.equal(res.json.url, 'http://192.168.1.10:8123');
  });
});

test('only a grown-up sees or changes the connection', async () => {
  const t = await setup();
  const maya = await t.member('Maya');
  const fake = fakeHa();
  await withHa(fake, async () => {
    for (const k of [await t.key(null), await t.key('shared'), await t.key(maya)]) {
      assert.equal((await t.req('/api/home-assistant', 'GET', undefined, k)).status, 403);
      assert.equal((await t.req('/api/home-assistant', 'PUT', { url: HA_URL, token: TOKEN }, k)).status, 403);
      assert.equal((await t.req('/api/home-assistant', 'DELETE', undefined, k)).status, 403);
    }
    assert.equal(fake.h.calls.length, 0);
  });
});

test('the add-on connects to its own Home Assistant only when a grown-up asks', async () => {
  const fake = fakeHa();
  const plain = await setup();
  await withHa(fake, async () => {
    assert.equal((await plain.req('/api/home-assistant')).json.supervisor, false);
    assert.equal((await plain.req('/api/home-assistant', 'PUT', { supervisor: true })).status, 400);
  });
  const addon = await setup({ extra: { SUPERVISOR_TOKEN: SUPERVISOR, ALLOW_PRIVATE_HA_URLS: '1' } });
  await withHa(fake, async () => {
    const before = await addon.req('/api/home-assistant');
    assert.equal(before.json.supervisor, true);
    assert.equal(before.json.connected, false);
    assert.equal(fake.h.calls.length, 0, 'never on its own');
    const res = await addon.req('/api/home-assistant', 'PUT', { supervisor: true });
    assert.equal(res.status, 200, res.text);
    assert.equal(res.json.via, 'supervisor');
    assert.ok(fake.h.calls.every((x) => x.url.startsWith('http://supervisor/core/api/')));
    assert.ok(!res.text.includes(SUPERVISOR));
  });
});

async function connectedSetup(opts: { extra?: Partial<Env> } = {}) {
  const t = await setup(opts);
  const fake = fakeHa();
  const ids = { alex: await t.member('Alex', true), sam: await t.member('Sam', true), maya: await t.member('Maya'), leo: await t.member('Leo') };
  await withHa(fake, async () => {
    assert.equal((await t.req('/api/home-assistant', 'PUT', { url: HA_URL, token: TOKEN })).status, 200);
  });
  return { ...t, fake, ids };
}

test('a grown-up links members to Home Assistant people, one each way', async () => {
  const t = await connectedSetup();
  await withHa(t.fake, async () => {
    const people = await t.req('/api/home-assistant/people');
    assert.equal(people.status, 200, people.text);
    assert.deepEqual(people.json.people.map((p: any) => [p.id, p.name, p.memberId]), [
      ['person.alex', 'Alex', null], ['person.leo', 'Leo', null], ['person.maya', 'Maya', null], ['person.sam', 'Sam', null],
    ]);
    assert.ok(!people.text.includes('47.6'), 'no coordinates');
    assert.equal((await t.req(`/api/home-assistant/links/${t.ids.maya}`, 'PUT', { personId: 'person.maya' })).status, 200);
    assert.equal((await t.req(`/api/home-assistant/links/${t.ids.leo}`, 'PUT', { personId: 'device_tracker.phone' })).status, 400, 'people only');
    assert.equal((await t.req(`/api/home-assistant/links/${t.ids.leo}`, 'PUT', { personId: 'person.maya' })).status, 409, 'already linked to Maya');
    assert.equal((await t.req('/api/home-assistant/links/nobody', 'PUT', { personId: 'person.leo' })).status, 404);
    // Moving Maya to another Home Assistant person replaces her link.
    assert.equal((await t.req(`/api/home-assistant/links/${t.ids.maya}`, 'PUT', { personId: 'person.leo' })).status, 200);
    assert.equal((await t.req(`/api/home-assistant/links/${t.ids.leo}`, 'PUT', { personId: 'person.maya' })).status, 200);
    const after = await t.req('/api/home-assistant/people');
    assert.equal(after.json.people.find((p: any) => p.id === 'person.leo').memberId, t.ids.maya);
    assert.equal(after.json.people.find((p: any) => p.id === 'person.maya').memberId, t.ids.leo);
    assert.equal((await t.req(`/api/home-assistant/links/${t.ids.leo}`, 'DELETE')).status, 200);
    assert.equal((await t.req('/api/home-assistant/people')).json.people.find((p: any) => p.id === 'person.maya').memberId, null);
  });
});

test('kids, wall screens and connected apps can not link or list people', async () => {
  const t = await connectedSetup();
  await withHa(t.fake, async () => {
    for (const k of [await t.key(null), await t.key(t.ids.maya)]) {
      assert.equal((await t.req('/api/home-assistant/people', 'GET', undefined, k)).status, 403);
      assert.equal((await t.req('/api/home-assistant/zones', 'GET', undefined, k)).status, 403);
      assert.equal((await t.req(`/api/home-assistant/links/${t.ids.maya}`, 'PUT', { personId: 'person.maya' }, k)).status, 403);
      assert.equal((await t.req('/api/home-assistant/shown-places', 'PUT', { zones: ['zone.school'] }, k)).status, 403);
    }
    assert.equal((await t.req(`/api/home-assistant/links/${t.ids.maya}`, 'PUT', { personId: 'person.maya' }, ADMIN, APP)).status, 403);
  });
});

test('a grown-up picks shown places; new zones start hidden', async () => {
  const t = await connectedSetup();
  await withHa(t.fake, async () => {
    const zones = await t.req('/api/home-assistant/zones');
    assert.equal(zones.status, 200, zones.text);
    assert.deepEqual(zones.json.zones.map((z: any) => [z.id, z.name, z.shown]), [['zone.dentist', SECRET_PLACE, false], ['zone.school', SCHOOL, false]], 'Home is always shown, so not listed');
    assert.ok(!zones.text.includes('47.6'), 'no coordinates');
    const saved = await t.req('/api/home-assistant/shown-places', 'PUT', { zones: ['zone.school'] });
    assert.equal(saved.status, 200, saved.text);
    assert.deepEqual((await t.req('/api/home-assistant')).json.shownPlaces, ['zone.school']);
    assert.equal((await t.req('/api/home-assistant/zones')).json.zones.find((z: any) => z.id === 'zone.school').shown, true);
    assert.equal((await t.req('/api/home-assistant/shown-places', 'PUT', { zones: ['person.alex'] })).status, 400);
  });
});

test('reconnecting keeps links and shown places; disconnecting and deleting a member clear them', async () => {
  const t = await connectedSetup();
  await withHa(t.fake, async () => {
    await t.req(`/api/home-assistant/links/${t.ids.maya}`, 'PUT', { personId: 'person.maya' });
    await t.req(`/api/home-assistant/links/${t.ids.leo}`, 'PUT', { personId: 'person.leo' });
    await t.req('/api/home-assistant/shown-places', 'PUT', { zones: ['zone.school'] });
    assert.equal((await t.req('/api/home-assistant', 'PUT', { url: HA_URL, token: TOKEN })).status, 200);
    assert.deepEqual((await t.req('/api/home-assistant')).json.shownPlaces, ['zone.school']);
    assert.equal(t.rows('SELECT * FROM home_assistant_people').length, 2);
    assert.equal((await t.req(`/api/members/${t.ids.leo}`, 'DELETE')).status < 300, true);
    assert.equal(t.rows('SELECT * FROM home_assistant_people').length, 1);
    assert.equal((await t.req('/api/home-assistant', 'DELETE')).status, 200);
    assert.equal(t.rows('SELECT * FROM home_assistant').length, 0);
    assert.equal(t.rows('SELECT * FROM home_assistant_people').length, 0);
    assert.equal((await t.req('/api/home-assistant/people')).status, 409, 'not connected');
  });
});

/** Connected, everyone linked, School a shown place, the Dentist not. */
async function linkedSetup(opts: { extra?: Partial<Env> } = {}) {
  const t = await connectedSetup(opts);
  await withHa(t.fake, async () => {
    for (const [who, id] of Object.entries(t.ids)) assert.equal((await t.req(`/api/home-assistant/links/${id}`, 'PUT', { personId: `person.${who}` })).status, 200);
    await t.req('/api/home-assistant/shown-places', 'PUT', { zones: ['zone.school'] });
  });
  const where = async (key = ADMIN, headers: Record<string, string> = {}) => {
    const res = await t.req('/api/whereabouts', 'GET', undefined, key, headers);
    assert.equal(res.status, 200, res.text);
    return { text: res.text, byMember: Object.fromEntries(res.json.members.map((m: any) => [m.memberId, m.place])) as Record<string, any> };
  };
  return { ...t, where };
}

test('whereabouts read Home, a shown place or Out; unknown leaves the member out', async () => {
  const t = await linkedSetup();
  await withHa(t.fake, async () => {
    const w = await t.where();
    assert.deepEqual(w.byMember, {
      [t.ids.alex]: { kind: 'home' },
      [t.ids.sam]: { kind: 'place', name: SCHOOL },
      [t.ids.maya]: { kind: 'out' },
    });
    assert.ok(!/47\.6|122\.3|person\.|zone\.|gps|last/i.test(w.text), 'only place names');
  });
  // A zone that isn't shown reads Out; an unlinked member has no whereabouts.
  t.fake.h.people[2].state = SECRET_PLACE;
  await withHa(t.fake, async () => {
    await t.req('/api/home-assistant', 'PUT', { url: HA_URL, token: TOKEN }); // fresh read
    await t.req(`/api/home-assistant/links/${t.ids.sam}`, 'DELETE');
    const w = await t.where();
    assert.deepEqual(w.byMember[t.ids.maya], { kind: 'out' });
    assert.equal(w.byMember[t.ids.sam], undefined);
    assert.ok(!w.text.includes(SECRET_PLACE));
  });
});

test('whereabouts are read at most once a minute and never stored', async () => {
  mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-10T12:00:00Z') });
  try {
    const t = await linkedSetup();
    await withHa(t.fake, async () => {
      await t.where();
      const calls = () => t.fake.h.calls.filter((c) => c.url.endsWith('/api/states')).length;
      const before = calls();
      t.fake.h.people[0].state = 'not_home';
      mock.timers.tick(30_000);
      assert.equal((await t.where()).byMember[t.ids.alex].kind, 'home', 'from the minute cache');
      assert.equal(calls(), before);
      mock.timers.tick(31_000);
      assert.equal((await t.where()).byMember[t.ids.alex].kind, 'out');
      assert.equal(calls(), before + 1);
      const everything = JSON.stringify(t.rows("SELECT name FROM sqlite_master WHERE type = 'table'").flatMap((r) => t.rows(`SELECT * FROM "${r.name}"`)));
      assert.ok(!everything.includes(SCHOOL), 'no place names stored');
    });
  } finally {
    mock.timers.reset();
  }
});

test('when Home Assistant can not be reached whereabouts go quiet and grown-ups are told to reconnect', async () => {
  const t = await linkedSetup();
  await withHa(t.fake, async () => {
    await t.req('/api/home-assistant', 'PUT', { url: HA_URL, token: TOKEN }); // clears the cache
    t.fake.h.down = true;
    assert.deepEqual((await t.where()).byMember, {});
    assert.equal((await t.req('/api/home-assistant')).json.problem, 'reconnect');
    t.fake.h.down = false;
    t.fake.h.status = 401;
    assert.deepEqual((await t.where()).byMember, {});
    t.fake.h.status = 200;
    assert.equal(Object.keys((await t.where()).byMember).length, 3);
    assert.equal((await t.req('/api/home-assistant')).json.problem, null, 'cleared by the next success');
  });
});

test('wall screens get nothing until the family turns it on; family devices always do', async () => {
  const t = await linkedSetup();
  await withHa(t.fake, async () => {
    const wall = await t.key(null);
    const shared = await t.key('shared');
    const mayas = await t.key(t.ids.maya);
    assert.deepEqual((await t.where(wall)).byMember, {});
    assert.deepEqual((await t.where(shared)).byMember, {});
    assert.equal(Object.keys((await t.where(mayas)).byMember).length, 3);
    assert.equal((await t.req('/api/settings')).json.whereaboutsOnWalls, false);
    assert.equal((await t.req('/api/settings', 'PATCH', { whereaboutsOnWalls: true })).json.whereaboutsOnWalls, true);
    assert.equal(Object.keys((await t.where(wall)).byMember).length, 3);
    assert.equal(Object.keys((await t.where(shared)).byMember).length, 3);
    assert.equal((await t.req('/api/settings', 'PATCH', { whereaboutsOnWalls: false }, wall)).status, 403, 'a wall can not turn it on');
    assert.equal((await t.req('/api/settings', 'PATCH', { whereaboutsOnWalls: false }, ADMIN, APP)).status, 403, 'nor a connected app');
  });
});

test('connected apps never get whereabouts', async () => {
  const t = await linkedSetup();
  await withHa(t.fake, async () => {
    const res = await t.req('/api/whereabouts', 'GET', undefined, ADMIN, APP);
    assert.ok(res.status === 403 || (res.status === 200 && res.json.members.length === 0), res.text);
  });
});

test('nothing connected: no whereabouts and no call to Home Assistant', async () => {
  const t = await setup();
  const fake = fakeHa();
  await withHa(fake, async () => {
    const res = await t.req('/api/whereabouts');
    assert.equal(res.status, 200);
    assert.deepEqual(res.json.members, []);
    assert.equal(fake.h.calls.length, 0);
  });
});

test('Home Assistant responses, place names and tokens never reach a log', async () => {
  const logs: string[] = [];
  const t = await linkedSetup();
  await withHa(t.fake, async () => {
    await t.req('/api/home-assistant', 'PUT', { url: HA_URL, token: TOKEN });
    await t.where();
    await t.req('/api/home-assistant/people');
    await t.req('/api/home-assistant/zones');
    await t.req('/api/home-assistant', 'PUT', { url: HA_URL, token: 'FAKE-WRONG-TOKEN' });
    t.fake.h.status = 500;
    await t.req('/api/home-assistant', 'PUT', { url: HA_URL, token: TOKEN });
    await t.where();
    t.fake.h.down = true;
    await t.req('/api/home-assistant/people');
    await t.where();
  }, logs);
  const all = logs.join('\n');
  for (const secret of [SCHOOL, SECRET_PLACE, TOKEN, 'FAKE-WRONG-TOKEN', 'not_home', 'person.', 'API running', '47.6', 'Unauthorized']) assert.ok(!all.includes(secret), `logged ${secret}`);
});

test('the export leaves out the connection, the links and whereabouts', async () => {
  const t = await linkedSetup();
  await withHa(t.fake, () => t.where());
  const res = await t.req('/api/export');
  assert.equal(res.status, 200, res.text);
  for (const s of [HA_URL, 'person.', 'zone.', SCHOOL, TOKEN]) assert.ok(!res.text.includes(s), `exported ${s}`);
});

test('snapshots leave whereabouts out', async () => {
  const t = await linkedSetup();
  await withHa(t.fake, async () => {
    await t.where();
    const res = await t.req(`/api/snapshot?member=${t.ids.sam}`);
    assert.equal(res.status, 200, res.text);
    for (const s of [SCHOOL, 'whereabouts', '"place"']) assert.ok(!res.text.includes(s), `snapshot has ${s}`);
  });
});

test('a family Board preset can place the "Where everyone is" card', async () => {
  const t = await setup();
  const preset = { id: 'p_hall', name: 'Hall', layout: { tiles: false, columns: [[{ id: 'clock', size: 's', density: 'normal' }, { id: 'whereabouts', size: 'm', density: 'big' }]] } };
  const res = await t.req('/api/settings', 'PATCH', { boardPresets: [preset] });
  assert.equal(res.status, 200, res.text);
  assert.equal(res.json.boardPresets[0].layout.columns[0][1].id, 'whereabouts');
});
