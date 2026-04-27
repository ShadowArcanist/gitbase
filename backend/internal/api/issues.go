package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/shadowarcanist/gitbase/internal/store"
)

// Issues

type createIssueReq struct {
	Title    string  `json:"title"`
	Body     string  `json:"body"`
	LabelIDs []int64 `json:"label_ids"`
}

func (s *Server) createIssue(w http.ResponseWriter, r *http.Request) {
	repo, ok := s.loadRepo(w, r)
	if !ok {
		return
	}
	var req createIssueReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, 400, err)
		return
	}
	if req.Title == "" {
		writeErr(w, 400, errors.New("title required"))
		return
	}
	iss, err := s.Store.CreateIssue(r.Context(), repo.ID, req.Title, req.Body, req.LabelIDs)
	if err != nil {
		writeErr(w, 500, err)
		return
	}
	_ = s.Store.RecordEvent(r.Context(), store.Event{
		Kind: "issue.created", TargetKind: "repo", Target: repo.Slug,
		Message: "Issue #" + strconv.Itoa(iss.Number) + " created: " + iss.Title,
	})
	writeJSON(w, 201, iss)
}

func (s *Server) listIssues(w http.ResponseWriter, r *http.Request) {
	repo, ok := s.loadRepo(w, r)
	if !ok {
		return
	}
	state := r.URL.Query().Get("state")
	if state == "" {
		state = "open"
	}
	issues, err := s.Store.ListIssues(r.Context(), repo.ID, state)
	if err != nil {
		writeErr(w, 500, err)
		return
	}
	open, closed, _ := s.Store.IssueCountByState(r.Context(), repo.ID)
	writeJSON(w, 200, map[string]any{
		"issues":       issues,
		"open_count":   open,
		"closed_count": closed,
	})
}

func (s *Server) getIssue(w http.ResponseWriter, r *http.Request) {
	repo, ok := s.loadRepo(w, r)
	if !ok {
		return
	}
	num, err := strconv.Atoi(chi.URLParam(r, "number"))
	if err != nil {
		writeErr(w, 400, errors.New("invalid issue number"))
		return
	}
	iss, err := s.Store.GetIssue(r.Context(), repo.ID, num)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeErr(w, 404, err)
		} else {
			writeErr(w, 500, err)
		}
		return
	}
	comments, _ := s.Store.ListComments(r.Context(), iss.ID)
	if comments == nil {
		comments = []store.IssueComment{}
	}
	writeJSON(w, 200, map[string]any{
		"issue":    iss,
		"comments": comments,
	})
}

type patchIssueReq struct {
	Title       *string `json:"title"`
	Body        *string `json:"body"`
	State       *string `json:"state"`
	StateReason *string `json:"state_reason"`
	LabelIDs    *[]int64 `json:"label_ids"`
}

func (s *Server) patchIssue(w http.ResponseWriter, r *http.Request) {
	repo, ok := s.loadRepo(w, r)
	if !ok {
		return
	}
	num, err := strconv.Atoi(chi.URLParam(r, "number"))
	if err != nil {
		writeErr(w, 400, errors.New("invalid issue number"))
		return
	}
	var req patchIssueReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, 400, err)
		return
	}
	if req.LabelIDs != nil {
		iss, err := s.Store.GetIssue(r.Context(), repo.ID, num)
		if err != nil {
			if errors.Is(err, store.ErrNotFound) {
				writeErr(w, 404, err)
			} else {
				writeErr(w, 500, err)
			}
			return
		}
		if err := s.Store.SetIssueLabels(r.Context(), iss.ID, *req.LabelIDs); err != nil {
			writeErr(w, 500, err)
			return
		}
	}
	updated, err := s.Store.UpdateIssue(r.Context(), repo.ID, num, store.IssuePatch{
		Title:       req.Title,
		Body:        req.Body,
		State:       req.State,
		StateReason: req.StateReason,
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

func (s *Server) deleteIssue(w http.ResponseWriter, r *http.Request) {
	repo, ok := s.loadRepo(w, r)
	if !ok {
		return
	}
	num, err := strconv.Atoi(chi.URLParam(r, "number"))
	if err != nil {
		writeErr(w, 400, errors.New("invalid issue number"))
		return
	}
	if err := s.Store.DeleteIssue(r.Context(), repo.ID, num); err != nil {
		writeErr(w, 500, err)
		return
	}
	w.WriteHeader(204)
}

// Comments

type createCommentReq struct {
	Body string `json:"body"`
}

func (s *Server) createComment(w http.ResponseWriter, r *http.Request) {
	repo, ok := s.loadRepo(w, r)
	if !ok {
		return
	}
	num, err := strconv.Atoi(chi.URLParam(r, "number"))
	if err != nil {
		writeErr(w, 400, errors.New("invalid issue number"))
		return
	}
	iss, err := s.Store.GetIssue(r.Context(), repo.ID, num)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeErr(w, 404, err)
		} else {
			writeErr(w, 500, err)
		}
		return
	}
	var req createCommentReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, 400, err)
		return
	}
	if req.Body == "" {
		writeErr(w, 400, errors.New("body required"))
		return
	}
	comment, err := s.Store.CreateComment(r.Context(), iss.ID, req.Body)
	if err != nil {
		writeErr(w, 500, err)
		return
	}
	writeJSON(w, 201, comment)
}

func (s *Server) deleteComment(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "commentID"), 10, 64)
	if err != nil {
		writeErr(w, 400, errors.New("invalid comment id"))
		return
	}
	if err := s.Store.DeleteComment(r.Context(), id); err != nil {
		writeErr(w, 500, err)
		return
	}
	w.WriteHeader(204)
}

type updateCommentReq struct {
	Body string `json:"body"`
}

func (s *Server) updateComment(w http.ResponseWriter, r *http.Request) {
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
	comment, err := s.Store.UpdateComment(r.Context(), id, req.Body)
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

// Labels

type createLabelReq struct {
	Name        string `json:"name"`
	Color       string `json:"color"`
	Description string `json:"description"`
}

func (s *Server) createLabel(w http.ResponseWriter, r *http.Request) {
	repo, ok := s.loadRepo(w, r)
	if !ok {
		return
	}
	var req createLabelReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, 400, err)
		return
	}
	if req.Name == "" {
		writeErr(w, 400, errors.New("name required"))
		return
	}
	label, err := s.Store.CreateLabel(r.Context(), repo.ID, req.Name, req.Color, req.Description)
	if err != nil {
		if errors.Is(err, store.ErrExists) {
			writeErr(w, 409, err)
		} else {
			writeErr(w, 500, err)
		}
		return
	}
	writeJSON(w, 201, label)
}

func (s *Server) listLabels(w http.ResponseWriter, r *http.Request) {
	repo, ok := s.loadRepo(w, r)
	if !ok {
		return
	}
	labels, err := s.Store.ListLabels(r.Context(), repo.ID)
	if err != nil {
		writeErr(w, 500, err)
		return
	}
	writeJSON(w, 200, labels)
}

type updateLabelReq struct {
	Name        *string `json:"name"`
	Color       *string `json:"color"`
	Description *string `json:"description"`
}

func (s *Server) updateLabel(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "labelID"), 10, 64)
	if err != nil {
		writeErr(w, 400, errors.New("invalid label id"))
		return
	}
	var req updateLabelReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, 400, err)
		return
	}
	label, err := s.Store.UpdateLabel(r.Context(), id, req.Name, req.Color, req.Description)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeErr(w, 404, err)
		} else {
			writeErr(w, 500, err)
		}
		return
	}
	writeJSON(w, 200, label)
}

func (s *Server) deleteLabel(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "labelID"), 10, 64)
	if err != nil {
		writeErr(w, 400, errors.New("invalid label id"))
		return
	}
	if err := s.Store.DeleteLabel(r.Context(), id); err != nil {
		writeErr(w, 500, err)
		return
	}
	w.WriteHeader(204)
}
