package ssh

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/x509"
	"encoding/pem"
	"fmt"
	"io"
	"log"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"

	gossh "golang.org/x/crypto/ssh"

	"github.com/shadowarcanist/gitbase/internal/gitx"
	"github.com/shadowarcanist/gitbase/internal/store"
)

type Server struct {
	Host    string
	Port    int
	DataDir string
	RepoDir string
	Store   *store.Store
	Git     *gitx.Runner

	hostSigner gossh.Signer
}

var allowedCommands = map[string]bool{
	"git-upload-pack":    true,
	"git-upload-archive": true,
	"git-receive-pack":   true,
}

func (s *Server) Start() error {
	signer, err := s.loadOrGenerateHostKey()
	if err != nil {
		return fmt.Errorf("host key: %w", err)
	}
	s.hostSigner = signer

	config := &gossh.ServerConfig{
		PublicKeyCallback: s.authPublicKey,
	}
	config.AddHostKey(signer)

	addr := net.JoinHostPort(s.Host, strconv.Itoa(s.Port))
	listener, err := net.Listen("tcp", addr)
	if err != nil {
		return fmt.Errorf("listen %s: %w", addr, err)
	}

	go func() {
		for {
			conn, err := listener.Accept()
			if err != nil {
				log.Printf("ssh: accept error: %v", err)
				continue
			}
			go s.handleConn(conn, config)
		}
	}()

	return nil
}

func (s *Server) HostFingerprint() string {
	if s.hostSigner == nil {
		return ""
	}
	return gossh.FingerprintSHA256(s.hostSigner.PublicKey())
}

func (s *Server) authPublicKey(_ gossh.ConnMetadata, key gossh.PublicKey) (*gossh.Permissions, error) {
	fp := gossh.FingerprintSHA256(key)
	_, err := s.Store.FindSSHKeyByFingerprint(context.Background(), fp)
	if err != nil {
		return nil, fmt.Errorf("unknown public key")
	}
	return &gossh.Permissions{}, nil
}

func (s *Server) handleConn(netConn net.Conn, config *gossh.ServerConfig) {
	sConn, chans, reqs, err := gossh.NewServerConn(netConn, config)
	if err != nil {
		return
	}
	defer sConn.Close()
	go gossh.DiscardRequests(reqs)

	for newChan := range chans {
		if newChan.ChannelType() != "session" {
			_ = newChan.Reject(gossh.UnknownChannelType, "unknown channel type")
			continue
		}
		ch, reqs, err := newChan.Accept()
		if err != nil {
			continue
		}
		go s.handleSession(ch, reqs)
	}
}

func (s *Server) handleSession(ch gossh.Channel, reqs <-chan *gossh.Request) {
	defer ch.Close()
	for req := range reqs {
		switch req.Type {
		case "env":
			_ = req.Reply(true, nil)
		case "exec":
			s.handleExec(ch, req)
			return
		default:
			if req.WantReply {
				_ = req.Reply(false, nil)
			}
		}
	}
}

func (s *Server) handleExec(ch gossh.Channel, req *gossh.Request) {
	payload := string(req.Payload)
	if len(req.Payload) > 4 {
		payload = string(req.Payload[4:])
	}
	payload = strings.TrimSpace(payload)

	parts := strings.SplitN(payload, " ", 2)
	if len(parts) != 2 {
		_, _ = fmt.Fprintf(ch.Stderr(), "invalid command\n")
		_ = req.Reply(false, nil)
		sendExitStatus(ch, 1)
		return
	}

	cmd := parts[0]
	if !allowedCommands[cmd] {
		_, _ = fmt.Fprintf(ch.Stderr(), "command not allowed: %s\n", cmd)
		_ = req.Reply(false, nil)
		sendExitStatus(ch, 1)
		return
	}

	repoPath := strings.Trim(parts[1], "' \"")
	repoPath = strings.TrimPrefix(repoPath, "/")
	repoPath = strings.TrimSuffix(repoPath, ".git")

	if repoPath == "" || !gitx.ValidSlug(repoPath) {
		_, _ = fmt.Fprintf(ch.Stderr(), "invalid repository path\n")
		_ = req.Reply(true, nil)
		sendExitStatus(ch, 1)
		return
	}

	if _, err := s.Store.GetBySlug(context.Background(), repoPath); err != nil {
		_, _ = fmt.Fprintf(ch.Stderr(), "repository not found: %s\n", repoPath)
		_ = req.Reply(true, nil)
		sendExitStatus(ch, 1)
		return
	}

	repoDir := filepath.Join(s.RepoDir, repoPath+".git")
	if _, err := os.Stat(repoDir); err != nil {
		_, _ = fmt.Fprintf(ch.Stderr(), "repository not found\n")
		_ = req.Reply(true, nil)
		sendExitStatus(ch, 1)
		return
	}

	_ = s.Git.EnableHTTP(context.Background(), repoDir)

	gitCmd := strings.TrimPrefix(cmd, "git-")
	execCmd := exec.Command("git", gitCmd, repoDir)
	execCmd.Dir = repoDir
	execCmd.Env = append(os.Environ(),
		"GIT_CONFIG_COUNT=1",
		"GIT_CONFIG_KEY_0=safe.directory",
		"GIT_CONFIG_VALUE_0=*",
	)

	stdin, _ := execCmd.StdinPipe()
	stdout, _ := execCmd.StdoutPipe()
	stderr, _ := execCmd.StderrPipe()

	if err := execCmd.Start(); err != nil {
		_, _ = fmt.Fprintf(ch.Stderr(), "failed to start git: %v\n", err)
		_ = req.Reply(true, nil)
		sendExitStatus(ch, 1)
		return
	}

	_ = req.Reply(true, nil)

	go func() {
		_, _ = io.Copy(stdin, ch)
		_ = stdin.Close()
	}()

	_, _ = io.Copy(ch, stdout)
	_, _ = io.Copy(ch.Stderr(), stderr)

	exitCode := 0
	if err := execCmd.Wait(); err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			exitCode = exitErr.ExitCode()
		} else {
			exitCode = 1
		}
	}

	sendExitStatus(ch, exitCode)

	if cmd == "git-receive-pack" {
		s.syncAfterPush(repoPath, repoDir)
	}
}

func sendExitStatus(ch gossh.Channel, code int) {
	b := []byte{0, 0, 0, 0}
	b[3] = byte(code)
	_, _ = ch.SendRequest("exit-status", false, b)
}

func (s *Server) syncAfterPush(slug, repoDir string) {
	ctx := context.Background()
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
	go func() {
		var total int64
		_ = filepath.Walk(repoDir, func(_ string, info os.FileInfo, err error) error {
			if err == nil && !info.IsDir() {
				total += info.Size()
			}
			return nil
		})
		_ = s.Store.UpdateSizeBytes(context.Background(), repo.ID, total)
	}()
}

func (s *Server) loadOrGenerateHostKey() (gossh.Signer, error) {
	dir := filepath.Join(s.DataDir, "ssh")
	keyPath := filepath.Join(dir, "gitbase_ed25519")

	data, err := os.ReadFile(keyPath)
	if err == nil {
		block, _ := pem.Decode(data)
		if block != nil {
			key, err := x509.ParsePKCS8PrivateKey(block.Bytes)
			if err == nil {
				return gossh.NewSignerFromKey(key)
			}
		}
	}

	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}

	_, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return nil, err
	}

	pkcs8, err := x509.MarshalPKCS8PrivateKey(priv)
	if err != nil {
		return nil, err
	}

	pemData := pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: pkcs8})
	if err := os.WriteFile(keyPath, pemData, 0o600); err != nil {
		return nil, err
	}

	log.Printf("SSH: Generated new ed25519 host key at %s", keyPath)
	return gossh.NewSignerFromKey(priv)
}
