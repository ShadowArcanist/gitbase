package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/shadowarcanist/gitbase/internal/store"
)

type createPRReq struct {
	Title      string  `json:"title"`
	Body       string  `json:"body"`
	HeadBranch string  `json:"head_branch"`
	BaseBranch string  `json:"base_branch"`
	IsDraft    bool    `json:"is_draft"`
	LabelIDs   []int64 `json:"label_ids"`
}

func (s *Server) createPR(w http.ResponseWriter, r *http.Request) {
	repo, ok := s.loadRepo(w, r)
	if !ok {
		return
	}
	var req createPRReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, 400, err)
		return
	}
	if req.Title == "" {
		writeErr(w, 400, errors.New("title required"))
		return
	}
	if req.HeadBranch == "" || req.BaseBranch == "" {
		writeErr(w, 400, errors.New("head_branch and base_branch required"))
		return
	}
	if req.HeadBranch == req.BaseBranch {
		writeErr(w, 400, errors.New("head and base branches must differ"))
		return
	}
	repoPath := s.repoPath(repo.Slug)
	if !s.Git.BranchExists(r.Context(), repoPath, req.HeadBranch) {
		writeErr(w, 400, errors.New("head branch does not exist"))
		return
	}
	if !s.Git.BranchExists(r.Context(), repoPath, req.BaseBranch) {
		writeErr(w, 400, errors.New("base branch does not exist"))
		return
	}
	diff, _ := s.Git.BranchDiff(r.Context(), repoPath, req.BaseBranch, req.HeadBranch)
	if diff.Ahead == 0 {
		writeErr(w, 400, errors.New("head branch has no new commits compared to base branch"))
		return
	}
	pr, err := s.Store.CreatePullRequest(r.Context(), repo.ID, req.Title, req.Body, req.HeadBranch, req.BaseBranch, req.IsDraft, req.LabelIDs)
	if err != nil {
		writeErr(w, 500, err)
		return
	}
	_ = s.Store.RecordEvent(r.Context(), store.Event{
		Kind: "pr.created", TargetKind: "repo", Target: repo.Slug,
		Message: fmt.Sprintf("PR #%d created: %s", pr.Number, pr.Title),
	})
	writeJSON(w, 201, pr)
}

func (s *Server) listPRs(w http.ResponseWriter, r *http.Request) {
	repo, ok := s.loadRepo(w, r)
	if !ok {
		return
	}
	state := r.URL.Query().Get("state")
	if state == "" {
		state = "open"
	}
	prs, err := s.Store.ListPullRequests(r.Context(), repo.ID, state)
	if err != nil {
		writeErr(w, 500, err)
		return
	}
	repoPath := s.repoPath(repo.Slug)
	type prWithStats struct {
		store.PullRequest
		Additions int `json:"additions"`
		Deletions int `json:"deletions"`
	}
	items := make([]prWithStats, len(prs))
	for i, pr := range prs {
		items[i].PullRequest = pr
		if pr.MergeCommitSHA != "" {
			c, _, _ := s.Git.Show(r.Context(), repoPath, pr.MergeCommitSHA)
			if c.SHA != "" && len(c.Parents) > 0 {
				diff, _ := s.Git.MergedDiff(r.Context(), repoPath, c.Parents[0], pr.MergeCommitSHA)
				adds, dels, _ := countPatchStats(diff)
				items[i].Additions = adds
				items[i].Deletions = dels
			}
		} else if s.Git.BranchExists(r.Context(), repoPath, pr.HeadBranch) && s.Git.BranchExists(r.Context(), repoPath, pr.BaseBranch) {
			adds, dels, _, _ := s.Git.DiffStats(r.Context(), repoPath, pr.BaseBranch, pr.HeadBranch)
			items[i].Additions = adds
			items[i].Deletions = dels
		}
	}
	open, merged, closed, _ := s.Store.PRCountByState(r.Context(), repo.ID)
	writeJSON(w, 200, map[string]any{
		"pull_requests": items,
		"open_count":    open,
		"merged_count":  merged,
		"closed_count":  closed,
	})
}

func (s *Server) getPR(w http.ResponseWriter, r *http.Request) {
	repo, ok := s.loadRepo(w, r)
	if !ok {
		return
	}
	num, err := strconv.Atoi(chi.URLParam(r, "prNumber"))
	if err != nil {
		writeErr(w, 400, errors.New("invalid pr number"))
		return
	}
	pr, err := s.Store.GetPullRequest(r.Context(), repo.ID, num)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeErr(w, 404, err)
		} else {
			writeErr(w, 500, err)
		}
		return
	}
	comments, _ := s.Store.ListPRComments(r.Context(), pr.ID)
	if comments == nil {
		comments = []store.PRComment{}
	}

	repoPath := s.repoPath(repo.Slug)
	headExists := s.Git.BranchExists(r.Context(), repoPath, pr.HeadBranch)
	baseExists := s.Git.BranchExists(r.Context(), repoPath, pr.BaseBranch)

	resp := map[string]any{
		"pull_request":  pr,
		"comments":      comments,
		"head_exists":   headExists,
		"base_exists":   baseExists,
	}

	if pr.State == "merged" && pr.MergeCommitSHA != "" {
		c, _, _ := s.Git.Show(r.Context(), repoPath, pr.MergeCommitSHA)
		if c.SHA != "" && len(c.Parents) > 0 {
			parent := c.Parents[0]
			diff, _ := s.Git.MergedDiff(r.Context(), repoPath, parent, pr.MergeCommitSHA)
			commits, _ := s.Git.MergedCommits(r.Context(), repoPath, parent, pr.MergeCommitSHA)
			adds, dels, files := countPatchStats(diff)
			resp["diff"] = diff
			resp["commits"] = commits
			resp["ahead"] = len(commits)
			resp["additions"] = adds
			resp["deletions"] = dels
			resp["changed_files"] = files
		}
	} else if headExists && baseExists && pr.State == "open" {
		canMerge, _ := s.Git.CanMerge(r.Context(), repoPath, pr.BaseBranch, pr.HeadBranch)
		diff, _ := s.Git.BranchDiff(r.Context(), repoPath, pr.BaseBranch, pr.HeadBranch)
		commits, _ := s.Git.LogBetween(r.Context(), repoPath, pr.BaseBranch, pr.HeadBranch, 100)
		adds, dels, files, _ := s.Git.DiffStats(r.Context(), repoPath, pr.BaseBranch, pr.HeadBranch)
		resp["can_merge"] = canMerge
		resp["diff"] = diff.Patch
		resp["ahead"] = diff.Ahead
		resp["behind"] = diff.Behind
		resp["commits"] = commits
		resp["additions"] = adds
		resp["deletions"] = dels
		resp["changed_files"] = files
	} else if headExists && baseExists {
		diff, _ := s.Git.BranchDiff(r.Context(), repoPath, pr.BaseBranch, pr.HeadBranch)
		commits, _ := s.Git.LogBetween(r.Context(), repoPath, pr.BaseBranch, pr.HeadBranch, 100)
		adds, dels, files, _ := s.Git.DiffStats(r.Context(), repoPath, pr.BaseBranch, pr.HeadBranch)
		resp["diff"] = diff.Patch
		resp["ahead"] = diff.Ahead
		resp["behind"] = diff.Behind
		resp["commits"] = commits
		resp["additions"] = adds
		resp["deletions"] = dels
		resp["changed_files"] = files
	}

	writeJSON(w, 200, resp)
}

type patchPRReq struct {
	Title    *string  `json:"title"`
	Body     *string  `json:"body"`
	State    *string  `json:"state"`
	IsDraft  *bool    `json:"is_draft"`
	LabelIDs *[]int64 `json:"label_ids"`
}

func (s *Server) patchPR(w http.ResponseWriter, r *http.Request) {
	repo, ok := s.loadRepo(w, r)
	if !ok {
		return
	}
	num, err := strconv.Atoi(chi.URLParam(r, "prNumber"))
	if err != nil {
		writeErr(w, 400, errors.New("invalid pr number"))
		return
	}
	var req patchPRReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, 400, err)
		return
	}
	if req.LabelIDs != nil {
		pr, err := s.Store.GetPullRequest(r.Context(), repo.ID, num)
		if err != nil {
			if errors.Is(err, store.ErrNotFound) {
				writeErr(w, 404, err)
			} else {
				writeErr(w, 500, err)
			}
			return
		}
		if err := s.Store.SetPRLabels(r.Context(), pr.ID, *req.LabelIDs); err != nil {
			writeErr(w, 500, err)
			return
		}
	}
	updated, err := s.Store.UpdatePullRequest(r.Context(), repo.ID, num, store.PullRequestPatch{
		Title:   req.Title,
		Body:    req.Body,
		State:   req.State,
		IsDraft: req.IsDraft,
	})
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeErr(w, 404, err)
		} else {
			writeErr(w, 500, err)
		}
		return
	}
	writeJSON(w, 200, updated)
}

type mergePRReq struct {
	Message  string `json:"message"`
	Strategy string `json:"strategy"`
}

func (s *Server) mergePR(w http.ResponseWriter, r *http.Request) {
	repo, ok := s.loadRepo(w, r)
	if !ok {
		return
	}
	num, err := strconv.Atoi(chi.URLParam(r, "prNumber"))
	if err != nil {
		writeErr(w, 400, errors.New("invalid pr number"))
		return
	}
	var req mergePRReq
	_ = json.NewDecoder(r.Body).Decode(&req)

	pr, err := s.Store.GetPullRequest(r.Context(), repo.ID, num)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeErr(w, 404, err)
		} else {
			writeErr(w, 500, err)
		}
		return
	}
	if pr.State != "open" {
		writeErr(w, 400, errors.New("can only merge open pull requests"))
		return
	}
	repoPath := s.repoPath(repo.Slug)
	if !s.Git.BranchExists(r.Context(), repoPath, pr.HeadBranch) {
		writeErr(w, 400, errors.New("head branch no longer exists"))
		return
	}
	if !s.Git.BranchExists(r.Context(), repoPath, pr.BaseBranch) {
		writeErr(w, 400, errors.New("base branch no longer exists"))
		return
	}
	canMerge, _ := s.Git.CanMerge(r.Context(), repoPath, pr.BaseBranch, pr.HeadBranch)
	if !canMerge {
		writeErr(w, 409, errors.New("merge conflict — cannot auto-merge"))
		return
	}
	msg := req.Message
	if msg == "" {
		msg = fmt.Sprintf("Merge pull request #%d from %s\n\n%s", pr.Number, pr.HeadBranch, pr.Title)
	}
	strategy := req.Strategy
	if strategy == "" {
		strategy = "merge"
	}
	var sha string
	switch strategy {
	case "squash":
		sha, err = s.Git.SquashMerge(r.Context(), repoPath, pr.BaseBranch, pr.HeadBranch, msg)
	case "rebase":
		sha, err = s.Git.RebaseMerge(r.Context(), repoPath, pr.BaseBranch, pr.HeadBranch)
	default:
		sha, err = s.Git.Merge(r.Context(), repoPath, pr.BaseBranch, pr.HeadBranch, msg)
	}
	if err != nil {
		writeErr(w, 500, fmt.Errorf("merge failed: %w", err))
		return
	}
	merged := "merged"
	_ = s.Store.SetMergeCommitSHA(r.Context(), repo.ID, num, sha)
	updated, _ := s.Store.UpdatePullRequest(r.Context(), repo.ID, num, store.PullRequestPatch{
		State: &merged,
	})
	_ = s.Store.RecordEvent(r.Context(), store.Event{
		Kind: "pr.merged", TargetKind: "repo", Target: repo.Slug,
		Message: fmt.Sprintf("PR #%d merged: %s", pr.Number, pr.Title),
	})
	go s.updateRepoSize(repo.Slug, repo.ID)
	writeJSON(w, 200, map[string]any{
		"pull_request": updated,
		"merge_sha":    sha,
	})
}

func (s *Server) updatePRBranch(w http.ResponseWriter, r *http.Request) {
	repo, ok := s.loadRepo(w, r)
	if !ok {
		return
	}
	num, err := strconv.Atoi(chi.URLParam(r, "prNumber"))
	if err != nil {
		writeErr(w, 400, errors.New("invalid pr number"))
		return
	}
	pr, err := s.Store.GetPullRequest(r.Context(), repo.ID, num)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeErr(w, 404, err)
		} else {
			writeErr(w, 500, err)
		}
		return
	}
	if pr.State != "open" {
		writeErr(w, 400, errors.New("can only update open pull requests"))
		return
	}
	repoPath := s.repoPath(repo.Slug)
	canMerge, _ := s.Git.CanMerge(r.Context(), repoPath, pr.HeadBranch, pr.BaseBranch)
	if !canMerge {
		writeErr(w, 409, errors.New("branch cannot be updated due to conflicts"))
		return
	}
	msg := fmt.Sprintf("Merge branch '%s' into %s", pr.BaseBranch, pr.HeadBranch)
	_, err = s.Git.Merge(r.Context(), repoPath, pr.HeadBranch, pr.BaseBranch, msg)
	if err != nil {
		writeErr(w, 500, errors.New("branch cannot be updated due to conflicts"))
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true})
}

func (s *Server) deletePR(w http.ResponseWriter, r *http.Request) {
	repo, ok := s.loadRepo(w, r)
	if !ok {
		return
	}
	num, err := strconv.Atoi(chi.URLParam(r, "prNumber"))
	if err != nil {
		writeErr(w, 400, errors.New("invalid pr number"))
		return
	}
	if err := s.Store.DeletePullRequest(r.Context(), repo.ID, num); err != nil {
		writeErr(w, 500, err)
		return
	}
	w.WriteHeader(204)
}

// PR Comments

type createPRCommentReq struct {
	Body string `json:"body"`
}

func (s *Server) createPRComment(w http.ResponseWriter, r *http.Request) {
	repo, ok := s.loadRepo(w, r)
	if !ok {
		return
	}
	num, err := strconv.Atoi(chi.URLParam(r, "prNumber"))
	if err != nil {
		writeErr(w, 400, errors.New("invalid pr number"))
		return
	}
	pr, err := s.Store.GetPullRequest(r.Context(), repo.ID, num)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeErr(w, 404, err)
		} else {
			writeErr(w, 500, err)
		}
		return
	}
	var req createPRCommentReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, 400, err)
		return
	}
	if req.Body == "" {
		writeErr(w, 400, errors.New("body required"))
		return
	}
	comment, err := s.Store.CreatePRComment(r.Context(), pr.ID, req.Body)
	if err != nil {
		writeErr(w, 500, err)
		return
	}
	writeJSON(w, 201, comment)
}

func (s *Server) deletePRComment(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "commentID"), 10, 64)
	if err != nil {
		writeErr(w, 400, errors.New("invalid comment id"))
		return
	}
	if err := s.Store.DeletePRComment(r.Context(), id); err != nil {
		writeErr(w, 500, err)
		return
	}
	w.WriteHeader(204)
}

func (s *Server) updatePRComment(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "commentID"), 10, 64)
	if err != nil {
		writeErr(w, 400, errors.New("invalid comment id"))
		return
	}
	var req updateCommentReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, 400, err)
		return
	}
	if req.Body == "" {
		writeErr(w, 400, errors.New("body required"))
		return
	}
	comment, err := s.Store.UpdatePRComment(r.Context(), id, req.Body)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeErr(w, 404, err)
		} else {
			writeErr(w, 500, err)
		}
		return
	}
	writeJSON(w, 200, comment)
}

func countPatchStats(patch string) (adds, dels, files int) {
	seen := map[string]bool{}
	for _, line := range strings.Split(patch, "\n") {
		if strings.HasPrefix(line, "+++ b/") {
			f := strings.TrimPrefix(line, "+++ b/")
			if !seen[f] {
				seen[f] = true
				files++
			}
		} else if strings.HasPrefix(line, "+") && !strings.HasPrefix(line, "+++") {
			adds++
		} else if strings.HasPrefix(line, "-") && !strings.HasPrefix(line, "---") {
			dels++
		}
	}
	return
}
