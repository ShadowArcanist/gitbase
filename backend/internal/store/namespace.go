package store

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"
)

type Namespace struct {
	Name        string    `json:"name"`
	Description string    `json:"description"`
	ImagePath   string    `json:"image_path"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

func (s *Store) ListNamespaces(ctx context.Context) ([]Namespace, error) {
	rows, err := s.DB.QueryContext(ctx,
		`SELECT name, description, image_path, created_at, updated_at FROM namespaces ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Namespace{}
	for rows.Next() {
		var ns Namespace
		if err := rows.Scan(&ns.Name, &ns.Description, &ns.ImagePath, &ns.CreatedAt, &ns.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, ns)
	}
	return out, rows.Err()
}

func (s *Store) GetNamespace(ctx context.Context, name string) (Namespace, error) {
	row := s.DB.QueryRowContext(ctx,
		`SELECT name, description, image_path, created_at, updated_at FROM namespaces WHERE name = ?`,
		name,
	)
	var ns Namespace
	err := row.Scan(&ns.Name, &ns.Description, &ns.ImagePath, &ns.CreatedAt, &ns.UpdatedAt)
	if err == sql.ErrNoRows {
		return Namespace{Name: name}, nil
	}
	return ns, err
}

func (s *Store) UpsertNamespace(ctx context.Context, name string) error {
	_, err := s.DB.ExecContext(ctx,
		`INSERT INTO namespaces (name) VALUES (?) ON CONFLICT(name) DO NOTHING`,
		name,
	)
	return err
}

type NamespacePatch struct {
	Description *string
	ImagePath   *string
	NewName     *string
}

func (s *Store) UpdateNamespace(ctx context.Context, name string, patch NamespacePatch) error {
	_ = s.UpsertNamespace(ctx, name)
	sets := []string{}
	args := []any{}
	if patch.Description != nil {
		sets = append(sets, "description = ?")
		args = append(args, *patch.Description)
	}
	if patch.ImagePath != nil {
		sets = append(sets, "image_path = ?")
		args = append(args, *patch.ImagePath)
	}
	if len(sets) > 0 {
		sets = append(sets, "updated_at = CURRENT_TIMESTAMP")
		args = append(args, name)
		if _, err := s.DB.ExecContext(ctx, "UPDATE namespaces SET "+strings.Join(sets, ", ")+" WHERE name = ?", args...); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) RenameNamespace(ctx context.Context, oldName, newName string) error {
	if oldName == newName {
		return nil
	}
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO namespaces (name, description, image_path)
		 SELECT ?, description, image_path FROM namespaces WHERE name = ?
		 ON CONFLICT(name) DO NOTHING`,
		newName, oldName,
	); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM namespaces WHERE name = ?`, oldName); err != nil {
		return err
	}
	rows, err := tx.QueryContext(ctx, `SELECT id, slug, namespace, name FROM repos WHERE namespace = ? OR namespace LIKE ?`, oldName, oldName+"/%")
	if err != nil {
		return err
	}
	type repoRef struct {
		id           int64
		slug, ns, nm string
	}
	var refs []repoRef
	for rows.Next() {
		var r repoRef
		if err := rows.Scan(&r.id, &r.slug, &r.ns, &r.nm); err != nil {
			rows.Close()
			return err
		}
		refs = append(refs, r)
	}
	rows.Close()
	for _, r := range refs {
		newNs := newName
		if strings.HasPrefix(r.ns, oldName+"/") {
			newNs = newName + r.ns[len(oldName):]
		}
		newSlug := newNs + "/" + r.nm
		if _, err := tx.ExecContext(ctx,
			`UPDATE repos SET namespace = ?, slug = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
			newNs, newSlug, r.id,
		); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (s *Store) DeleteNamespace(ctx context.Context, name string) error {
	var n int
	row := s.DB.QueryRowContext(ctx, `SELECT COUNT(*) FROM repos WHERE namespace = ? OR namespace LIKE ?`, name, name+"/%")
	if err := row.Scan(&n); err != nil {
		return err
	}
	if n > 0 {
		return errors.New("namespace is not empty")
	}
	_, err := s.DB.ExecContext(ctx, `DELETE FROM namespaces WHERE name = ?`, name)
	return err
}

func (s *Store) ReposInNamespace(ctx context.Context, name string) ([]Repo, error) {
	rows, err := s.DB.QueryContext(ctx,
		repoSelect+` WHERE (namespace = ? OR namespace LIKE ?) ORDER BY namespace, name`,
		name, name+"/%",
	)
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
