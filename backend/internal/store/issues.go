package store

import (
	"context"
	"database/sql"
	"time"
)

type Issue struct {
	ID          int64      `json:"id"`
	RepoID      int64      `json:"repo_id"`
	Number      int        `json:"number"`
	Title       string     `json:"title"`
	Body        string     `json:"body"`
	State       string     `json:"state"`
	StateReason string     `json:"state_reason,omitempty"`
	Labels      []Label    `json:"labels"`
	CommentCount int       `json:"comment_count"`
	CreatedAt   time.Time  `json:"created_at"`
	UpdatedAt   time.Time  `json:"updated_at"`
	ClosedAt    *time.Time `json:"closed_at"`
}

type IssuePatch struct {
	Title       *string
	Body        *string
	State       *string
	StateReason *string
}

func (s *Store) nextIssueNumber(ctx context.Context, repoID int64) (int, error) {
	var n int
	err := s.DB.QueryRowContext(ctx,
		`SELECT COALESCE(MAX(number), 0) + 1 FROM issues WHERE repo_id = ?`, repoID,
	).Scan(&n)
	return n, err
}

func (s *Store) CreateIssue(ctx context.Context, repoID int64, title, body string, labelIDs []int64) (Issue, error) {
	num, err := s.nextIssueNumber(ctx, repoID)
	if err != nil {
		return Issue{}, err
	}
	res, err := s.DB.ExecContext(ctx,
		`INSERT INTO issues (repo_id, number, title, body) VALUES (?, ?, ?, ?)`,
		repoID, num, title, body,
	)
	if err != nil {
		return Issue{}, err
	}
	id, _ := res.LastInsertId()
	for _, lid := range labelIDs {
		_, _ = s.DB.ExecContext(ctx,
			`INSERT OR IGNORE INTO issue_labels (issue_id, label_id) VALUES (?, ?)`, id, lid)
	}
	return s.GetIssue(ctx, repoID, num)
}

const issueSelect = `SELECT i.id, i.repo_id, i.number, i.title, i.body, i.state, i.state_reason,
	i.created_at, i.updated_at, i.closed_at,
	(SELECT COUNT(*) FROM issue_comments WHERE issue_id = i.id) as comment_count
FROM issues i`

func scanIssueRow(r rowScanner) (Issue, error) {
	var iss Issue
	err := r.Scan(&iss.ID, &iss.RepoID, &iss.Number, &iss.Title, &iss.Body,
		&iss.State, &iss.StateReason, &iss.CreatedAt, &iss.UpdatedAt, &iss.ClosedAt, &iss.CommentCount)
	if err != nil {
		return Issue{}, err
	}
	iss.Labels = []Label{}
	return iss, nil
}

func (s *Store) GetIssue(ctx context.Context, repoID int64, number int) (Issue, error) {
	row := s.DB.QueryRowContext(ctx, issueSelect+` WHERE i.repo_id = ? AND i.number = ?`, repoID, number)
	iss, err := scanIssueRow(row)
	if err == sql.ErrNoRows {
		return Issue{}, ErrNotFound
	}
	if err != nil {
		return Issue{}, err
	}
	iss.Labels, _ = s.LabelsForIssue(ctx, iss.ID)
	return iss, nil
}

func (s *Store) ListIssues(ctx context.Context, repoID int64, state string) ([]Issue, error) {
	query := issueSelect + ` WHERE i.repo_id = ?`
	args := []any{repoID}
	if state != "" && state != "all" {
		query += ` AND i.state = ?`
		args = append(args, state)
	}
	query += ` ORDER BY i.number DESC`
	rows, err := s.DB.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Issue{}
	for rows.Next() {
		iss, err := scanIssueRow(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, iss)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	ids := make([]int64, len(out))
	for i := range out {
		ids[i] = out[i].ID
	}
	labelMap, _ := s.LabelsForIssues(ctx, ids)
	for i := range out {
		if labels, ok := labelMap[out[i].ID]; ok {
			out[i].Labels = labels
		}
	}
	return out, nil
}

func (s *Store) UpdateIssue(ctx context.Context, repoID int64, number int, patch IssuePatch) (Issue, error) {
	sets := []string{}
	args := []any{}
	if patch.Title != nil {
		sets = append(sets, "title = ?")
		args = append(args, *patch.Title)
	}
	if patch.Body != nil {
		sets = append(sets, "body = ?")
		args = append(args, *patch.Body)
	}
	if patch.State != nil {
		sets = append(sets, "state = ?")
		args = append(args, *patch.State)
		if *patch.State == "closed" {
			sets = append(sets, "closed_at = CURRENT_TIMESTAMP")
			reason := "completed"
			if patch.StateReason != nil {
				reason = *patch.StateReason
			}
			sets = append(sets, "state_reason = ?")
			args = append(args, reason)
		} else if *patch.State == "open" {
			sets = append(sets, "closed_at = NULL", "state_reason = ''")
		}
	}
	if len(sets) == 0 {
		return s.GetIssue(ctx, repoID, number)
	}
	sets = append(sets, "updated_at = CURRENT_TIMESTAMP")
	args = append(args, repoID, number)
	_, err := s.DB.ExecContext(ctx,
		"UPDATE issues SET "+join(sets, ", ")+" WHERE repo_id = ? AND number = ?", args...)
	if err != nil {
		return Issue{}, err
	}
	return s.GetIssue(ctx, repoID, number)
}

func (s *Store) DeleteIssue(ctx context.Context, repoID int64, number int) error {
	_, err := s.DB.ExecContext(ctx, `DELETE FROM issues WHERE repo_id = ? AND number = ?`, repoID, number)
	return err
}

func (s *Store) SetIssueLabels(ctx context.Context, issueID int64, labelIDs []int64) error {
	_, err := s.DB.ExecContext(ctx, `DELETE FROM issue_labels WHERE issue_id = ?`, issueID)
	if err != nil {
		return err
	}
	for _, lid := range labelIDs {
		_, err = s.DB.ExecContext(ctx,
			`INSERT OR IGNORE INTO issue_labels (issue_id, label_id) VALUES (?, ?)`, issueID, lid)
		if err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) IssueCountByState(ctx context.Context, repoID int64) (open, closed int, err error) {
	rows, err := s.DB.QueryContext(ctx,
		`SELECT state, COUNT(*) FROM issues WHERE repo_id = ? GROUP BY state`, repoID)
	if err != nil {
		return 0, 0, err
	}
	defer rows.Close()
	for rows.Next() {
		var st string
		var cnt int
		if err := rows.Scan(&st, &cnt); err != nil {
			return 0, 0, err
		}
		switch st {
		case "open":
			open = cnt
		case "closed":
			closed = cnt
		}
	}
	return open, closed, rows.Err()
}

// Comments

type IssueComment struct {
	ID        int64     `json:"id"`
	IssueID   int64     `json:"issue_id"`
	Body      string    `json:"body"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

func (s *Store) CreateComment(ctx context.Context, issueID int64, body string) (IssueComment, error) {
	res, err := s.DB.ExecContext(ctx,
		`INSERT INTO issue_comments (issue_id, body) VALUES (?, ?)`, issueID, body)
	if err != nil {
		return IssueComment{}, err
	}
	id, _ := res.LastInsertId()
	_, _ = s.DB.ExecContext(ctx,
		`UPDATE issues SET updated_at = CURRENT_TIMESTAMP WHERE id = ?`, issueID)
	return s.GetComment(ctx, id)
}

func (s *Store) GetComment(ctx context.Context, id int64) (IssueComment, error) {
	var c IssueComment
	err := s.DB.QueryRowContext(ctx,
		`SELECT id, issue_id, body, created_at, updated_at FROM issue_comments WHERE id = ?`, id,
	).Scan(&c.ID, &c.IssueID, &c.Body, &c.CreatedAt, &c.UpdatedAt)
	if err == sql.ErrNoRows {
		return IssueComment{}, ErrNotFound
	}
	return c, err
}

func (s *Store) ListComments(ctx context.Context, issueID int64) ([]IssueComment, error) {
	rows, err := s.DB.QueryContext(ctx,
		`SELECT id, issue_id, body, created_at, updated_at FROM issue_comments WHERE issue_id = ? ORDER BY created_at`, issueID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []IssueComment{}
	for rows.Next() {
		var c IssueComment
		if err := rows.Scan(&c.ID, &c.IssueID, &c.Body, &c.CreatedAt, &c.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

func (s *Store) UpdateComment(ctx context.Context, id int64, body string) (IssueComment, error) {
	_, err := s.DB.ExecContext(ctx,
		`UPDATE issue_comments SET body = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, body, id)
	if err != nil {
		return IssueComment{}, err
	}
	return s.GetComment(ctx, id)
}

func (s *Store) DeleteComment(ctx context.Context, id int64) error {
	_, err := s.DB.ExecContext(ctx, `DELETE FROM issue_comments WHERE id = ?`, id)
	return err
}

func join(parts []string, sep string) string {
	if len(parts) == 0 {
		return ""
	}
	result := parts[0]
	for _, p := range parts[1:] {
		result += sep + p
	}
	return result
}
