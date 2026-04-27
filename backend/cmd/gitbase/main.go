package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/shadowarcanist/gitbase/internal/api"
	"github.com/shadowarcanist/gitbase/internal/config"
	"github.com/shadowarcanist/gitbase/internal/db"
	"github.com/shadowarcanist/gitbase/internal/gitx"
	"github.com/shadowarcanist/gitbase/internal/ssh"
	"github.com/shadowarcanist/gitbase/internal/store"
	"github.com/shadowarcanist/gitbase/internal/web"
)

func main() {
	cfg := config.Load()
	if err := os.MkdirAll(cfg.RepoDir, 0o755); err != nil {
		log.Fatalf("mkdir repos: %v", err)
	}
	if err := os.MkdirAll(cfg.TmpDir, 0o755); err != nil {
		log.Fatalf("mkdir tmp: %v", err)
	}
	dbh, err := db.Open(cfg.DBPath)
	if err != nil {
		log.Fatalf("open db: %v", err)
	}
	defer dbh.Close()
	if err := db.Migrate(dbh); err != nil {
		log.Fatalf("migrate: %v", err)
	}
	st := store.New(dbh)
	ensureDefaultNamespace(st)
	git := gitx.New(cfg.TmpDir)
	srv := &api.Server{
		Cfg:     cfg,
		Store:   st,
		Git:     git,
		WebRoot: web.Handler(),
	}
	log.Printf("[ Startup ] Gitbase is using %s for storage", cfg.DataDir)
	if cfg.SSHEnabled {
		sshSrv := &ssh.Server{
			Host:    cfg.SSHHost,
			Port:    cfg.SSHPort,
			DataDir: cfg.DataDir,
			RepoDir: cfg.RepoDir,
			Store:   st,
			Git:     git,
		}
		if err := sshSrv.Start(); err != nil {
			log.Fatalf("ssh: %v", err)
		}
		srv.SSHFingerprint = sshSrv.HostFingerprint()
		log.Printf("[ Startup ] Gitbase SSH is enabled")
		log.Printf("[ Startup ] Gitbase SSH server listening on %s:%d", cfg.SSHHost, cfg.SSHPort)
	}
	go backfillRepoSizes(st, cfg.RepoDir)
	httpSrv := &http.Server{
		Addr:              cfg.Addr,
		Handler:           srv.Router(),
		ReadHeaderTimeout: 10 * time.Second,
	}
	go func() {
		log.Printf("[ Startup ] Gitbase web server listening on %s", cfg.Addr)
		if err := httpSrv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("http: %v", err)
		}
	}()
	sig := make(chan os.Signal, 1)
	signal.Notify(sig, os.Interrupt, syscall.SIGTERM)
	<-sig
	log.Println("[ Shutdown ] Gitbase shutting down")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = httpSrv.Shutdown(ctx)
}

func backfillRepoSizes(st *store.Store, repoDir string) {
	repos, err := st.List(context.Background(), "")
	if err != nil {
		return
	}
	for _, r := range repos {
		dir := filepath.Join(repoDir, r.Slug+".git")
		var total int64
		_ = filepath.Walk(dir, func(_ string, info os.FileInfo, err error) error {
			if err == nil && !info.IsDir() {
				total += info.Size()
			}
			return nil
		})
		if total != r.SizeBytes {
			_ = st.UpdateSizeBytes(context.Background(), r.ID, total)
		}
	}
}

func ensureDefaultNamespace(st *store.Store) {
	nss, err := st.ListNamespaces(context.Background())
	if err != nil {
		return
	}
	if len(nss) == 0 {
		_ = st.UpsertNamespace(context.Background(), "default")
	}
}
