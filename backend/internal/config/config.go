package config

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

type Config struct {
	Addr          string
	DataDir       string
	RepoDir       string
	DBPath        string
	TmpDir        string
	MaxBlobBytes  int64
	PublicBaseURL string
	SSHEnabled    bool
	SSHPort       int
	SSHHost       string
}

func Load() Config {
	dataDir := env("GITBASE_DATA", "./data")
	c := Config{
		Addr:          env("GITBASE_ADDR", ":3000"),
		DataDir:       dataDir,
		RepoDir:       filepath.Join(dataDir, "repos"),
		DBPath:        filepath.Join(dataDir, "app.db"),
		TmpDir:        filepath.Join(dataDir, "tmp"),
		MaxBlobBytes:  envInt64("GITBASE_MAX_BLOB_BYTES", 5*1024*1024),
		PublicBaseURL: env("GITBASE_PUBLIC_URL", ""),
		SSHEnabled:    envBool("SSH_ENABLED", false),
		SSHPort:       int(envInt64("SSH_PORT", 2222)),
		SSHHost:       env("SSH_HOST", "0.0.0.0"),
	}
	return c
}

func env(k, def string) string {
	if v, ok := os.LookupEnv(k); ok && v != "" {
		return v
	}
	return def
}

func envInt64(k string, def int64) int64 {
	if v, ok := os.LookupEnv(k); ok {
		if n, err := strconv.ParseInt(v, 10, 64); err == nil {
			return n
		}
	}
	return def
}

func envBool(k string, def bool) bool {
	if v, ok := os.LookupEnv(k); ok {
		v = strings.ToLower(strings.TrimSpace(v))
		switch v {
		case "1", "true", "yes", "on":
			return true
		case "0", "false", "no", "off", "":
			return false
		}
	}
	return def
}
