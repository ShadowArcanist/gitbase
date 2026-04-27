package store

import "context"

type AppSettings struct {
	DefaultBranch string `json:"default_branch"`
	CommitAvatar  string `json:"commit_avatar"`
}

func (s *Store) GetAppSettings(ctx context.Context) (AppSettings, error) {
	out := AppSettings{DefaultBranch: "main"}
	rows, err := s.DB.QueryContext(ctx, `SELECT key, value FROM app_settings`)
	if err != nil {
		return out, err
	}
	defer rows.Close()
	for rows.Next() {
		var k, v string
		if err := rows.Scan(&k, &v); err != nil {
			return out, err
		}
		switch k {
		case "default_branch":
			if v != "" {
				out.DefaultBranch = v
			}
		case "commit_avatar":
			out.CommitAvatar = v
		}
	}
	return out, rows.Err()
}

func (s *Store) SetAppSetting(ctx context.Context, key, value string) error {
	_, err := s.DB.ExecContext(ctx, `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
		ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`, key, value)
	return err
}
