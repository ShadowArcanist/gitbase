package api

import (
	"compress/gzip"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
)

func packetWrite(s string) []byte {
	hex := strconv.FormatInt(int64(len(s)+4), 16)
	for len(hex)%4 != 0 {
		hex = "0" + hex
	}
	return []byte(hex + s)
}

func (s *Server) gitHTTP(w http.ResponseWriter, r *http.Request) {
	rest := strings.TrimPrefix(r.URL.Path, "/git")
	if rest == "" || rest[0] != '/' {
		http.NotFound(w, r)
		return
	}

	idx := strings.Index(rest, ".git")
	if idx <= 0 {
		http.NotFound(w, r)
		return
	}
	slug := strings.TrimPrefix(rest[:idx], "/")
	repoDir := filepath.Join(s.Cfg.RepoDir, slug+".git")
	st, err := os.Stat(repoDir)
	if err != nil || !st.IsDir() {
		http.Error(w, "repository not found: "+slug, http.StatusNotFound)
		return
	}
	_ = s.Git.EnableHTTP(r.Context(), repoDir)

	suffix := rest[idx+4:]

	switch {
	case suffix == "/info/refs" && r.Method == http.MethodGet:
		s.serveInfoRefs(w, r, repoDir)
	case suffix == "/git-upload-pack" && r.Method == http.MethodPost:
		s.serviceRPC(w, r, repoDir, "upload-pack")
	case suffix == "/git-receive-pack" && r.Method == http.MethodPost:
		s.serviceRPC(w, r, repoDir, "receive-pack")
		s.syncRepoStateAfterPush(r, slug, repoDir)
	case suffix == "/HEAD" && r.Method == http.MethodGet:
		s.serveGitFile(w, repoDir, "HEAD", "text/plain")
	case strings.HasPrefix(suffix, "/objects/") && r.Method == http.MethodGet:
		s.serveGitObject(w, repoDir, suffix)
	default:
		http.NotFound(w, r)
	}
}

func (s *Server) serveInfoRefs(w http.ResponseWriter, r *http.Request, repoDir string) {
	service := r.FormValue("service")
	if !strings.HasPrefix(service, "git-") {
		http.NotFound(w, r)
		return
	}
	service = strings.TrimPrefix(service, "git-")
	if service != "upload-pack" && service != "receive-pack" {
		http.NotFound(w, r)
		return
	}

	cmd := exec.CommandContext(r.Context(), "git", service, "--stateless-rpc", "--advertise-refs", ".")
	cmd.Dir = repoDir
	cmd.Env = append(os.Environ(), "GIT_CONFIG_COUNT=1", "GIT_CONFIG_KEY_0=safe.directory", "GIT_CONFIG_VALUE_0=*")
	refs, err := cmd.Output()
	if err != nil {
		log.Printf("git-http: info/refs %s error: %v", service, err)
		http.Error(w, "git error", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", fmt.Sprintf("application/x-git-%s-advertisement", service))
	w.Header().Set("Cache-Control", "no-cache")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(packetWrite("# service=git-" + service + "\n"))
	_, _ = w.Write([]byte("0000"))
	_, _ = w.Write(refs)
}

func (s *Server) serviceRPC(w http.ResponseWriter, r *http.Request, repoDir, service string) {
	expected := fmt.Sprintf("application/x-git-%s-request", service)
	if r.Header.Get("Content-Type") != expected {
		http.Error(w, "invalid content type", http.StatusBadRequest)
		return
	}

	var body io.ReadCloser = r.Body
	if r.Header.Get("Content-Encoding") == "gzip" {
		gz, err := gzip.NewReader(r.Body)
		if err != nil {
			http.Error(w, "bad gzip", http.StatusBadRequest)
			return
		}
		defer gz.Close()
		body = gz
	}

	w.Header().Set("Content-Type", fmt.Sprintf("application/x-git-%s-result", service))

	cmd := exec.CommandContext(r.Context(), "git", service, "--stateless-rpc", repoDir)
	cmd.Dir = repoDir
	cmd.Env = append(os.Environ(), "GIT_CONFIG_COUNT=1", "GIT_CONFIG_KEY_0=safe.directory", "GIT_CONFIG_VALUE_0=*")
	cmd.Stdin = body
	cmd.Stdout = w
	var stderr strings.Builder
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		log.Printf("git-http: %s error: %v — %s", service, err, stderr.String())
	}
}

func (s *Server) serveGitFile(w http.ResponseWriter, repoDir, file, contentType string) {
	p := filepath.Join(repoDir, file)
	fi, err := os.Stat(p)
	if err != nil {
		http.NotFound(w, nil)
		return
	}
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Content-Length", fmt.Sprintf("%d", fi.Size()))
	f, err := os.Open(p)
	if err != nil {
		http.NotFound(w, nil)
		return
	}
	defer f.Close()
	_, _ = io.Copy(w, f)
}

func (s *Server) serveGitObject(w http.ResponseWriter, repoDir, suffix string) {
	rel := strings.TrimPrefix(suffix, "/")
	p := filepath.Join(repoDir, rel)
	fi, err := os.Stat(p)
	if err != nil {
		http.NotFound(w, nil)
		return
	}
	var ct string
	switch {
	case strings.HasSuffix(rel, ".pack"):
		ct = "application/x-git-packed-objects"
	case strings.HasSuffix(rel, ".idx"):
		ct = "application/x-git-packed-objects-toc"
	default:
		ct = "application/x-git-loose-object"
	}
	w.Header().Set("Content-Type", ct)
	w.Header().Set("Content-Length", fmt.Sprintf("%d", fi.Size()))
	w.Header().Set("Cache-Control", "public, max-age=31536000")
	f, err := os.Open(p)
	if err != nil {
		http.NotFound(w, nil)
		return
	}
	defer f.Close()
	_, _ = io.Copy(w, f)
}

func (s *Server) syncRepoStateAfterPush(r *http.Request, slug, repoDir string) {
	ctx := r.Context()
	branches, err := s.Git.ListBranches(ctx, repoDir)
	if err != nil || len(branches) == 0 {
		return
	}
	repo, err := s.Store.GetBySlug(ctx, slug)
	if err != nil {
		return
	}
	hasBranch := func(name string) bool {
		for _, b := range branches {
			if b.Name == name {
				return true
			}
		}
		return false
	}
	chosen := ""
	if repo.DefaultBranch != "" && hasBranch(repo.DefaultBranch) {
		chosen = repo.DefaultBranch
	} else {
		for _, pref := range []string{"main", "master", "trunk", "develop"} {
			if hasBranch(pref) {
				chosen = pref
				break
			}
		}
		if chosen == "" {
			chosen = branches[0].Name
		}
	}
	head, _ := s.Git.ResolveHEAD(ctx, repoDir)
	if head != chosen {
		_ = s.Git.SetHEAD(ctx, repoDir, chosen)
	}
	if repo.DefaultBranch != chosen {
		_ = s.Store.UpdateDefaultBranch(ctx, repo.ID, chosen)
	}
	go s.updateRepoSize(repo.Slug, repo.ID)
}
