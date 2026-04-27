package store

import (
	"context"
	"database/sql"
	"time"
)

type PullRequest struct {
	ID             int64      `json:"id"`
	RepoID         int64      `json:"repo_id"`
	Number         int        `json:"number"`
	Title          string     `json:"title"`
	Body           string     `json:"body"`
	State          string     `json:"state"`
	IsDraft        bool       `json:"is_draft"`
	HeadBranch     string     `json:"head_branch"`
	BaseBranch     string     `json:"base_branch"`
	MergeCommitSHA string     `json:"merge_commit_sha,omitempty"`
	Labels         []Label    `json:"labels"`
	CommentCount   int        `json:"comment_count"`
	CreatedAt      time.Time  `json:"created_at"`
	UpdatedAt      time.Time  `json:"updated_at"`
	MergedAt       *time.Time `json:"merged_at"`
	ClosedAt       *time.Time `json:"closed_at"`
}

type PullRequestPatch struct {
	Title   *string
	Body    *string
	State   *string
	IsDraft *bool
}

func (s *Store) nextPRNumber(ctx context.Context, repoID int64) (int, error) {
	var n int
	err := s.DB.QueryRowContext(ctx,
		`SELECT COALESCE(MAX(number), 0) + 1 FROM pull_requests WHERE repo_id = ?`, repoID,
	).Scan(&n)
	return n, err
}

func (s *Store) CreatePullRequest(ctx context.Context, repoID int64, title, body, headBranch, baseBranch string, isDraft bool, labelIDs []int64) (PullRequest, error) {
	num, err := s.nextPRNumber(ctx, repoID)
	if err != nil {
		return PullRequest{}, err
	}
	draft := 0
	if isDraft {
		draft = 1
	}
	res, err := s.DB.ExecContext(ctx,
		`INSERT INTO pull_requests (repo_id, number, title, body, head_branch, base_branch, is_draft) VALUES (?, ?, ?, ?, ?, ?, ?)`,
		repoID, num, title, body, headBranch, baseBranch, draft,
	)
	if err != nil {
		return PullRequest{}, err
	}
	id, _ := res.LastInsertId()
	for _, lid := range labelIDs {
		_, _ = s.DB.ExecContext(ctx,
			`INSERT OR IGNORE INTO pr_labels (pr_id, label_id) VALUES (?, ?)`, id, lid)
	}
	return s.GetPullRequest(ctx, repoID, num)
}

const prSelect = `SELECT p.id, p.repo_id, p.number, p.title, p.body, p.state, p.is_draft,
	p.head_branch, p.base_branch, p.merge_commit_sha, p.created_at, p.updated_at, p.merged_at, p.closed_at,
	(SELECT COUNT(*) FROM pr_comments WHERE pr_id = p.id) as comment_count
FROM pull_requests p`

func scanPRRow(r rowScanner) (PullRequest, error) {
	var pr PullRequest
	var draft int
	err := r.Scan(&pr.ID, &pr.RepoID, &pr.Number, &pr.Title, &pr.Body,
		&pr.State, &draft, &pr.HeadBranch, &pr.BaseBranch, &pr.MergeCommitSHA,
		&pr.CreatedAt, &pr.UpdatedAt, &pr.MergedAt, &pr.ClosedAt, &pr.CommentCount)
	if err != nil {
		return PullRequest{}, err
	}
	pr.IsDraft = draft == 1
	pr.Labels = []Label{}
	return pr, nil
}

func (s *Store) GetPullRequest(ctx context.Context, repoID int64, number int) (PullRequest, error) {
	row := s.DB.QueryRowContext(ctx, prSelect+` WHERE p.repo_id = ? AND p.number = ?`, repoID, number)
	pr, err := scanPRRow(row)
	if err == sql.ErrNoRows {
		return PullRequest{}, ErrNotFound
	}
	if err != nil {
		return PullRequest{}, err
	}
	pr.Labels, _ = s.LabelsForPR(ctx, pr.ID)
	return pr, nil
}

func (s *Store) ListPullRequests(ctx context.Context, repoID int64, state string) ([]PullRequest, error) {
	query := prSelect + ` WHERE p.repo_id = ?`
	args := []any{repoID}
	if state != "" && state != "all" {
		query += ` AND p.state = ?`
		args = append(args, state)
	}
	query += ` ORDER BY p.number DESC`
	rows, err := s.DB.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []PullRequest{}
	for rows.Next() {
		pr, err := scanPRRow(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, pr)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	ids := make([]int64, len(out))
	for i := range out {
		ids[i] = out[i].ID
	}
	labelMap, _ := s.LabelsForPRs(ctx, ids)
	for i := range out {
		if labels, ok := labelMap[out[i].ID]; ok {
			out[i].Labels = labels
		}
	}
	return out, nil
}

func (s *Store) UpdatePullRequest(ctx context.Context, repoID int64, number int, patch PullRequestPatch) (PullRequest, error) {
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
	if patch.IsDraft != nil {
		v := 0
		if *patch.IsDraft {
			v = 1
		}
		sets = append(sets, "is_draft = ?")
		args = append(args, v)
	}
	if patch.State != nil {
		sets = append(sets, "state = ?")
		args = append(args, *patch.State)
		if *patch.State == "merged" {
			sets = append(sets, "merged_at = CURRENT_TIMESTAMP")
		} else if *patch.State == "closed" {
			sets = append(sets, "closed_at = CURRENT_TIMESTAMP")
		} else if *patch.State == "open" {
			sets = append(sets, "closed_at = NULL", "merged_at = NULL")
		}
	}
	if len(sets) == 0 {
		return s.GetPullRequest(ctx, repoID, number)
	}
	sets = append(sets, "updated_at = CURRENT_TIMESTAMP")
	args = append(args, repoID, number)
	_, err := s.DB.ExecContext(ctx,
		"UPDATE pull_requests SET "+join(sets, ", ")+" WHERE repo_id = ? AND number = ?", args...)
	if err != nil {
		return PullRequest{}, err
	}
	return s.GetPullRequest(ctx, repoID, number)
}

func (s *Store) SetMergeCommitSHA(ctx context.Context, repoID int64, number int, sha string) error {
	_, err := s.DB.ExecContext(ctx,
		`UPDATE pull_requests SET merge_commit_sha = ? WHERE repo_id = ? AND number = ?`, sha, repoID, number)
	return err
}

func (s *Store) DeletePullRequest(ctx context.Context, repoID int64, number int) error {
	_, err := s.DB.ExecContext(ctx, `DELETE FROM pull_requests WHERE repo_id = ? AND number = ?`, repoID, number)
	return err
}

func (s *Store) SetPRLabels(ctx context.Context, prID int64, labelIDs []int64) error {
	_, err := s.DB.ExecContext(ctx, `DELETE FROM pr_labels WHERE pr_id = ?`, prID)
	if err != nil {
		return err
	}
	for _, lid := range labelIDs {
		_, err = s.DB.ExecContext(ctx,
			`INSERT OR IGNORE INTO pr_labels (pr_id, label_id) VALUES (?, ?)`, prID, lid)
		if err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) PRCountByState(ctx context.Context, repoID int64) (open, merged, closed int, err error) {
	rows, err := s.DB.QueryContext(ctx,
		`SELECT state, COUNT(*) FROM pull_requests WHERE repo_id = ? GROUP BY state`, repoID)
	if err != nil {
		return 0, 0, 0, err
	}
	defer rows.Close()
	for rows.Next() {
		var st string
		var cnt int
		if err := rows.Scan(&st, &cnt); err != nil {
			return 0, 0, 0, err
		}
		switch st {
		case "open":
			open = cnt
		case "merged":
			merged = cnt
		case "closed":
			closed = cnt
		}
	}
	return open, merged, closed, rows.Err()
}

func (s *Store) LabelsForPR(ctx context.Context, prID int64) ([]Label, error) {
	rows, err := s.DB.QueryContext(ctx,
		`SELECT l.id, l.repo_id, l.name, l.color, l.description, l.created_at
		 FROM labels l JOIN pr_labels pl ON l.id = pl.label_id
		 WHERE pl.pr_id = ? ORDER BY l.name`, prID)
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

func (s *Store) LabelsForPRs(ctx context.Context, prIDs []int64) (map[int64][]Label, error) {
	if len(prIDs) == 0 {
		return map[int64][]Label{}, nil
	}
	placeholders := ""
	args := make([]any, len(prIDs))
	for i, id := range prIDs {
		if i > 0 {
			placeholders += ","
		}
		placeholders += "?"
		args[i] = id
	}
	rows, err := s.DB.QueryContext(ctx,
		`SELECT pl.pr_id, l.id, l.repo_id, l.name, l.color, l.description, l.created_at
		 FROM labels l JOIN pr_labels pl ON l.id = pl.label_id
		 WHERE pl.pr_id IN (`+placeholders+`) ORDER BY l.name`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	m := map[int64][]Label{}
	for rows.Next() {
		var prID int64
		var l Label
		if err := rows.Scan(&prID, &l.ID, &l.RepoID, &l.Name, &l.Color, &l.Description, &l.CreatedAt); err != nil {
			return nil, err
		}
		m[prID] = append(m[prID], l)
	}
	return m, rows.Err()
}

// PR Comments

type PRComment struct {
	ID        int64     `json:"id"`
	PRID      int64     `json:"pr_id"`
	Body      string    `json:"body"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

func (s *Store) CreatePRComment(ctx context.Context, prID int64, body string) (PRComment, error) {
	res, err := s.DB.ExecContext(ctx,
		`INSERT INTO pr_comments (pr_id, body) VALUES (?, ?)`, prID, body)
	if err != nil {
		return PRComment{}, err
	}
	id, _ := res.LastInsertId()
	_, _ = s.DB.ExecContext(ctx,
		`UPDATE pull_requests SET updated_at = CURRENT_TIMESTAMP WHERE id = ?`, prID)
	return s.GetPRComment(ctx, id)
}

func (s *Store) GetPRComment(ctx context.Context, id int64) (PRComment, error) {
	var c PRComment
	err := s.DB.QueryRowContext(ctx,
		`SELECT id, pr_id, body, created_at, updated_at FROM pr_comments WHERE id = ?`, id,
	).Scan(&c.ID, &c.PRID, &c.Body, &c.CreatedAt, &c.UpdatedAt)
	if err == sql.ErrNoRows {
		return PRComment{}, ErrNotFound
	}
	return c, err
}

func (s *Store) ListPRComments(ctx context.Context, prID int64) ([]PRComment, error) {
	rows, err := s.DB.QueryContext(ctx,
		`SELECT id, pr_id, body, created_at, updated_at FROM pr_comments WHERE pr_id = ? ORDER BY created_at`, prID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []PRComment{}
	for rows.Next() {
		var c PRComment
		if err := rows.Scan(&c.ID, &c.PRID, &c.Body, &c.CreatedAt, &c.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

func (s *Store) UpdatePRComment(ctx context.Context, id int64, body string) (PRComment, error) {
	_, err := s.DB.ExecContext(ctx,
		`UPDATE pr_comments SET body = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, body, id)
	if err != nil {
		return PRComment{}, err
	}
	return s.GetPRComment(ctx, id)
}

func (s *Store) DeletePRComment(ctx context.Context, id int64) error {
	_, err := s.DB.ExecContext(ctx, `DELETE FROM pr_comments WHERE id = ?`, id)
	return err
}
