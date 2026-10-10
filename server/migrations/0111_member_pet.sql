-- Pets (routes/members.ts): a family member who's on the calendar and has a birthday, but never
-- chores, points, rewards, check-ins, a journal or a device of their own. Additive, no backfill.
ALTER TABLE members ADD COLUMN pet INTEGER NOT NULL DEFAULT 0;
