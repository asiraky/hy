// Package store is the durable event log. It is the single source of truth;
// projections and snapshots are derived and may be rebuilt at any time.
package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"sync"

	_ "modernc.org/sqlite"

	"github.com/asiraky/hy/internal/proto"
)

const schema = `
PRAGMA journal_mode=WAL;
PRAGMA busy_timeout=5000;
PRAGMA synchronous=NORMAL;

CREATE TABLE IF NOT EXISTS sessions (
  id            TEXT PRIMARY KEY,
  cwd           TEXT NOT NULL,
  harness       TEXT NOT NULL,
  title         TEXT NOT NULL DEFAULT '',
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  head_seq      INTEGER NOT NULL DEFAULT 0,
  phase         TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  session_id    TEXT NOT NULL,
  seq           INTEGER NOT NULL,
  type          TEXT NOT NULL,
  payload       BLOB NOT NULL,
  created_at    INTEGER NOT NULL,
  PRIMARY KEY (session_id, seq)
);

CREATE TABLE IF NOT EXISTS snapshots (
  session_id    TEXT NOT NULL,
  seq           INTEGER NOT NULL,
  state         BLOB NOT NULL,
  PRIMARY KEY (session_id, seq)
);

CREATE TABLE IF NOT EXISTS commands (
  command_id    TEXT PRIMARY KEY,
  session_id    TEXT NOT NULL,
  result        BLOB,
  created_at    INTEGER NOT NULL
);
`

// SessionMeta is the row-level view of a session, enough for a session list.
type SessionMeta struct {
	ID        string `json:"id"`
	Cwd       string `json:"cwd"`
	Harness   string `json:"harness"`
	Title     string `json:"title"`
	CreatedAt int64  `json:"createdAt"`
	UpdatedAt int64  `json:"updatedAt"`
	HeadSeq   int64  `json:"headSeq"`
	Phase     string `json:"phase"`
}

// Store wraps the database. Writes are serialised through a single mutex-held
// connection; reads use the pool. The session actor is the only writer per
// session in-process, and this guards the cross-session case.
type Store struct {
	db *sql.DB
	mu sync.Mutex
}

func Open(path string) (*Store, error) {
	db, err := sql.Open("sqlite", path+"?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)")
	if err != nil {
		return nil, err
	}
	if _, err := db.Exec(schema); err != nil {
		return nil, fmt.Errorf("apply schema: %w", err)
	}
	s := &Store{db: db}
	if err := s.initAuth(); err != nil {
		return nil, fmt.Errorf("apply auth schema: %w", err)
	}
	return s, nil
}

func (s *Store) Close() error { return s.db.Close() }

func (s *Store) CreateSession(ctx context.Context, m SessionMeta) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO sessions (id, cwd, harness, title, created_at, updated_at, head_seq, phase)
		 VALUES (?,?,?,?,?,?,0,?)`,
		m.ID, m.Cwd, m.Harness, m.Title, m.CreatedAt, m.UpdatedAt, m.Phase)
	return err
}

// Append writes one event at seq = head_seq+1 and bumps head_seq in the same
// transaction. Returns the sequenced event.
func (s *Store) Append(ctx context.Context, sessionID string, em proto.Emission) (proto.Event, error) {
	payload, err := json.Marshal(em.Payload)
	if err != nil {
		return proto.Event{}, err
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return proto.Event{}, err
	}
	defer tx.Rollback()

	var head int64
	if err := tx.QueryRowContext(ctx, `SELECT head_seq FROM sessions WHERE id = ?`, sessionID).Scan(&head); err != nil {
		return proto.Event{}, fmt.Errorf("load head_seq for %s: %w", sessionID, err)
	}
	seq := head + 1
	ts := proto.NowMillis()

	if _, err := tx.ExecContext(ctx,
		`INSERT INTO events (session_id, seq, type, payload, created_at) VALUES (?,?,?,?,?)`,
		sessionID, seq, em.Type, payload, ts); err != nil {
		return proto.Event{}, err
	}
	if _, err := tx.ExecContext(ctx,
		`UPDATE sessions SET head_seq = ?, updated_at = ? WHERE id = ?`, seq, ts, sessionID); err != nil {
		return proto.Event{}, err
	}
	if err := tx.Commit(); err != nil {
		return proto.Event{}, err
	}

	return proto.Event{SessionID: sessionID, Seq: seq, Timestamp: ts, Type: em.Type, Payload: payload}, nil
}

// SetPhase records idle | turn | closing.
func (s *Store) SetPhase(ctx context.Context, sessionID, phase string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	_, err := s.db.ExecContext(ctx, `UPDATE sessions SET phase = ?, updated_at = ? WHERE id = ?`,
		phase, proto.NowMillis(), sessionID)
	return err
}

func (s *Store) SetTitle(ctx context.Context, sessionID, title string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	_, err := s.db.ExecContext(ctx, `UPDATE sessions SET title = ? WHERE id = ? AND title = ''`, title, sessionID)
	return err
}

// ReadEvents returns events in (afterSeq, afterSeq+limit], ordered by seq.
func (s *Store) ReadEvents(ctx context.Context, sessionID string, afterSeq int64, limit int) ([]proto.Event, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT seq, type, payload, created_at FROM events
		 WHERE session_id = ? AND seq > ? ORDER BY seq ASC LIMIT ?`, sessionID, afterSeq, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []proto.Event
	for rows.Next() {
		ev := proto.Event{SessionID: sessionID}
		var payload []byte
		if err := rows.Scan(&ev.Seq, &ev.Type, &payload, &ev.Timestamp); err != nil {
			return nil, err
		}
		ev.Payload = json.RawMessage(payload)
		out = append(out, ev)
	}
	return out, rows.Err()
}

func (s *Store) Session(ctx context.Context, id string) (SessionMeta, error) {
	var m SessionMeta
	err := s.db.QueryRowContext(ctx,
		`SELECT id, cwd, harness, title, created_at, updated_at, head_seq, phase FROM sessions WHERE id = ?`, id).
		Scan(&m.ID, &m.Cwd, &m.Harness, &m.Title, &m.CreatedAt, &m.UpdatedAt, &m.HeadSeq, &m.Phase)
	if errors.Is(err, sql.ErrNoRows) {
		return m, ErrNotFound
	}
	return m, err
}

func (s *Store) ListSessions(ctx context.Context) ([]SessionMeta, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT id, cwd, harness, title, created_at, updated_at, head_seq, phase
		 FROM sessions ORDER BY updated_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []SessionMeta{}
	for rows.Next() {
		var m SessionMeta
		if err := rows.Scan(&m.ID, &m.Cwd, &m.Harness, &m.Title, &m.CreatedAt, &m.UpdatedAt, &m.HeadSeq, &m.Phase); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

func (s *Store) DeleteSession(ctx context.Context, id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, q := range []string{
		`DELETE FROM events WHERE session_id = ?`,
		`DELETE FROM snapshots WHERE session_id = ?`,
		`DELETE FROM commands WHERE session_id = ?`,
		`DELETE FROM sessions WHERE id = ?`,
	} {
		if _, err := tx.ExecContext(ctx, q, id); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// ---- Snapshots (a cache; deleting the table changes only latency) ----

func (s *Store) PutSnapshot(ctx context.Context, sessionID string, seq int64, state any) error {
	blob, err := json.Marshal(state)
	if err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, err := s.db.ExecContext(ctx,
		`INSERT OR REPLACE INTO snapshots (session_id, seq, state) VALUES (?,?,?)`, sessionID, seq, blob); err != nil {
		return err
	}
	// Keep only the newest snapshot per session.
	_, err = s.db.ExecContext(ctx, `DELETE FROM snapshots WHERE session_id = ? AND seq < ?`, sessionID, seq)
	return err
}

// LatestSnapshot returns the newest snapshot, or (0, nil, nil) if none exists.
func (s *Store) LatestSnapshot(ctx context.Context, sessionID string) (int64, json.RawMessage, error) {
	var seq int64
	var blob []byte
	err := s.db.QueryRowContext(ctx,
		`SELECT seq, state FROM snapshots WHERE session_id = ? ORDER BY seq DESC LIMIT 1`, sessionID).Scan(&seq, &blob)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, nil, nil
	}
	if err != nil {
		return 0, nil, err
	}
	return seq, json.RawMessage(blob), nil
}

// ---- Command idempotency ----

var ErrNotFound = errors.New("not found")
var ErrCommandInProgress = errors.New("command is still in progress")

// ClaimCommand records a command id. A NULL result is an in-progress claim;
// completed commands always carry their JSON result. This distinction is what
// keeps a concurrent retry from mistaking a placeholder for a successful null
// result.
func (s *Store) ClaimCommand(ctx context.Context, commandID, sessionID string) (json.RawMessage, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	var existingSession string
	var result []byte
	err := s.db.QueryRowContext(ctx, `SELECT session_id, result FROM commands WHERE command_id = ?`, commandID).
		Scan(&existingSession, &result)
	if err == nil {
		if existingSession != sessionID {
			return nil, false, fmt.Errorf("command id already belongs to another session")
		}
		if result == nil {
			return nil, false, ErrCommandInProgress
		}
		return json.RawMessage(result), true, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return nil, false, err
	}
	_, err = s.db.ExecContext(ctx,
		`INSERT INTO commands (command_id, session_id, result, created_at) VALUES (?,?,NULL,?)`,
		commandID, sessionID, proto.NowMillis())
	return nil, false, err
}

// ReleaseCommand gives a failed command id back so the same client operation
// can be retried. A completed result is never removed.
func (s *Store) ReleaseCommand(ctx context.Context, commandID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	_, err := s.db.ExecContext(ctx, `DELETE FROM commands WHERE command_id = ? AND result IS NULL`, commandID)
	return err
}

func (s *Store) CompleteCommand(ctx context.Context, commandID string, result any) error {
	blob, err := json.Marshal(result)
	if err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	_, err = s.db.ExecContext(ctx, `UPDATE commands SET result = ? WHERE command_id = ?`, blob, commandID)
	return err
}

// ---- Device pairing ----
//
// Auth state lives beside the event log: one file to back up, one file to
// delete to revoke everything.

const authSchema = `
CREATE TABLE IF NOT EXISTS devices (
  id          TEXT PRIMARY KEY,
  token_hash  BLOB NOT NULL UNIQUE,
  label       TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  last_seen   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS pairings (
  code_hash   BLOB PRIMARY KEY,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  used_at     INTEGER
);
`

// Device is a paired client, individually revocable.
type Device struct {
	ID        string `json:"id"`
	Label     string `json:"label"`
	CreatedAt int64  `json:"createdAt"`
	LastSeen  int64  `json:"lastSeen"`
}

func (s *Store) initAuth() error {
	_, err := s.db.Exec(authSchema)
	return err
}

func (s *Store) CreateDevice(ctx context.Context, id string, tokenHash []byte, label string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := proto.NowMillis()
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO devices (id, token_hash, label, created_at, last_seen) VALUES (?,?,?,?,?)`,
		id, tokenHash, label, now, now)
	return err
}

// DeviceByToken looks a device up by the hash of its token and refreshes
// last_seen. Returns ErrNotFound when the token is unknown or revoked.
func (s *Store) DeviceByToken(ctx context.Context, tokenHash []byte) (Device, error) {
	var d Device
	err := s.db.QueryRowContext(ctx,
		`SELECT id, label, created_at, last_seen FROM devices WHERE token_hash = ?`, tokenHash).
		Scan(&d.ID, &d.Label, &d.CreatedAt, &d.LastSeen)
	if errors.Is(err, sql.ErrNoRows) {
		return d, ErrNotFound
	}
	if err != nil {
		return d, err
	}

	// Throttle the write: last_seen is for the device list, not an audit log.
	if now := proto.NowMillis(); now-d.LastSeen > 60_000 {
		s.mu.Lock()
		_, _ = s.db.ExecContext(ctx, `UPDATE devices SET last_seen = ? WHERE id = ?`, now, d.ID)
		s.mu.Unlock()
	}
	return d, nil
}

func (s *Store) ListDevices(ctx context.Context) ([]Device, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT id, label, created_at, last_seen FROM devices ORDER BY last_seen DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []Device{}
	for rows.Next() {
		var d Device
		if err := rows.Scan(&d.ID, &d.Label, &d.CreatedAt, &d.LastSeen); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

func (s *Store) RevokeDevice(ctx context.Context, id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	_, err := s.db.ExecContext(ctx, `DELETE FROM devices WHERE id = ?`, id)
	return err
}

func (s *Store) CreatePairing(ctx context.Context, codeHash []byte, expiresAt int64) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	_, err := s.db.ExecContext(ctx,
		`INSERT OR REPLACE INTO pairings (code_hash, created_at, expires_at, used_at) VALUES (?,?,?,NULL)`,
		codeHash, proto.NowMillis(), expiresAt)
	return err
}

// RedeemPairing consumes a pairing code exactly once. The single-statement
// UPDATE is what makes it atomic: two devices racing the same code cannot both
// win, because only one UPDATE can match the un-used row.
func (s *Store) RedeemPairing(ctx context.Context, codeHash []byte) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	now := proto.NowMillis()
	res, err := s.db.ExecContext(ctx,
		`UPDATE pairings SET used_at = ? WHERE code_hash = ? AND used_at IS NULL AND expires_at > ?`,
		now, codeHash, now)
	if err != nil {
		return err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

// RedeemPairingForDevice consumes a pairing code and creates the device it
// paid for, in one transaction.
//
// Doing these separately leaves a state where the code is spent but no device
// exists: the caller sees an error, the user retries, and the retry is
// rejected as already-used. Since the code is single-use by design, that is
// unrecoverable without minting a new one.
func (s *Store) RedeemPairingForDevice(ctx context.Context, codeHash []byte, id string, tokenHash []byte, label string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	now := proto.NowMillis()

	// The conditional UPDATE is what makes single-use race-safe: only one
	// statement can match the un-used, unexpired row.
	res, err := tx.ExecContext(ctx,
		`UPDATE pairings SET used_at = ? WHERE code_hash = ? AND used_at IS NULL AND expires_at > ?`,
		now, codeHash, now)
	if err != nil {
		return err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return ErrNotFound
	}

	if _, err := tx.ExecContext(ctx,
		`INSERT INTO devices (id, token_hash, label, created_at, last_seen) VALUES (?,?,?,?,?)`,
		id, tokenHash, label, now, now); err != nil {
		return err
	}

	return tx.Commit()
}

// PurgePairings drops codes that are spent or expired.
func (s *Store) PurgePairings(ctx context.Context) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	_, err := s.db.ExecContext(ctx,
		`DELETE FROM pairings WHERE expires_at < ? OR used_at IS NOT NULL`, proto.NowMillis())
	return err
}
