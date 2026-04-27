package store

import (
	"context"
	"database/sql"
	"strings"
	"time"
)

type Label struct {
	ID          int64     `json:"id"`
	RepoID      int64     `json:"repo_id"`
	Name        string    `json:"name"`
	Color       string    `json:"color"`
	Description string    `json:"description"`
	CreatedAt   time.Time `json:"created_at"`
}

func (s *Store) CreateLabel(ctx context.Context, repoID int64, name, color, description string) (Label, error) {
	if color == "" {
		color = "6b7280"
	}
	res, err := s.DB.ExecContext(ctx,
		`INSERT INTO labels (repo_id, name, color, description) VALUES (?, ?, ?, ?)`,
		repoID, name, color, description)
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE") {
			return Label{}, ErrExists
		}
		return Label{}, err
	}
	id, _ := res.LastInsertId()
	return s.GetLabel(ctx, id)
}

func (s *Store) GetLabel(ctx context.Context, id int64) (Label, error) {
	var l Label
	err := s.DB.QueryRowContext(ctx,
		`SELECT id, repo_id, name, color, description, created_at FROM labels WHERE id = ?`, id,
	).Scan(&l.ID, &l.RepoID, &l.Name, &l.Color, &l.Description, &l.CreatedAt)
	if err == sql.ErrNoRows {
		return Label{}, ErrNotFound
	}
	return l, err
}

func (s *Store) ListLabels(ctx context.Context, repoID int64) ([]Label, error) {
	rows, err := s.DB.QueryContext(ctx,
		`SELECT id, repo_id, name, color, description, created_at FROM labels WHERE repo_id = ? ORDER BY name`, repoID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Label{}
	for rows.Next() {
		var l Label
		if err := rows.Scan(&l.ID, &l.RepoID, &l.Name, &l.Color, &l.Description, &l.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, l)
	}
	return out, rows.Err()
}

func (s *Store) UpdateLabel(ctx context.Context, id int64, name, color, description *string) (Label, error) {
	sets := []string{}
	args := []any{}
	if name != nil {
		sets = append(sets, "name = ?")
		args = append(args, *name)
	}
	if color != nil {
		sets = append(sets, "color = ?")
		args = append(args, *color)
	}
	if description != nil {
		sets = append(sets, "description = ?")
		args = append(args, *description)
	}
	if len(sets) == 0 {
		return s.GetLabel(ctx, id)
	}
	args = append(args, id)
	_, err := s.DB.ExecContext(ctx,
		"UPDATE labels SET "+strings.Join(sets, ", ")+" WHERE id = ?", args...)
	if err != nil {
		return Label{}, err
	}
	return s.GetLabel(ctx, id)
}

func (s *Store) DeleteLabel(ctx context.Context, id int64) error {
	_, err := s.DB.ExecContext(ctx, `DELETE FROM labels WHERE id = ?`, id)
	return err
}

func (s *Store) LabelsForIssue(ctx context.Context, issueID int64) ([]Label, error) {
	rows, err := s.DB.QueryContext(ctx,
		`SELECT l.id, l.repo_id, l.name, l.color, l.description, l.created_at
		 FROM labels l JOIN issue_labels il ON l.id = il.label_id
		 WHERE il.issue_id = ? ORDER BY l.name`, issueID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Label{}
	for rows.Next() {
		var l Label
		if err := rows.Scan(&l.ID, &l.RepoID, &l.Name, &l.Color, &l.Description, &l.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, l)
	}
	return out, rows.Err()
}

func (s *Store) LabelsForIssues(ctx context.Context, issueIDs []int64) (map[int64][]Label, error) {
	if len(issueIDs) == 0 {
		return map[int64][]Label{}, nil
	}
	placeholders := strings.Repeat("?,", len(issueIDs))
	placeholders = placeholders[:len(placeholders)-1]
	args := make([]any, len(issueIDs))
	for i, id := range issueIDs {
		args[i] = id
	}
	rows, err := s.DB.QueryContext(ctx,
		`SELECT il.issue_id, l.id, l.repo_id, l.name, l.color, l.description, l.created_at
		 FROM labels l JOIN issue_labels il ON l.id = il.label_id
		 WHERE il.issue_id IN (`+placeholders+`) ORDER BY l.name`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	m := map[int64][]Label{}
	for rows.Next() {
		var issueID int64
		var l Label
		if err := rows.Scan(&issueID, &l.ID, &l.RepoID, &l.Name, &l.Color, &l.Description, &l.CreatedAt); err != nil {
			return nil, err
		}
		m[issueID] = append(m[issueID], l)
	}
	return m, rows.Err()
}
