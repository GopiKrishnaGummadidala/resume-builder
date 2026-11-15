-- Accounts, sessions and each user's documents.

CREATE TABLE IF NOT EXISTS users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL,
  password_hash text NOT NULL,                 -- scrypt$N$r$p$salt$key (server/passwords.js)
  created_at    timestamptz NOT NULL DEFAULT now()
);
-- One account per address, whatever its capitalisation.
CREATE UNIQUE INDEX IF NOT EXISTS users_email_key ON users (lower(email));

CREATE TABLE IF NOT EXISTS sessions (
  token_hash bytea PRIMARY KEY,                -- SHA-256 of the cookie value; the token itself is never stored
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id);

-- A CV or cover letter as the app's JSON document. Which copy wins follows the browser's rules
-- (js/store.js mergeStates): the larger updatedAt wins, and a deletion wins over older edits.
CREATE TABLE IF NOT EXISTS documents (
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  id         text NOT NULL,
  data       jsonb,                            -- NULL once the document is deleted
  updated_at bigint NOT NULL,                  -- the document's updatedAt, in ms
  deleted_at bigint,                           -- when it was deleted, in ms (a tombstone)
  PRIMARY KEY (user_id, id)
);
