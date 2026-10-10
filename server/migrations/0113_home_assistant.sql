-- Whereabouts from Home Assistant (routes/home-assistant.ts, AGENTS.md "Whereabouts"). One row per
-- family: config is sealed with the family key ({ url, token }, or { supervisor: true } for the
-- add-on's own Home Assistant), url is the address Settings shows. shown_places is the zone ids a
-- grown-up chose to show by name (JSON list, new zones start hidden). Whereabouts themselves are
-- never stored: they're read live and kept in memory for a minute.
CREATE TABLE home_assistant (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  config TEXT NOT NULL,
  url TEXT NOT NULL,
  via TEXT NOT NULL DEFAULT 'token',   -- 'token' (URL and token) or 'supervisor' (the add-on's own)
  shown_places TEXT NOT NULL DEFAULT '[]',
  problem TEXT,                        -- 'reconnect': Home Assistant couldn't be reached or refused the token
  created_at TEXT NOT NULL
);
-- Which Home Assistant person (person.*) each member is linked to: one each way. Its own table so a
-- disconnect clears every link at once, deleting a member removes theirs.
CREATE TABLE home_assistant_people (
  member_id TEXT PRIMARY KEY REFERENCES members(id) ON DELETE CASCADE,
  person_id TEXT NOT NULL UNIQUE
);
