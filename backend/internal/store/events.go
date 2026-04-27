package store

import (
	"context"
	"time"
)

type Event struct {
	ID         int64     `json:"id"`
	Kind       string    `json:"kind"`
	TargetKind string    `json:"target_kind"`
	Target     string    `json:"target"`
	Message    string    `json:"message"`
	Status     string    `json:"status,omitempty"`
	CreatedAt  time.Time `json:"time"`
}

func (s *Store) RecordEvent(ctx context.Context, e Event) error {
	_, err := s.DB.ExecContext(ctx,
		`INSERT INTO events (kind, target_kind, target, message, status) VALUES (?, ?, ?, ?, ?)`,
		e.Kind, e.TargetKind, e.Target, e.Message, e.Status,
	)
	return err
}

func (s *Store) ListEvents(ctx context.Context, limit int) ([]Event, error) {
	if limit <= 0 {
		limit = 10
	}
	rows, err := s.DB.QueryContext(ctx,
		`SELECT id, kind, target_kind, target, message, status, created_at
		 FROM events ORDER BY id DESC LIMIT ?`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Event{}
	for rows.Next() {
		var e Event
		if err := rows.Scan(&e.ID, &e.Kind, &e.TargetKind, &e.Target, &e.Message, &e.Status, &e.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}
