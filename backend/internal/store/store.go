package store

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"

	"github.com/gosimple/slug"
)

var ErrNotFound = errors.New("not found")
var ErrExists = errors.New("already exists")

type Repo struct {
	ID            int64     `json:"id"`
	Slug          string    `json:"slug"`
	Namespace     string    `json:"namespace"`
	Name          string    `json:"name"`
	Description   string    `json:"description"`
	DefaultBranch string    `json:"default_branch"`
	ImagePath     string    `json:"image_path"`
	SizeBytes     int64     `json:"size_bytes"`
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
}

type Store struct {
	DB *sql.DB
}

func New(db *sql.DB) *Store { return &Store{DB: db} }

func SlugFor(namespace, name string) string {
	name = slug.Make(name)
	if namespace == "" {
		return name
	}
	parts := strings.Split(namespace, "/")
	out := make([]string, 0, len(parts)+1)
	for _, p := range parts {
		if s := slug.Make(p); s != "" {
			out = append(out, s)
		}
	}
	out = append(out, name)
	return strings.Join(out, "/")
}

const repoSelect = `SELECT id, slug, namespace, name, description, default_branch, image_path, size_bytes, created_at, updated_at FROM repos`

func (s *Store) List(ctx context.Context, q string) ([]Repo, error) {
	query := repoSelect + ` WHERE 1=1`
	args := []any{}
	if q != "" {
		query += ` AND (slug LIKE ? OR name LIKE ? OR description LIKE ?)`
		like := "%" + q + "%"
		args = append(args, like, like, like)
	}
	query += ` ORDER BY namespace, name`
	rows, err := s.DB.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Repo{}
	for rows.Next() {
		r, err := scanRepoRow(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func (s *Store) GetBySlug(ctx context.Context, slug string) (Repo, error) {
	row := s.DB.QueryRowContext(ctx, repoSelect+` WHERE slug = ?`, slug)
	r, err := scanRepoRow(row)
	if err == sql.ErrNoRows {
		return Repo{}, ErrNotFound
	}
	return r, err
}

func (s *Store) Create(ctx context.Context, r Repo) (Repo, error) {
	res, err := s.DB.ExecContext(ctx,
		`INSERT INTO repos (slug, namespace, name, description, default_branch)
		 VALUES (?, ?, ?, ?, ?)`,
		r.Slug, r.Namespace, r.Name, r.Description, r.DefaultBranch,
	)
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE") {
			return Repo{}, ErrExists
		}
		return Repo{}, err
	}
	id, _ := res.LastInsertId()
	r.ID = id
	return r, nil
}

func (s *Store) Update(ctx context.Context, id int64, patch RepoPatch) error {
	sets := []string{}
	args := []any{}
	if patch.Description != nil {
		sets = append(sets, "description = ?")
		args = append(args, *patch.Description)
	}
	if patch.DefaultBranch != nil {
		sets = append(sets, "default_branch = ?")
		args = append(args, *patch.DefaultBranch)
	}
	if patch.NewSlug != nil {
		sets = append(sets, "slug = ?", "namespace = ?", "name = ?")
		args = append(args, *patch.NewSlug, patch.NewNamespace, patch.NewName)
	}
	if patch.ImagePath != nil {
		sets = append(sets, "image_path = ?")
		args = append(args, *patch.ImagePath)
	}
	if len(sets) == 0 {
		return nil
	}
	sets = append(sets, "updated_at = CURRENT_TIMESTAMP")
	args = append(args, id)
	_, err := s.DB.ExecContext(ctx, "UPDATE repos SET "+strings.Join(sets, ", ")+" WHERE id = ?", args...)
	return err
}

type RepoPatch struct {
	Description   *string
	DefaultBranch *string
	ImagePath     *string
	NewSlug       *string
	NewNamespace  string
	NewName       string
}

func (s *Store) UpdateDefaultBranch(ctx context.Context, id int64, branch string) error {
	_, err := s.DB.ExecContext(ctx, `UPDATE repos SET default_branch = ? WHERE id = ?`, branch, id)
	return err
}

func (s *Store) UpdateSizeBytes(ctx context.Context, id int64, size int64) error {
	_, err := s.DB.ExecContext(ctx, `UPDATE repos SET size_bytes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, size, id)
	return err
}

func (s *Store) Delete(ctx context.Context, id int64) error {
	_, err := s.DB.ExecContext(ctx, `DELETE FROM repos WHERE id = ?`, id)
	return err
}

type rowScanner interface {
	Scan(dest ...any) error
}

func scanRepoRow(r rowScanner) (Repo, error) {
	var repo Repo
	err := r.Scan(
		&repo.ID, &repo.Slug, &repo.Namespace, &repo.Name, &repo.Description,
		&repo.DefaultBranch, &repo.ImagePath, &repo.SizeBytes,
		&repo.CreatedAt, &repo.UpdatedAt,
	)
	return repo, err
}
