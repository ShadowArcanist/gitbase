package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/cors"
	"github.com/shadowarcanist/gitbase/internal/config"
	"github.com/shadowarcanist/gitbase/internal/gitx"
	"github.com/shadowarcanist/gitbase/internal/store"
	"github.com/shirou/gopsutil/v4/disk"
	psmem "github.com/shirou/gopsutil/v4/mem"
	"github.com/shirou/gopsutil/v4/process"
)

func diskUsage(path string) (used, total int64) {
	st, err := disk.Usage(path)
	if err != nil {
		return 0, 0
	}
	return int64(st.Used), int64(st.Total)
}

// memUsage returns RSS of this process and total RAM.
// In containers it reads cgroup memory stats for accurate values.
func memUsage() (used, total int64) {
	cgUsed, cgTotal := cgroupMemUsage()
	if cgUsed > 0 {
		used = cgUsed
	}
	if cgTotal > 0 {
		total = cgTotal
	}
	if used == 0 {
		p, err := process.NewProcess(int32(os.Getpid()))
		if err == nil {
			if mi, err := p.MemoryInfo(); err == nil && mi != nil {
				used = int64(mi.RSS)
			}
		}
	}
	if total == 0 {
		if v, err := psmem.VirtualMemory(); err == nil {
			total = int64(v.Total)
		}
	}
	return used, total
}

func cgroupMemUsage() (used, total int64) {
	// cgroup v2
	if b, err := os.ReadFile("/sys/fs/cgroup/memory.current"); err == nil {
		used = parseCgroupInt(b)
	}
	if b, err := os.ReadFile("/sys/fs/cgroup/memory.max"); err == nil {
		total = parseCgroupInt(b)
	}
	if used > 0 && total > 0 {
		return used, total
	}
	// cgroup v1
	if b, err := os.ReadFile("/sys/fs/cgroup/memory/memory.usage_in_bytes"); err == nil {
		used = parseCgroupInt(b)
	}
	if b, err := os.ReadFile("/sys/fs/cgroup/memory/memory.limit_in_bytes"); err == nil {
		total = parseCgroupInt(b)
	}
	// cgroup v1 reports huge number when unlimited — treat as invalid
	if total > 1<<50 {
		total = 0
	}
	return used, total
}

func parseCgroupInt(b []byte) int64 {
	s := strings.TrimSpace(string(b))
	if s == "max" || s == "" {
		return 0
	}
	v, _ := strconv.ParseInt(s, 10, 64)
	return v
}

func dirSize(path string) int64 {
	var total int64
	_ = filepath.Walk(path, func(_ string, info os.FileInfo, err error) error {
		if err != nil {
			return nil
		}
		if !info.IsDir() {
			total += info.Size()
		}
		return nil
	})
	return total
}

type Server struct {
	Cfg            config.Config
	Store          *store.Store
	Git            *gitx.Runner
	WebRoot        http.Handler
	SSHFingerprint string
}

func (s *Server) Router() http.Handler {
	r := chi.NewRouter()
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins: []string{"*"},
		AllowedMethods: []string{"GET", "POST", "PATCH", "DELETE", "OPTIONS"},
		AllowedHeaders: []string{"*"},
	}))
	r.Route("/api", func(r chi.Router) {
		r.Get("/health", s.health)
		r.Get("/stats", s.stats)
		r.Get("/activity", s.activity)
		r.Get("/settings", s.getAppSettings)
		r.Patch("/settings", s.patchAppSettings)
		r.Get("/settings/commit-avatar", s.getCommitAvatar)
		r.Post("/settings/commit-avatar", s.uploadCommitAvatar)
		r.Delete("/settings/commit-avatar", s.deleteCommitAvatar)
		r.Get("/namespaces", s.listNamespaces)
		r.Post("/namespaces", s.createNamespace)
		r.HandleFunc("/namespaces/*", s.namespaceSubrouter)
		r.Route("/ssh", func(r chi.Router) {
			r.Get("/status", s.sshStatus)
			r.Get("/keys", s.listSSHKeys)
			r.Post("/keys", s.addSSHKey)
			r.Delete("/keys/{id}", s.deleteSSHKey)
		})
		r.Route("/repos", func(r chi.Router) {
			r.Get("/", s.listRepos)
			r.Post("/", s.createRepo)
			r.HandleFunc("/*", s.repoSubrouter)
		})
	})
	r.HandleFunc("/git/*", s.gitHTTP)
	if s.WebRoot != nil {
		r.Handle("/*", s.WebRoot)
	}
	return r
}

func (s *Server) health(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, 200, map[string]any{"ok": true, "time": time.Now().UTC()})
}

type StatsResp struct {
	RepoCount      int   `json:"repo_count"`
	NamespaceCount int   `json:"namespace_count"`
	DiskUsed       int64 `json:"disk_used"`
	DiskTotal      int64 `json:"disk_total"`
	RamUsed        int64 `json:"ram_used"`
	RamTotal       int64 `json:"ram_total"`
}

func (s *Server) stats(w http.ResponseWriter, r *http.Request) {
	repos, err := s.Store.List(r.Context(), "")
	if err != nil {
		writeErr(w, 500, err)
		return
	}
	namespaces := map[string]struct{}{}
	for _, rp := range repos {
		if rp.Namespace != "" {
			namespaces[rp.Namespace] = struct{}{}
		}
	}
	if stored, err := s.Store.ListNamespaces(r.Context()); err == nil {
		for _, ns := range stored {
			namespaces[ns.Name] = struct{}{}
		}
	}
	diskUsed := dirSize(s.Cfg.DataDir)
	_, diskTotal := diskUsage(s.Cfg.DataDir)
	ramUsed, ramTotal := memUsage()
	writeJSON(w, 200, StatsResp{
		RepoCount:      len(repos),
		NamespaceCount: len(namespaces),
		DiskUsed:       diskUsed,
		DiskTotal:      diskTotal,
		RamUsed:        ramUsed,
		RamTotal:       ramTotal,
	})
}

func (s *Server) getAppSettings(w http.ResponseWriter, r *http.Request) {
	out, err := s.Store.GetAppSettings(r.Context())
	if err != nil {
		writeErr(w, 500, err)
		return
	}
	writeJSON(w, 200, out)
}

type patchAppSettingsReq struct {
	DefaultBranch *string `json:"default_branch"`
}

func (s *Server) patchAppSettings(w http.ResponseWriter, r *http.Request) {
	var req patchAppSettingsReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, 400, err)
		return
	}
	if req.DefaultBranch != nil {
		v := strings.TrimSpace(*req.DefaultBranch)
		if v == "" {
			writeErr(w, 400, errors.New("default branch required"))
			return
		}
		if !gitx.ValidRef(v) {
			writeErr(w, 400, errors.New("invalid branch"))
			return
		}
		if err := s.Store.SetAppSetting(r.Context(), "default_branch", v); err != nil {
			writeErr(w, 500, err)
			return
		}
	}
	out, err := s.Store.GetAppSettings(r.Context())
	if err != nil {
		writeErr(w, 500, err)
		return
	}
	writeJSON(w, 200, out)
}

func (s *Server) commitAvatarDir() string {
	return filepath.Join(s.Cfg.DataDir, "commit-avatar")
}

func (s *Server) uploadCommitAvatar(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseMultipartForm(8 << 20); err != nil {
		writeErr(w, 400, err)
		return
	}
	file, hdr, err := r.FormFile("image")
	if err != nil {
		writeErr(w, 400, err)
		return
	}
	defer file.Close()
	ext := strings.ToLower(filepath.Ext(hdr.Filename))
	switch ext {
	case ".png", ".jpg", ".jpeg", ".webp", ".gif":
	default:
		writeErr(w, 400, errors.New("unsupported image type"))
		return
	}
	if err := os.MkdirAll(s.commitAvatarDir(), 0o755); err != nil {
		writeErr(w, 500, err)
		return
	}
	relName := fmt.Sprintf("commit-avatar-%d%s", time.Now().UnixNano(), ext)
	dst := filepath.Join(s.commitAvatarDir(), relName)
	out, err := os.Create(dst)
	if err != nil {
		writeErr(w, 500, err)
		return
	}
	defer out.Close()
	if _, err := io.Copy(out, file); err != nil {
		writeErr(w, 500, err)
		return
	}
	cur, _ := s.Store.GetAppSettings(r.Context())
	if cur.CommitAvatar != "" {
		_ = os.Remove(filepath.Join(s.commitAvatarDir(), cur.CommitAvatar))
	}
	if err := s.Store.SetAppSetting(r.Context(), "commit_avatar", relName); err != nil {
		writeErr(w, 500, err)
		return
	}
	updated, _ := s.Store.GetAppSettings(r.Context())
	writeJSON(w, 200, updated)
}

func (s *Server) deleteCommitAvatar(w http.ResponseWriter, r *http.Request) {
	cur, _ := s.Store.GetAppSettings(r.Context())
	if cur.CommitAvatar != "" {
		_ = os.Remove(filepath.Join(s.commitAvatarDir(), cur.CommitAvatar))
	}
	_ = s.Store.SetAppSetting(r.Context(), "commit_avatar", "")
	w.WriteHeader(204)
}

func (s *Server) getCommitAvatar(w http.ResponseWriter, r *http.Request) {
	cur, _ := s.Store.GetAppSettings(r.Context())
	if cur.CommitAvatar == "" {
		http.NotFound(w, r)
		return
	}
	p := filepath.Join(s.commitAvatarDir(), cur.CommitAvatar)
	if !strings.HasPrefix(filepath.Clean(p), filepath.Clean(s.commitAvatarDir())) {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Cache-Control", "private, max-age=300")
	http.ServeFile(w, r, p)
}

func (s *Server) activity(w http.ResponseWriter, r *http.Request) {
	events, err := s.Store.ListEvents(r.Context(), 10)
	if err != nil {
		writeErr(w, 500, err)
		return
	}
	writeJSON(w, 200, events)
}

var repoActions = map[string]struct{}{
	"branches": {}, "tags": {}, "commits": {}, "commit-count": {}, "tree": {}, "tree-meta": {}, "blob": {},
	"raw": {}, "diff": {}, "readme": {}, "image": {}, "issues": {}, "labels": {},
}

func (s *Server) repoSubrouter(w http.ResponseWriter, r *http.Request) {
	rest := strings.TrimPrefix(r.URL.Path, "/api/repos/")
	rest = strings.TrimSuffix(rest, "/")
	if rest == "" {
		http.NotFound(w, r)
		return
	}
	parts := strings.Split(rest, "/")
	var slug, action, sha, branchName, issueNumber, commentID, labelID string
	last := parts[len(parts)-1]
	if _, ok := repoActions[last]; ok {
		slug = strings.Join(parts[:len(parts)-1], "/")
		action = last
	} else if len(parts) >= 2 && parts[len(parts)-2] == "commits" {
		sha = last
		action = "commits"
		slug = strings.Join(parts[:len(parts)-2], "/")
	} else if len(parts) >= 2 && parts[len(parts)-2] == "branches" {
		branchName = last
		action = "branches"
		slug = strings.Join(parts[:len(parts)-2], "/")
	} else if len(parts) >= 4 && parts[len(parts)-2] == "comments" && parts[len(parts)-4] == "issues" {
		commentID = last
		issueNumber = parts[len(parts)-3]
		action = "issue-comment"
		slug = strings.Join(parts[:len(parts)-4], "/")
	} else if len(parts) >= 3 && parts[len(parts)-1] == "comments" && parts[len(parts)-3] == "issues" {
		issueNumber = parts[len(parts)-2]
		action = "issue-comments"
		slug = strings.Join(parts[:len(parts)-3], "/")
	} else if len(parts) >= 2 && parts[len(parts)-2] == "issues" {
		issueNumber = last
		action = "issues"
		slug = strings.Join(parts[:len(parts)-2], "/")
	} else if len(parts) >= 2 && parts[len(parts)-2] == "labels" {
		labelID = last
		action = "label-detail"
		slug = strings.Join(parts[:len(parts)-2], "/")
	} else {
		slug = rest
	}
	if slug == "" {
		http.NotFound(w, r)
		return
	}
	rctx := chi.RouteContext(r.Context())
	if rctx != nil {
		rctx.URLParams.Add("slug", slug)
		if sha != "" {
			rctx.URLParams.Add("sha", sha)
		}
		if branchName != "" {
			rctx.URLParams.Add("branchName", branchName)
		}
		if issueNumber != "" {
			rctx.URLParams.Add("number", issueNumber)
		}
		if commentID != "" {
			rctx.URLParams.Add("commentID", commentID)
		}
		if labelID != "" {
			rctx.URLParams.Add("labelID", labelID)
		}
	}
	switch action {
	case "branches":
		if branchName != "" && r.Method == http.MethodDelete {
			s.deleteBranch(w, r)
			return
		}
		if r.Method == http.MethodPost {
			s.createBranch(w, r)
			return
		}
		if r.Method == http.MethodGet {
			s.listBranches(w, r)
			return
		}
	case "tags":
		if r.Method == http.MethodGet {
			s.listTags(w, r)
			return
		}
	case "commits":
		if sha != "" && r.Method == http.MethodGet {
			s.getCommit(w, r)
			return
		}
		if r.Method == http.MethodGet {
			s.listCommits(w, r)
			return
		}
	case "commit-count":
		if r.Method == http.MethodGet {
			s.commitCount(w, r)
			return
		}
	case "tree":
		if r.Method == http.MethodGet {
			s.getTree(w, r)
			return
		}
	case "tree-meta":
		if r.Method == http.MethodGet {
			s.getTreeMeta(w, r)
			return
		}
	case "blob":
		if r.Method == http.MethodGet {
			s.getBlob(w, r)
			return
		}
	case "raw":
		if r.Method == http.MethodGet {
			s.getRaw(w, r)
			return
		}
	case "diff":
		if r.Method == http.MethodGet {
			s.getDiff(w, r)
			return
		}
	case "readme":
		if r.Method == http.MethodGet {
			s.getReadme(w, r)
			return
		}
	case "image":
		if r.Method == http.MethodPost {
			s.uploadImage(w, r)
			return
		}
		if r.Method == http.MethodDelete {
			s.deleteImage(w, r)
			return
		}
		if r.Method == http.MethodGet {
			s.getImage(w, r)
			return
		}
	case "issues":
		if issueNumber != "" {
			switch r.Method {
			case http.MethodGet:
				s.getIssue(w, r)
				return
			case http.MethodPatch:
				s.patchIssue(w, r)
				return
			case http.MethodDelete:
				s.deleteIssue(w, r)
				return
			}
		} else {
			switch r.Method {
			case http.MethodGet:
				s.listIssues(w, r)
				return
			case http.MethodPost:
				s.createIssue(w, r)
				return
			}
		}
	case "issue-comments":
		if r.Method == http.MethodPost {
			s.createComment(w, r)
			return
		}
	case "issue-comment":
		switch r.Method {
		case http.MethodPatch:
			s.updateComment(w, r)
			return
		case http.MethodDelete:
			s.deleteComment(w, r)
			return
		}
	case "labels":
		switch r.Method {
		case http.MethodGet:
			s.listLabels(w, r)
			return
		case http.MethodPost:
			s.createLabel(w, r)
			return
		}
	case "label-detail":
		switch r.Method {
		case http.MethodPatch:
			s.updateLabel(w, r)
			return
		case http.MethodDelete:
			s.deleteLabel(w, r)
			return
		}
	default:
		switch r.Method {
		case http.MethodGet:
			s.getRepo(w, r)
			return
		case http.MethodPatch:
			s.patchRepo(w, r)
			return
		case http.MethodDelete:
			s.deleteRepo(w, r)
			return
		}
	}
	http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
}

func (s *Server) listRepos(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query().Get("q")
	ns := r.URL.Query().Get("namespace")
	repos, err := s.Store.List(r.Context(), q)
	if err != nil {
		writeErr(w, 500, err)
		return
	}
	if ns != "" {
		filtered := make([]store.Repo, 0)
		for _, rp := range repos {
			if rp.Namespace == ns || strings.HasPrefix(rp.Namespace, ns+"/") {
				filtered = append(filtered, rp)
			}
		}
		repos = filtered
	}
	writeJSON(w, 200, repos)
}

var namespaceActions = map[string]struct{}{
	"image": {}, "repos": {},
}

func (s *Server) namespaceSubrouter(w http.ResponseWriter, r *http.Request) {
	rest := strings.TrimPrefix(r.URL.Path, "/api/namespaces/")
	rest = strings.TrimSuffix(rest, "/")
	if rest == "" {
		http.NotFound(w, r)
		return
	}
	parts := strings.Split(rest, "/")
	var name, action string
	last := parts[len(parts)-1]
	if _, ok := namespaceActions[last]; ok {
		name = strings.Join(parts[:len(parts)-1], "/")
		action = last
	} else {
		name = rest
	}
	if name == "" {
		http.NotFound(w, r)
		return
	}
	rctx := chi.RouteContext(r.Context())
	if rctx != nil {
		rctx.URLParams.Add("name", name)
	}
	switch action {
	case "image":
		switch r.Method {
		case http.MethodPost:
			s.uploadNamespaceImage(w, r)
			return
		case http.MethodDelete:
			s.deleteNamespaceImage(w, r)
			return
		case http.MethodGet:
			s.getNamespaceImage(w, r)
			return
		}
	case "repos":
		if r.Method == http.MethodGet {
			s.listNamespaceRepos(w, r)
			return
		}
	default:
		switch r.Method {
		case http.MethodGet:
			s.getNamespace(w, r)
			return
		case http.MethodPatch:
			s.patchNamespace(w, r)
			return
		case http.MethodDelete:
			s.deleteNamespace(w, r)
			return
		}
	}
	http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
}

type createNamespaceReq struct {
	Name        string `json:"name"`
	Description string `json:"description"`
}

func (s *Server) createNamespace(w http.ResponseWriter, r *http.Request) {
	var req createNamespaceReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, 400, err)
		return
	}
	name := strings.ToLower(strings.Trim(strings.TrimSpace(req.Name), "/"))
	if name == "" {
		writeErr(w, 400, errors.New("name required"))
		return
	}
	if !gitx.ValidSlug(name) {
		writeErr(w, 400, errors.New("invalid namespace name"))
		return
	}
	if err := s.Store.UpsertNamespace(r.Context(), name); err != nil {
		writeErr(w, 500, err)
		return
	}
	if req.Description != "" {
		_ = s.Store.UpdateNamespace(r.Context(), name, store.NamespacePatch{Description: &req.Description})
	}
	ns, _ := s.Store.GetNamespace(r.Context(), name)
	_ = s.Store.RecordEvent(r.Context(), store.Event{
		Kind: "namespace.created", TargetKind: "namespace", Target: name,
		Message: "Namespace created",
	})
	writeJSON(w, 201, ns)
}

func (s *Server) getNamespace(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	ns, err := s.Store.GetNamespace(r.Context(), name)
	if err != nil {
		writeErr(w, 500, err)
		return
	}
	writeJSON(w, 200, ns)
}

type patchNamespaceReq struct {
	Description *string `json:"description"`
	NewName     *string `json:"name"`
}

func (s *Server) patchNamespace(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	var req patchNamespaceReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, 400, err)
		return
	}
	current := name
	if req.NewName != nil && strings.TrimSpace(*req.NewName) != "" && *req.NewName != name {
		newName := strings.ToLower(strings.Trim(*req.NewName, "/"))
		if !gitx.ValidSlug(newName) {
			writeErr(w, 400, errors.New("invalid namespace name"))
			return
		}
		if _, err := s.Store.ReposInNamespace(r.Context(), name); err != nil {
			writeErr(w, 500, err)
			return
		}
		oldRoot := filepath.Join(s.Cfg.RepoDir, name)
		newRoot := filepath.Join(s.Cfg.RepoDir, newName)
		if err := os.MkdirAll(filepath.Dir(newRoot), 0o755); err != nil {
			writeErr(w, 500, err)
			return
		}
		if _, err := os.Stat(oldRoot); err == nil {
			if err := os.Rename(oldRoot, newRoot); err != nil {
				writeErr(w, 500, err)
				return
			}
		}
		if err := s.Store.RenameNamespace(r.Context(), name, newName); err != nil {
			writeErr(w, 500, err)
			return
		}
		current = newName
	}
	if req.Description != nil {
		if err := s.Store.UpdateNamespace(r.Context(), current, store.NamespacePatch{Description: req.Description}); err != nil {
			writeErr(w, 500, err)
			return
		}
	}
	updated, _ := s.Store.GetNamespace(r.Context(), current)
	msg := "Namespace updated"
	if current != name {
		msg = "Namespace renamed"
	}
	_ = s.Store.RecordEvent(r.Context(), store.Event{
		Kind: "namespace.updated", TargetKind: "namespace", Target: current,
		Message: msg,
	})
	writeJSON(w, 200, updated)
}

func (s *Server) deleteNamespace(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	if err := s.Store.DeleteNamespace(r.Context(), name); err != nil {
		writeErr(w, 400, err)
		return
	}
	_ = s.Store.RecordEvent(r.Context(), store.Event{
		Kind: "namespace.deleted", TargetKind: "namespace", Target: name,
		Message: "Namespace deleted",
	})
	w.WriteHeader(204)
}

func (s *Server) listNamespaceRepos(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	repos, err := s.Store.ReposInNamespace(r.Context(), name)
	if err != nil {
		writeErr(w, 500, err)
		return
	}
	writeJSON(w, 200, repos)
}

func (s *Server) namespaceImageDir() string { return filepath.Join(s.Cfg.DataDir, "namespace-images") }

func (s *Server) uploadNamespaceImage(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	if err := r.ParseMultipartForm(8 << 20); err != nil {
		writeErr(w, 400, err)
		return
	}
	file, hdr, err := r.FormFile("image")
	if err != nil {
		writeErr(w, 400, err)
		return
	}
	defer file.Close()
	ext := strings.ToLower(filepath.Ext(hdr.Filename))
	switch ext {
	case ".png", ".jpg", ".jpeg", ".webp", ".gif":
	default:
		writeErr(w, 400, errors.New("unsupported image type"))
		return
	}
	if err := os.MkdirAll(s.namespaceImageDir(), 0o755); err != nil {
		writeErr(w, 500, err)
		return
	}
	relName := fmt.Sprintf("%s-%d%s", strings.ReplaceAll(name, "/", "_"), time.Now().UnixNano(), ext)
	dst := filepath.Join(s.namespaceImageDir(), relName)
	out, err := os.Create(dst)
	if err != nil {
		writeErr(w, 500, err)
		return
	}
	defer out.Close()
	if _, err := io.Copy(out, file); err != nil {
		writeErr(w, 500, err)
		return
	}
	current, _ := s.Store.GetNamespace(r.Context(), name)
	if current.ImagePath != "" {
		_ = os.Remove(filepath.Join(s.namespaceImageDir(), current.ImagePath))
	}
	if err := s.Store.UpdateNamespace(r.Context(), name, store.NamespacePatch{ImagePath: &relName}); err != nil {
		writeErr(w, 500, err)
		return
	}
	updated, _ := s.Store.GetNamespace(r.Context(), name)
	writeJSON(w, 200, updated)
}

func (s *Server) deleteNamespaceImage(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	current, _ := s.Store.GetNamespace(r.Context(), name)
	if current.ImagePath != "" {
		_ = os.Remove(filepath.Join(s.namespaceImageDir(), current.ImagePath))
	}
	empty := ""
	_ = s.Store.UpdateNamespace(r.Context(), name, store.NamespacePatch{ImagePath: &empty})
	w.WriteHeader(204)
}

func (s *Server) getNamespaceImage(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	ns, _ := s.Store.GetNamespace(r.Context(), name)
	if ns.ImagePath == "" {
		http.NotFound(w, r)
		return
	}
	p := filepath.Join(s.namespaceImageDir(), ns.ImagePath)
	if !strings.HasPrefix(filepath.Clean(p), filepath.Clean(s.namespaceImageDir())) {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Cache-Control", "private, max-age=300")
	http.ServeFile(w, r, p)
}

type NamespaceSummary struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	ImagePath   string `json:"image_path"`
	RepoCount   int    `json:"repo_count"`
	SizeBytes   int64  `json:"size_bytes"`
}

func (s *Server) listNamespaces(w http.ResponseWriter, r *http.Request) {
	repos, err := s.Store.List(r.Context(), "")
	if err != nil {
		writeErr(w, 500, err)
		return
	}
	m := map[string]*NamespaceSummary{}
	for _, rp := range repos {
		ns := rp.Namespace
		if ns == "" {
			ns = "(root)"
		}
		if _, ok := m[ns]; !ok {
			m[ns] = &NamespaceSummary{Name: ns}
		}
		m[ns].RepoCount++
		m[ns].SizeBytes += rp.SizeBytes
	}
	stored, _ := s.Store.ListNamespaces(r.Context())
	for _, ns := range stored {
		if _, ok := m[ns.Name]; !ok {
			m[ns.Name] = &NamespaceSummary{Name: ns.Name}
		}
		m[ns.Name].Description = ns.Description
		m[ns.Name].ImagePath = ns.ImagePath
	}
	for _, v := range m {
		if v.Description != "" || v.ImagePath != "" {
			continue
		}
		ns, _ := s.Store.GetNamespace(r.Context(), v.Name)
		v.Description = ns.Description
		v.ImagePath = ns.ImagePath
	}
	out := make([]NamespaceSummary, 0, len(m))
	for _, v := range m {
		out = append(out, *v)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	writeJSON(w, 200, out)
}

type createRepoReq struct {
	Namespace     string `json:"namespace"`
	Name          string `json:"name"`
	Description   string `json:"description"`
	DefaultBranch string `json:"default_branch"`
	ImportURL     string `json:"import_url"`
	ImportToken   string `json:"import_token"`
}

func (s *Server) createRepo(w http.ResponseWriter, r *http.Request) {
	var req createRepoReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, 400, err)
		return
	}
	if strings.TrimSpace(req.Name) == "" {
		writeErr(w, 400, errors.New("name required"))
		return
	}
	if strings.TrimSpace(req.Namespace) == "" {
		writeErr(w, 400, errors.New("namespace required"))
		return
	}
	if req.DefaultBranch == "" {
		if settings, err := s.Store.GetAppSettings(r.Context()); err == nil && settings.DefaultBranch != "" {
			req.DefaultBranch = settings.DefaultBranch
		} else {
			req.DefaultBranch = "main"
		}
	}
	slug := store.SlugFor(req.Namespace, req.Name)
	if !gitx.ValidSlug(slug) {
		writeErr(w, 400, errors.New("invalid slug derived from name/namespace"))
		return
	}
	ns := ""
	name := slug
	if i := strings.LastIndex(slug, "/"); i >= 0 {
		ns = slug[:i]
		name = slug[i+1:]
	}
	repoPath := filepath.Join(s.Cfg.RepoDir, slug+".git")
	if _, err := os.Stat(repoPath); err == nil {
		writeErr(w, 409, errors.New("repo path already exists"))
		return
	}
	if err := os.MkdirAll(filepath.Dir(repoPath), 0o755); err != nil {
		writeErr(w, 500, err)
		return
	}
	importURL := strings.TrimSpace(req.ImportURL)
	if importURL != "" {
		cloneURL := importURL
		if req.ImportToken != "" && strings.HasPrefix(cloneURL, "https://") {
			cloneURL = "https://x-access-token:" + req.ImportToken + "@" + strings.TrimPrefix(cloneURL, "https://")
		}
		if err := s.Git.CloneBare(r.Context(), cloneURL, repoPath); err != nil {
			writeErr(w, 400, fmt.Errorf("clone failed: %w", err))
			return
		}
		if head, err := s.Git.ResolveHEAD(r.Context(), repoPath); err == nil && head != "" {
			req.DefaultBranch = head
		}
	} else {
		if err := s.Git.InitBare(r.Context(), repoPath); err != nil {
			writeErr(w, 500, err)
			return
		}
	}
	_ = s.Git.SetHEAD(r.Context(), repoPath, req.DefaultBranch)
	repo, err := s.Store.Create(r.Context(), store.Repo{
		Slug: slug, Namespace: ns, Name: name,
		Description: req.Description, DefaultBranch: req.DefaultBranch,
	})
	if err != nil {
		os.RemoveAll(repoPath)
		status := 500
		if errors.Is(err, store.ErrExists) {
			status = 409
		}
		writeErr(w, status, err)
		return
	}
	_ = s.Store.RecordEvent(r.Context(), store.Event{
		Kind: "repo.created", TargetKind: "repo", Target: repo.Slug,
		Message: "Repository created",
	})
	go s.updateRepoSize(repo.Slug, repo.ID)
	writeJSON(w, 201, repo)
}

func (s *Server) getRepo(w http.ResponseWriter, r *http.Request) {
	repo, ok := s.loadRepo(w, r)
	if !ok {
		return
	}
	writeJSON(w, 200, repo)
}

type patchRepoReq struct {
	Description   *string `json:"description"`
	DefaultBranch *string `json:"default_branch"`
	Namespace     *string `json:"namespace"`
	Name          *string `json:"name"`
}

func (s *Server) patchRepo(w http.ResponseWriter, r *http.Request) {
	repo, ok := s.loadRepo(w, r)
	if !ok {
		return
	}
	body, _ := io.ReadAll(r.Body)
	var req patchRepoReq
	_ = json.Unmarshal(body, &req)
	patch := store.RepoPatch{
		Description:   req.Description,
		DefaultBranch: req.DefaultBranch,
	}
	renamed := false
	if req.Namespace != nil || req.Name != nil {
		newNS := repo.Namespace
		newName := repo.Name
		if req.Namespace != nil {
			newNS = *req.Namespace
		}
		if req.Name != nil {
			newName = *req.Name
		}
		newSlug := store.SlugFor(newNS, newName)
		if !gitx.ValidSlug(newSlug) {
			writeErr(w, 400, errors.New("invalid slug"))
			return
		}
		if newSlug != repo.Slug {
			oldPath := filepath.Join(s.Cfg.RepoDir, repo.Slug+".git")
			newPath := filepath.Join(s.Cfg.RepoDir, newSlug+".git")
			if _, err := os.Stat(newPath); err == nil {
				writeErr(w, 409, errors.New("target path exists"))
				return
			}
			if err := os.MkdirAll(filepath.Dir(newPath), 0o755); err != nil {
				writeErr(w, 500, err)
				return
			}
			if err := os.Rename(oldPath, newPath); err != nil {
				writeErr(w, 500, err)
				return
			}
			ns := ""
			nm := newSlug
			if i := strings.LastIndex(newSlug, "/"); i >= 0 {
				ns = newSlug[:i]
				nm = newSlug[i+1:]
			}
			patch.NewSlug = &newSlug
			patch.NewNamespace = ns
			patch.NewName = nm
			renamed = true
		}
	}
	if req.DefaultBranch != nil && *req.DefaultBranch != repo.DefaultBranch {
		if !gitx.ValidRef(*req.DefaultBranch) {
			writeErr(w, 400, errors.New("invalid branch"))
			return
		}
		rp := filepath.Join(s.Cfg.RepoDir, repo.Slug+".git")
		if renamed && patch.NewSlug != nil {
			rp = filepath.Join(s.Cfg.RepoDir, *patch.NewSlug+".git")
		}
		_ = s.Git.SetHEAD(r.Context(), rp, *req.DefaultBranch)
	}
	if err := s.Store.Update(r.Context(), repo.ID, patch); err != nil {
		writeErr(w, 500, err)
		return
	}
	slug := repo.Slug
	if patch.NewSlug != nil {
		slug = *patch.NewSlug
	}
	updated, _ := s.Store.GetBySlug(r.Context(), slug)
	msg := "Repository updated"
	if renamed {
		msg = "Repository renamed"
	}
	_ = s.Store.RecordEvent(r.Context(), store.Event{
		Kind: "repo.updated", TargetKind: "repo", Target: updated.Slug,
		Message: msg,
	})
	writeJSON(w, 200, updated)
}

func (s *Server) deleteRepo(w http.ResponseWriter, r *http.Request) {
	repo, ok := s.loadRepo(w, r)
	if !ok {
		return
	}
	repoPath := filepath.Join(s.Cfg.RepoDir, repo.Slug+".git")
	if err := os.RemoveAll(repoPath); err != nil {
		writeErr(w, 500, err)
		return
	}
	if err := s.Store.Delete(r.Context(), repo.ID); err != nil {
		writeErr(w, 500, err)
		return
	}
	_ = s.Store.RecordEvent(r.Context(), store.Event{
		Kind: "repo.deleted", TargetKind: "repo", Target: repo.Slug,
		Message: "Repository deleted",
	})
	w.WriteHeader(204)
}

type createBranchReq struct {
	Name   string `json:"name"`
	Source string `json:"source"`
}

func (s *Server) createBranch(w http.ResponseWriter, r *http.Request) {
	repo, ok := s.loadRepo(w, r)
	if !ok {
		return
	}
	var req createBranchReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, 400, err)
		return
	}
	name := strings.TrimSpace(req.Name)
	source := strings.TrimSpace(req.Source)
	if name == "" {
		writeErr(w, 400, errors.New("name required"))
		return
	}
	if source == "" {
		source = repo.DefaultBranch
		if source == "" {
			source = "HEAD"
		}
	}
	if err := s.Git.CreateBranch(r.Context(), s.repoPath(repo.Slug), name, source); err != nil {
		writeErr(w, 400, err)
		return
	}
	writeJSON(w, 201, map[string]any{"name": name, "source": source})
}

func (s *Server) deleteBranch(w http.ResponseWriter, r *http.Request) {
	repo, ok := s.loadRepo(w, r)
	if !ok {
		return
	}
	name := chi.URLParam(r, "branchName")
	if name == "" {
		writeErr(w, 400, errors.New("branch name required"))
		return
	}
	if name == repo.DefaultBranch {
		writeErr(w, 400, errors.New("cannot delete default branch"))
		return
	}
	head, _ := s.Git.ResolveHEAD(r.Context(), s.repoPath(repo.Slug))
	if name == head {
		writeErr(w, 400, errors.New("cannot delete current HEAD branch"))
		return
	}
	if err := s.Git.DeleteBranch(r.Context(), s.repoPath(repo.Slug), name); err != nil {
		writeErr(w, 400, err)
		return
	}
	w.WriteHeader(204)
}

func (s *Server) listBranches(w http.ResponseWriter, r *http.Request) {
	repo, ok := s.loadRepo(w, r)
	if !ok {
		return
	}
	refs, err := s.Git.ListBranches(r.Context(), s.repoPath(repo.Slug))
	if err != nil {
		writeErr(w, 500, err)
		return
	}
	head, _ := s.Git.ResolveHEAD(r.Context(), s.repoPath(repo.Slug))
	writeJSON(w, 200, map[string]any{"branches": refs, "head": head, "default_branch": repo.DefaultBranch})
}

func (s *Server) listTags(w http.ResponseWriter, r *http.Request) {
	repo, ok := s.loadRepo(w, r)
	if !ok {
		return
	}
	refs, err := s.Git.ListTags(r.Context(), s.repoPath(repo.Slug))
	if err != nil {
		writeErr(w, 500, err)
		return
	}
	writeJSON(w, 200, refs)
}

func (s *Server) listCommits(w http.ResponseWriter, r *http.Request) {
	repo, ok := s.loadRepo(w, r)
	if !ok {
		return
	}
	rev := r.URL.Query().Get("rev")
	if rev == "" {
		rev = "HEAD"
	}
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	skip, _ := strconv.Atoi(r.URL.Query().Get("skip"))
	path := r.URL.Query().Get("path")
	if path != "" && !gitx.ValidPath(path) {
		writeErr(w, 400, errors.New("invalid path"))
		return
	}
	commits, err := s.Git.Log(r.Context(), s.repoPath(repo.Slug), rev, limit, skip, path)
	if err != nil {
		if strings.Contains(err.Error(), "unknown revision") || strings.Contains(err.Error(), "does not have any commits") || strings.Contains(err.Error(), "bad revision") {
			writeJSON(w, 200, []gitx.Commit{})
			return
		}
		writeErr(w, 500, err)
		return
	}
	writeJSON(w, 200, commits)
}

func (s *Server) commitCount(w http.ResponseWriter, r *http.Request) {
	repo, ok := s.loadRepo(w, r)
	if !ok {
		return
	}
	rev := r.URL.Query().Get("rev")
	if rev == "" {
		rev = "HEAD"
	}
	n, err := s.Git.CommitCount(r.Context(), s.repoPath(repo.Slug), rev)
	if err != nil {
		if strings.Contains(err.Error(), "unknown revision") || strings.Contains(err.Error(), "does not have any commits") || strings.Contains(err.Error(), "bad revision") {
			writeJSON(w, 200, map[string]int{"count": 0})
			return
		}
		writeErr(w, 500, err)
		return
	}
	writeJSON(w, 200, map[string]int{"count": n})
}

func (s *Server) getCommit(w http.ResponseWriter, r *http.Request) {
	repo, ok := s.loadRepo(w, r)
	if !ok {
		return
	}
	sha := chi.URLParam(r, "sha")
	if !gitx.ValidSHA(sha) {
		writeErr(w, 400, errors.New("invalid sha"))
		return
	}
	c, patch, err := s.Git.Show(r.Context(), s.repoPath(repo.Slug), sha)
	if err != nil {
		writeErr(w, 500, err)
		return
	}
	writeJSON(w, 200, map[string]any{"commit": c, "patch": patch})
}

func (s *Server) getTree(w http.ResponseWriter, r *http.Request) {
	repo, ok := s.loadRepo(w, r)
	if !ok {
		return
	}
	rev := r.URL.Query().Get("rev")
	if rev == "" {
		rev = repo.DefaultBranch
		if rev == "" {
			rev = "HEAD"
		}
	}
	path := strings.Trim(r.URL.Query().Get("path"), "/")
	if !gitx.ValidRef(rev) && !gitx.ValidSHA(rev) {
		writeErr(w, 400, errors.New("invalid rev"))
		return
	}
	if path != "" && !gitx.ValidPath(path) {
		writeErr(w, 400, errors.New("invalid path"))
		return
	}
	entries, err := s.Git.LsTree(r.Context(), s.repoPath(repo.Slug), rev, path)
	if err != nil {
		if errors.Is(err, gitx.ErrNotFound) {
			if path != "" {
				parent := ""
				name := path
				if i := strings.LastIndex(path, "/"); i >= 0 {
					parent = path[:i]
					name = path[i+1:]
				}
				if parentEntries, perr := s.Git.LsTree(r.Context(), s.repoPath(repo.Slug), rev, parent); perr == nil {
					for _, e := range parentEntries {
						if e.Name == name && e.Type == "blob" {
							writeJSON(w, 200, map[string]any{
								"path":    path,
								"rev":     rev,
								"kind":    "blob",
								"entry":   e,
								"entries": []gitx.TreeEntry{},
							})
							return
						}
					}
				}
			}
			writeErr(w, 404, err)
			return
		}
		writeErr(w, 500, err)
		return
	}
	writeJSON(w, 200, map[string]any{"path": path, "rev": rev, "kind": "tree", "entries": entries})
}

func (s *Server) getTreeMeta(w http.ResponseWriter, r *http.Request) {
	repo, ok := s.loadRepo(w, r)
	if !ok {
		return
	}
	rev := r.URL.Query().Get("rev")
	if rev == "" {
		rev = repo.DefaultBranch
		if rev == "" {
			rev = "HEAD"
		}
	}
	path := strings.Trim(r.URL.Query().Get("path"), "/")
	meta, err := s.Git.LastCommitsForTree(r.Context(), s.repoPath(repo.Slug), rev, path)
	if err != nil {
		writeErr(w, 500, err)
		return
	}
	writeJSON(w, 200, map[string]any{"path": path, "rev": rev, "meta": meta})
}

func (s *Server) getBlob(w http.ResponseWriter, r *http.Request) {
	repo, ok := s.loadRepo(w, r)
	if !ok {
		return
	}
	rev, path, ok := s.revPath(w, r, repo)
	if !ok {
		return
	}
	blob, err := s.Git.CatBlobAtPath(r.Context(), s.repoPath(repo.Slug), rev, path, s.Cfg.MaxBlobBytes)
	if err != nil {
		if errors.Is(err, gitx.ErrNotFound) {
			writeErr(w, 404, err)
			return
		}
		if strings.Contains(err.Error(), "not a blob") {
			writeErr(w, 400, err)
			return
		}
		writeErr(w, 500, err)
		return
	}
	binary := gitx.IsBinary(blob.Data)
	resp := map[string]any{
		"path":      path,
		"rev":       rev,
		"sha":       blob.SHA,
		"size":      blob.Size,
		"truncated": blob.Truncated,
		"binary":    binary,
	}
	if binary {
		resp["content"] = nil
	} else {
		resp["content"] = string(blob.Data)
	}
	writeJSON(w, 200, resp)
}

func (s *Server) getRaw(w http.ResponseWriter, r *http.Request) {
	repo, ok := s.loadRepo(w, r)
	if !ok {
		return
	}
	rev, path, ok := s.revPath(w, r, repo)
	if !ok {
		return
	}
	entry, err := s.Git.ResolveBlob(r.Context(), s.repoPath(repo.Slug), rev, path)
	if err != nil {
		if errors.Is(err, gitx.ErrNotFound) {
			writeErr(w, 404, err)
			return
		}
		writeErr(w, 500, err)
		return
	}
	if entry.Type != "blob" {
		writeErr(w, 400, errors.New("not a blob"))
		return
	}
	data, _, err := s.Git.CatFile(r.Context(), s.repoPath(repo.Slug), entry.SHA, 0)
	if err != nil {
		writeErr(w, 500, err)
		return
	}
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`inline; filename=%q`, filepath.Base(path)))
	w.Write(data)
}

func (s *Server) getDiff(w http.ResponseWriter, r *http.Request) {
	repo, ok := s.loadRepo(w, r)
	if !ok {
		return
	}
	sha := r.URL.Query().Get("sha")
	if !gitx.ValidSHA(sha) {
		writeErr(w, 400, errors.New("invalid sha"))
		return
	}
	patch, err := s.Git.DiffTree(r.Context(), s.repoPath(repo.Slug), sha)
	if err != nil {
		writeErr(w, 500, err)
		return
	}
	writeJSON(w, 200, map[string]any{"sha": sha, "patch": patch})
}

func (s *Server) getReadme(w http.ResponseWriter, r *http.Request) {
	repo, ok := s.loadRepo(w, r)
	if !ok {
		return
	}
	rev := r.URL.Query().Get("rev")
	if rev == "" {
		rev = repo.DefaultBranch
		if rev == "" {
			rev = "HEAD"
		}
	}
	entries, err := s.Git.LsTree(r.Context(), s.repoPath(repo.Slug), rev, "")
	if err != nil {
		writeErr(w, 404, err)
		return
	}
	candidates := []string{"README.md", "readme.md", "Readme.md", "README.markdown", "README.MD", "README.rst", "README.txt", "README"}
	var found *gitx.TreeEntry
	for _, cand := range candidates {
		for i := range entries {
			if strings.EqualFold(entries[i].Name, cand) && entries[i].Type == "blob" {
				e := entries[i]
				found = &e
				break
			}
		}
		if found != nil {
			break
		}
	}
	if found == nil {
		writeJSON(w, 200, map[string]any{"exists": false})
		return
	}
	data, truncated, err := s.Git.CatFile(r.Context(), s.repoPath(repo.Slug), found.SHA, s.Cfg.MaxBlobBytes)
	if err != nil {
		writeErr(w, 500, err)
		return
	}
	writeJSON(w, 200, map[string]any{
		"exists":    true,
		"path":      found.Name,
		"content":   string(data),
		"truncated": truncated,
		"size":      found.Size,
	})
}

func (s *Server) imageDir() string { return filepath.Join(s.Cfg.DataDir, "images") }

func (s *Server) uploadImage(w http.ResponseWriter, r *http.Request) {
	repo, ok := s.loadRepo(w, r)
	if !ok {
		return
	}
	if err := r.ParseMultipartForm(8 << 20); err != nil {
		writeErr(w, 400, err)
		return
	}
	file, hdr, err := r.FormFile("image")
	if err != nil {
		writeErr(w, 400, err)
		return
	}
	defer file.Close()
	ext := strings.ToLower(filepath.Ext(hdr.Filename))
	switch ext {
	case ".png", ".jpg", ".jpeg", ".webp", ".gif":
	default:
		writeErr(w, 400, errors.New("unsupported image type"))
		return
	}
	if err := os.MkdirAll(s.imageDir(), 0o755); err != nil {
		writeErr(w, 500, err)
		return
	}
	relName := fmt.Sprintf("%d-%d%s", repo.ID, time.Now().UnixNano(), ext)
	dst := filepath.Join(s.imageDir(), relName)
	out, err := os.Create(dst)
	if err != nil {
		writeErr(w, 500, err)
		return
	}
	defer out.Close()
	if _, err := io.Copy(out, file); err != nil {
		writeErr(w, 500, err)
		return
	}
	if repo.ImagePath != "" {
		_ = os.Remove(filepath.Join(s.imageDir(), repo.ImagePath))
	}
	if err := s.Store.Update(r.Context(), repo.ID, store.RepoPatch{ImagePath: &relName}); err != nil {
		writeErr(w, 500, err)
		return
	}
	updated, _ := s.Store.GetBySlug(r.Context(), repo.Slug)
	writeJSON(w, 200, updated)
}

func (s *Server) deleteImage(w http.ResponseWriter, r *http.Request) {
	repo, ok := s.loadRepo(w, r)
	if !ok {
		return
	}
	if repo.ImagePath != "" {
		_ = os.Remove(filepath.Join(s.imageDir(), repo.ImagePath))
	}
	empty := ""
	if err := s.Store.Update(r.Context(), repo.ID, store.RepoPatch{ImagePath: &empty}); err != nil {
		writeErr(w, 500, err)
		return
	}
	w.WriteHeader(204)
}

func (s *Server) getImage(w http.ResponseWriter, r *http.Request) {
	repo, ok := s.loadRepo(w, r)
	if !ok {
		return
	}
	if repo.ImagePath == "" {
		http.NotFound(w, r)
		return
	}
	p := filepath.Join(s.imageDir(), repo.ImagePath)
	if !strings.HasPrefix(filepath.Clean(p), filepath.Clean(s.imageDir())) {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Cache-Control", "private, max-age=300")
	http.ServeFile(w, r, p)
}

func (s *Server) loadRepo(w http.ResponseWriter, r *http.Request) (store.Repo, bool) {
	slug := chi.URLParam(r, "slug")
	slug = strings.TrimSuffix(slug, "/")
	if !gitx.ValidSlug(slug) {
		writeErr(w, 400, errors.New("invalid slug"))
		return store.Repo{}, false
	}
	repo, err := s.Store.GetBySlug(r.Context(), slug)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeErr(w, 404, err)
		} else {
			writeErr(w, 500, err)
		}
		return store.Repo{}, false
	}
	return repo, true
}

func (s *Server) revPath(w http.ResponseWriter, r *http.Request, repo store.Repo) (string, string, bool) {
	rev := r.URL.Query().Get("rev")
	if rev == "" {
		rev = repo.DefaultBranch
		if rev == "" {
			rev = "HEAD"
		}
	}
	path := strings.Trim(r.URL.Query().Get("path"), "/")
	if !gitx.ValidRef(rev) && !gitx.ValidSHA(rev) {
		writeErr(w, 400, errors.New("invalid rev"))
		return "", "", false
	}
	if path == "" || !gitx.ValidPath(path) {
		writeErr(w, 400, errors.New("invalid path"))
		return "", "", false
	}
	return rev, path, true
}

func (s *Server) repoPath(slug string) string {
	return filepath.Join(s.Cfg.RepoDir, slug+".git")
}

func (s *Server) updateRepoSize(slug string, id int64) {
	size := dirSize(s.repoPath(slug))
	_ = s.Store.UpdateSizeBytes(context.Background(), id, size)
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, status int, err error) {
	writeJSON(w, status, map[string]any{"error": err.Error()})
}
