package store

import (
	"context"
	"database/sql"
	"errors"
)

type SSHKey struct {
	ID          int64  `json:"id"`
	Name        string `json:"name"`
	Fingerprint string `json:"fingerprint"`
	PublicKey   string `json:"public_key"`
	CreatedAt   string `json:"created_at"`
}

func (s *Store) ListSSHKeys(ctx context.Context) ([]SSHKey, error) {
	rows, err := s.DB.QueryContext(ctx, `SELECT id, name, fingerprint, public_key, created_at FROM ssh_keys ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var keys []SSHKey
	for rows.Next() {
		var k SSHKey
		if err := rows.Scan(&k.ID, &k.Name, &k.Fingerprint, &k.PublicKey, &k.CreatedAt); err != nil {
			return nil, err
		}
		keys = append(keys, k)
	}
	return keys, rows.Err()
}

func (s *Store) CreateSSHKey(ctx context.Context, name, publicKey, fingerprint string) (SSHKey, error) {
	var existing int
	err := s.DB.QueryRowContext(ctx, `SELECT COUNT(*) FROM ssh_keys WHERE fingerprint = ?`, fingerprint).Scan(&existing)
	if err != nil {
		return SSHKey{}, err
	}
	if existing > 0 {
		return SSHKey{}, ErrExists
	}
	res, err := s.DB.ExecContext(ctx,
		`INSERT INTO ssh_keys (name, fingerprint, public_key) VALUES (?, ?, ?)`,
		name, fingerprint, publicKey)
	if err != nil {
		return SSHKey{}, err
	}
	id, _ := res.LastInsertId()
	var k SSHKey
	err = s.DB.QueryRowContext(ctx, `SELECT id, name, fingerprint, public_key, created_at FROM ssh_keys WHERE id = ?`, id).
		Scan(&k.ID, &k.Name, &k.Fingerprint, &k.PublicKey, &k.CreatedAt)
	return k, err
}

func (s *Store) FindSSHKeyByFingerprint(ctx context.Context, fp string) (SSHKey, error) {
	var k SSHKey
	err := s.DB.QueryRowContext(ctx,
		`SELECT id, name, fingerprint, public_key, created_at FROM ssh_keys WHERE fingerprint = ?`, fp).
		Scan(&k.ID, &k.Name, &k.Fingerprint, &k.PublicKey, &k.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return SSHKey{}, ErrNotFound
	}
	return k, err
}

func (s *Store) DeleteSSHKey(ctx context.Context, id int64) error {
	res, err := s.DB.ExecContext(ctx, `DELETE FROM ssh_keys WHERE id = ?`, id)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}
	return nil
}
