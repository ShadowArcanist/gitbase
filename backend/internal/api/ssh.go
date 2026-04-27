package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	gossh "golang.org/x/crypto/ssh"

	"github.com/shadowarcanist/gitbase/internal/store"
)

type sshStatusResp struct {
	Enabled         bool   `json:"enabled"`
	Port            int    `json:"port"`
	HostFingerprint string `json:"host_fingerprint"`
	PublicURL       string `json:"public_url"`
}

func (s *Server) sshStatus(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, 200, sshStatusResp{
		Enabled:         s.Cfg.SSHEnabled,
		Port:            s.Cfg.SSHPort,
		HostFingerprint: s.SSHFingerprint,
		PublicURL:       s.Cfg.PublicBaseURL,
	})
}

type sshKeyResp struct {
	ID          int64  `json:"id"`
	Name        string `json:"name"`
	Fingerprint string `json:"fingerprint"`
	CreatedAt   string `json:"created_at"`
}

func (s *Server) listSSHKeys(w http.ResponseWriter, r *http.Request) {
	keys, err := s.Store.ListSSHKeys(r.Context())
	if err != nil {
		writeErr(w, 500, err)
		return
	}
	out := make([]sshKeyResp, 0, len(keys))
	for _, k := range keys {
		out = append(out, sshKeyResp{ID: k.ID, Name: k.Name, Fingerprint: k.Fingerprint, CreatedAt: k.CreatedAt})
	}
	writeJSON(w, 200, out)
}

type addSSHKeyReq struct {
	Name      string `json:"name"`
	PublicKey string `json:"public_key"`
}

func (s *Server) addSSHKey(w http.ResponseWriter, r *http.Request) {
	var req addSSHKeyReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, 400, err)
		return
	}
	name := strings.TrimSpace(req.Name)
	if name == "" {
		writeErr(w, 400, errors.New("name required"))
		return
	}
	pubKeyStr := strings.TrimSpace(req.PublicKey)
	if pubKeyStr == "" {
		writeErr(w, 400, errors.New("public_key required"))
		return
	}

	pubKey, _, _, _, err := gossh.ParseAuthorizedKey([]byte(pubKeyStr))
	if err != nil {
		writeErr(w, 400, errors.New("invalid public key format"))
		return
	}
	fp := gossh.FingerprintSHA256(pubKey)

	key, err := s.Store.CreateSSHKey(r.Context(), name, pubKeyStr, fp)
	if err != nil {
		if errors.Is(err, store.ErrExists) {
			writeErr(w, 409, errors.New("key already exists"))
			return
		}
		writeErr(w, 500, err)
		return
	}

	_ = s.Store.RecordEvent(r.Context(), store.Event{
		Kind: "ssh_key.created", TargetKind: "ssh_key", Target: name,
		Message: "SSH key added",
	})

	writeJSON(w, 201, sshKeyResp{ID: key.ID, Name: key.Name, Fingerprint: key.Fingerprint, CreatedAt: key.CreatedAt})
}

func (s *Server) deleteSSHKey(w http.ResponseWriter, r *http.Request) {
	idStr := chi.URLParam(r, "id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		writeErr(w, 400, errors.New("invalid id"))
		return
	}
	if err := s.Store.DeleteSSHKey(r.Context(), id); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeErr(w, 404, err)
			return
		}
		writeErr(w, 500, err)
		return
	}

	_ = s.Store.RecordEvent(r.Context(), store.Event{
		Kind: "ssh_key.deleted", TargetKind: "ssh_key", Target: idStr,
		Message: "SSH key removed",
	})

	w.WriteHeader(204)
}
