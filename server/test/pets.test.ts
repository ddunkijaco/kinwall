// Pets: family members on the calendar (color, events, birthday) with no chores, points, rewards,
// check-ins or devices of their own.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import type { Env } from '../src/env.ts';

const MIGRATIONS_DIR = path.join(import.meta.dirname, '..', 'migrations');
const ADMIN = 'kw_test_admin';
const today = new Date().toISOString().slice(0, 10);

function makeApp() {
  const db = openDb(':memory:');
  applyMigrations(db, MIGRATIONS_DIR);
  db.prepare("INSERT INTO settings (key, value) VALUES ('timezone', 'UTC')").run();
  const env = { DB: db, ADMIN_API_KEY: ADMIN, ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' } as unknown as Env;
  const app = createApp();
  const req = async (p: string, method = 'GET', body?: unknown, key = ADMIN) => {
    const res = await app.request(p, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' } }, env);
    return { status: res.status, json: (await res.json()) as any };
  };
  return { db, req };
}

test('members API: pet defaults false, a pet keeps a birthday but no kid settings', async () => {
  const { req } = makeApp();
  const leo = await req('/api/members', 'POST', { name: 'Leo', color: '#e57' });
  assert.equal(leo.json.pet, false);

  const biscuit = await req('/api/members', 'POST', { name: 'Biscuit', color: '#a75', avatar: '🐶', birthday: '--04-02', pet: true, needsApproval: true, tempCheck: { on: true, sleep: true, feelings: true, goal: true, showGoal: true, evening: false, eveningTime: '21:00', journal: true } });
  assert.equal(biscuit.status, 201);
  assert.deepEqual([biscuit.json.pet, biscuit.json.grownUp, biscuit.json.needsApproval, biscuit.json.birthday, biscuit.json.tempCheck.on], [true, false, false, '--04-02', false]);

  // A pet is never a grown-up, either way round.
  assert.equal((await req('/api/members', 'POST', { name: 'Rex', color: '#555', pet: true, grownUp: true })).status, 400);
  assert.equal((await req(`/api/members/${biscuit.json.id}`, 'PATCH', { grownUp: true })).status, 400);
  const alex = (await req('/api/members', 'POST', { name: 'Alex', color: '#57e', grownUp: true })).json;
  assert.equal((await req(`/api/members/${alex.id}`, 'PATCH', { pet: true })).status, 400);

  // Marking a kid as a pet (no chores yet) and back.
  const pet = await req(`/api/members/${leo.json.id}`, 'PATCH', { pet: true });
  assert.deepEqual([pet.status, pet.json.pet], [200, true]);
  const kid = await req(`/api/members/${leo.json.id}`, 'PATCH', { pet: false });
  assert.deepEqual([kid.status, kid.json.pet, kid.json.grownUp], [200, false, false]);

  const list = (await req('/api/members')).json as any[];
  assert.deepEqual(list.map((m) => [m.name, m.pet]), [['Leo', false], ['Biscuit', true], ['Alex', false]]);
});

test('a kid with chores or a device of their own is not silently turned into a pet', async () => {
  const { req } = makeApp();
  const maya = (await req('/api/members', 'POST', { name: 'Maya', color: '#e57' })).json;
  const chore = (await req('/api/chores', 'POST', { title: 'Walk the dog', rrule: 'FREQ=DAILY', memberId: maya.id })).json;
  const refused = await req(`/api/members/${maya.id}`, 'PATCH', { pet: true });
  assert.equal(refused.status, 409);
  assert.match(refused.json.error, /Maya has a chore/);
  assert.equal((await req('/api/members')).json[0].pet, false); // nothing changed

  await req(`/api/chores/${chore.id}`, 'PATCH', { memberId: null });
  const key = (await req('/api/keys', 'POST', { name: "Maya's tablet", scope: 'display' })).json;
  assert.equal((await req(`/api/keys/${key.id}`, 'PATCH', { kind: 'kid', owner: maya.id })).status, 200);
  const again = await req(`/api/members/${maya.id}`, 'PATCH', { pet: true });
  assert.equal(again.status, 409);
  assert.match(again.json.error, /device of their own/);
});

test('pets get no chores, points or devices', async () => {
  const { req } = makeApp();
  const biscuit = (await req('/api/members', 'POST', { name: 'Biscuit', color: '#a75', pet: true })).json;
  const created = await req('/api/chores', 'POST', { title: 'Sit', rrule: 'FREQ=DAILY', memberId: biscuit.id });
  assert.equal(created.status, 400);
  assert.match(created.json.error, /Biscuit is a pet/);

  const anyone = (await req('/api/chores', 'POST', { title: 'Feed Biscuit', rrule: 'FREQ=DAILY', points: 2 })).json;
  assert.equal((await req(`/api/chores/${anyone.id}`, 'PATCH', { memberId: biscuit.id })).status, 400);
  // An Anyone chore can't be credited to the pet.
  assert.equal((await req(`/api/chores/${anyone.id}/complete`, 'POST', { date: today, memberId: biscuit.id })).status, 403);

  assert.equal((await req('/api/points/awards', 'POST', { memberId: biscuit.id, points: 5 })).status, 400);

  // No paired device of their own.
  const tablet = (await req('/api/keys', 'POST', { name: 'Tablet', scope: 'display' })).json;
  const owned = await req(`/api/keys/${tablet.id}`, 'PATCH', { kind: 'kid', owner: biscuit.id });
  assert.equal(owned.status, 400);
  assert.match(owned.json.error, /Biscuit is a pet/);
});

test('export/import: pet round-trips; older files have no pets', async () => {
  const source = makeApp();
  await source.req('/api/members', 'POST', { name: 'Biscuit', color: '#a75', pet: true, birthday: '--04-02' });
  await source.req('/api/members', 'POST', { name: 'Leo', color: '#e57' });
  const file = (await source.req('/api/export')).json;
  assert.deepEqual(file.members.map((m: any) => [m.name, m.pet]), [['Biscuit', true], ['Leo', false]]);

  const target = makeApp();
  assert.equal((await target.req('/api/import', 'POST', file)).status, 200);
  assert.deepEqual((await target.req('/api/members')).json.map((m: any) => [m.name, m.pet, m.grownUp]), [['Biscuit', true, false], ['Leo', false, false]]);

  const old = makeApp();
  const legacy = { ...file, members: file.members.map(({ pet: _, ...m }: any) => m) };
  assert.equal((await old.req('/api/import', 'POST', legacy)).status, 200);
  assert.deepEqual((await old.req('/api/members')).json.map((m: any) => m.pet), [false, false]);
});
