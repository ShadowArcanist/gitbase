package gitx

import (
	"bufio"
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"time"
)

var (
	ErrNotFound = errors.New("not found")
	ErrBinary   = errors.New("binary content")
)

var (
	reSHA   = regexp.MustCompile(`^[0-9a-fA-F]{4,40}$`)
	reRef   = regexp.MustCompile(`^[A-Za-z0-9._\-/]+$`)
	rePath  = regexp.MustCompile(`^[^\x00]*$`)
	reSlug  = regexp.MustCompile(`^[a-z0-9]+(?:[-_.a-z0-9]+)*(?:/[a-z0-9]+(?:[-_.a-z0-9]+)*)*$`)
)

func ValidSHA(s string) bool    { return reSHA.MatchString(s) }
func ValidRef(s string) bool    { return s != "" && reRef.MatchString(s) && !strings.Contains(s, "..") }
func ValidPath(s string) bool   { return rePath.MatchString(s) && !strings.Contains(s, "..") }
func ValidSlug(s string) bool   { return reSlug.MatchString(s) }

type Runner struct {
	GitBin string
	Tmp    string
}

func New(tmp string) *Runner {
	return &Runner{GitBin: "git", Tmp: tmp}
}

func (r *Runner) run(ctx context.Context, repoDir string, stdin io.Reader, args ...string) ([]byte, error) {
	full := args
	if repoDir != "" {
		full = append([]string{"--git-dir=" + repoDir}, args...)
	}
	cmd := exec.CommandContext(ctx, r.GitBin, full...)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if stdin != nil {
		cmd.Stdin = stdin
	}
	cmd.Env = append(cmd.Environ(),
		"GIT_TERMINAL_PROMPT=0",
		"GIT_ASKPASS=/bin/true",
	)
	if err := cmd.Run(); err != nil {
		return nil, fmt.Errorf("git %s: %w: %s", strings.Join(args, " "), err, strings.TrimSpace(stderr.String()))
	}
	return stdout.Bytes(), nil
}

func (r *Runner) InitBare(ctx context.Context, repoDir string) error {
	if _, err := r.run(ctx, "", nil, "init", "--bare", repoDir); err != nil {
		return err
	}
	_, _ = r.run(ctx, repoDir, nil, "config", "http.receivepack", "true")
	_, _ = r.run(ctx, repoDir, nil, "config", "http.uploadpack", "true")
	return nil
}

func (r *Runner) EnableHTTP(ctx context.Context, repoDir string) error {
	if _, err := r.run(ctx, repoDir, nil, "config", "http.receivepack", "true"); err != nil {
		return err
	}
	_, err := r.run(ctx, repoDir, nil, "config", "http.uploadpack", "true")
	return err
}

func (r *Runner) CloneBare(ctx context.Context, url, repoDir string) error {
	_, err := r.run(ctx, "", nil, "clone", "--bare", url, repoDir)
	if err != nil {
		return err
	}
	// Remove origin remote — repo is now fully local
	_, _ = r.run(ctx, repoDir, nil, "remote", "remove", "origin")
	// Enable HTTP push/pull
	_, _ = r.run(ctx, repoDir, nil, "config", "http.receivepack", "true")
	_, _ = r.run(ctx, repoDir, nil, "config", "http.uploadpack", "true")
	return nil
}

type Ref struct {
	Name   string `json:"name"`
	Full   string `json:"full"`
	Target string `json:"target"`
	IsTag  bool   `json:"is_tag"`
}

func (r *Runner) ListBranches(ctx context.Context, repoDir string) ([]Ref, error) {
	out, err := r.run(ctx, repoDir, nil, "for-each-ref", "--format=%(refname:short)%00%(refname)%00%(objectname)", "refs/heads/")
	if err != nil {
		return nil, err
	}
	return parseRefs(out, false), nil
}

func (r *Runner) ListTags(ctx context.Context, repoDir string) ([]Ref, error) {
	out, err := r.run(ctx, repoDir, nil, "for-each-ref", "--format=%(refname:short)%00%(refname)%00%(objectname)", "refs/tags/")
	if err != nil {
		return nil, err
	}
	return parseRefs(out, true), nil
}

func parseRefs(out []byte, isTag bool) []Ref {
	lines := bytes.Split(bytes.TrimRight(out, "\n"), []byte("\n"))
	refs := make([]Ref, 0, len(lines))
	for _, ln := range lines {
		if len(ln) == 0 {
			continue
		}
		p := bytes.SplitN(ln, []byte{0}, 3)
		if len(p) < 3 {
			continue
		}
		refs = append(refs, Ref{Name: string(p[0]), Full: string(p[1]), Target: string(p[2]), IsTag: isTag})
	}
	return refs
}

func (r *Runner) ResolveHEAD(ctx context.Context, repoDir string) (string, error) {
	out, err := r.run(ctx, repoDir, nil, "symbolic-ref", "--short", "HEAD")
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(out)), nil
}

func (r *Runner) SetHEAD(ctx context.Context, repoDir, branch string) error {
	if !ValidRef(branch) {
		return errors.New("invalid ref")
	}
	_, err := r.run(ctx, repoDir, nil, "symbolic-ref", "HEAD", "refs/heads/"+branch)
	return err
}

func (r *Runner) CreateBranch(ctx context.Context, repoDir, name, source string) error {
	if !ValidRef(name) {
		return errors.New("invalid branch name")
	}
	if !ValidRef(source) && !ValidSHA(source) {
		return errors.New("invalid source")
	}
	_, err := r.run(ctx, repoDir, nil, "branch", name, source)
	return err
}

func (r *Runner) DeleteBranch(ctx context.Context, repoDir, name string) error {
	if !ValidRef(name) {
		return errors.New("invalid branch name")
	}
	_, err := r.run(ctx, repoDir, nil, "branch", "-D", name)
	return err
}

type Commit struct {
	SHA       string    `json:"sha"`
	Parents   []string  `json:"parents"`
	Author    string    `json:"author"`
	Email     string    `json:"email"`
	Date      time.Time `json:"date"`
	Committer string    `json:"committer"`
	Subject   string    `json:"subject"`
	Body      string    `json:"body"`
}

func (r *Runner) Log(ctx context.Context, repoDir, rev string, limit, skip int, pathspec string) ([]Commit, error) {
	if rev == "" {
		rev = "HEAD"
	}
	if !ValidRef(rev) && !ValidSHA(rev) {
		return nil, errors.New("invalid rev")
	}
	args := []string{
		"log",
		"--date=iso-strict",
		"--format=%H%x1f%P%x1f%an%x1f%ae%x1f%ad%x1f%cn%x1f%s%x1f%b%x1e",
	}
	if limit > 0 {
		args = append(args, fmt.Sprintf("-n%d", limit))
	}
	if skip > 0 {
		args = append(args, fmt.Sprintf("--skip=%d", skip))
	}
	args = append(args, rev)
	if pathspec != "" {
		args = append(args, "--", pathspec)
	}
	out, err := r.run(ctx, repoDir, nil, args...)
	if err != nil {
		return nil, err
	}
	return parseCommits(out), nil
}

func parseCommits(out []byte) []Commit {
	records := bytes.Split(bytes.TrimRight(out, "\x1e\n"), []byte{0x1e})
	cs := make([]Commit, 0, len(records))
	for _, rec := range records {
		rec = bytes.TrimLeft(rec, "\n")
		if len(rec) == 0 {
			continue
		}
		p := bytes.SplitN(rec, []byte{0x1f}, 8)
		if len(p) < 8 {
			continue
		}
		t, _ := time.Parse(time.RFC3339, string(p[4]))
		parents := strings.Fields(string(p[1]))
		cs = append(cs, Commit{
			SHA:       string(p[0]),
			Parents:   parents,
			Author:    string(p[2]),
			Email:     string(p[3]),
			Date:      t,
			Committer: string(p[5]),
			Subject:   string(p[6]),
			Body:      strings.TrimRight(string(p[7]), "\n"),
		})
	}
	return cs
}

func (r *Runner) Show(ctx context.Context, repoDir, sha string) (Commit, string, error) {
	cs, err := r.Log(ctx, repoDir, sha, 1, 0, "")
	if err != nil || len(cs) == 0 {
		return Commit{}, "", err
	}
	patch, err := r.run(ctx, repoDir, nil, "show", "--no-color", "--format=", sha)
	if err != nil {
		return cs[0], "", err
	}
	return cs[0], string(patch), nil
}

type TreeEntry struct {
	Mode string `json:"mode"`
	Type string `json:"type"`
	SHA  string `json:"sha"`
	Size int64  `json:"size"`
	Path string `json:"path"`
	Name string `json:"name"`
}

func (r *Runner) LsTree(ctx context.Context, repoDir, rev, path string) ([]TreeEntry, error) {
	if !ValidRef(rev) && !ValidSHA(rev) {
		return nil, errors.New("invalid rev")
	}
	if !ValidPath(path) {
		return nil, errors.New("invalid path")
	}
	target := rev + ":" + path
	if path == "" {
		target = rev
	}
	out, err := r.run(ctx, repoDir, nil, "ls-tree", "--long", "-z", target)
	if err != nil {
		msg := err.Error()
		if strings.Contains(msg, "Not a valid object name") ||
			strings.Contains(msg, "does not exist") ||
			strings.Contains(msg, "not a tree object") ||
			strings.Contains(msg, "not a tree") ||
			strings.Contains(msg, "exists on disk, but not in") {
			return nil, ErrNotFound
		}
		return nil, err
	}
	entries := []TreeEntry{}
	for _, rec := range bytes.Split(bytes.TrimRight(out, "\x00"), []byte{0}) {
		if len(rec) == 0 {
			continue
		}
		tabIdx := bytes.IndexByte(rec, '\t')
		if tabIdx < 0 {
			continue
		}
		meta := string(rec[:tabIdx])
		name := string(rec[tabIdx+1:])
		fields := strings.Fields(meta)
		if len(fields) < 3 {
			continue
		}
		var size int64
		if len(fields) >= 4 && fields[3] != "-" {
			fmt.Sscanf(fields[3], "%d", &size)
		}
		full := name
		if path != "" {
			full = strings.TrimSuffix(path, "/") + "/" + name
		}
		entries = append(entries, TreeEntry{
			Mode: fields[0], Type: fields[1], SHA: fields[2], Size: size, Name: name, Path: full,
		})
	}
	return entries, nil
}

func (r *Runner) CatFileSize(ctx context.Context, repoDir, sha string) (int64, error) {
	if !ValidSHA(sha) {
		return 0, errors.New("invalid sha")
	}
	out, err := r.run(ctx, repoDir, nil, "cat-file", "-s", sha)
	if err != nil {
		return 0, err
	}
	var n int64
	fmt.Sscanf(strings.TrimSpace(string(out)), "%d", &n)
	return n, nil
}

func (r *Runner) CatFile(ctx context.Context, repoDir, sha string, maxBytes int64) ([]byte, bool, error) {
	size, err := r.CatFileSize(ctx, repoDir, sha)
	if err != nil {
		return nil, false, err
	}
	truncated := false
	if maxBytes > 0 && size > maxBytes {
		truncated = true
	}
	out, err := r.run(ctx, repoDir, nil, "cat-file", "blob", sha)
	if err != nil {
		return nil, false, err
	}
	if truncated && int64(len(out)) > maxBytes {
		out = out[:maxBytes]
	}
	return out, truncated, nil
}

func (r *Runner) ResolveBlob(ctx context.Context, repoDir, rev, path string) (TreeEntry, error) {
	if path == "" {
		return TreeEntry{}, ErrNotFound
	}
	dir, file := splitPath(path)
	entries, err := r.LsTree(ctx, repoDir, rev, dir)
	if err != nil {
		return TreeEntry{}, err
	}
	for _, e := range entries {
		if e.Name == file {
			return e, nil
		}
	}
	return TreeEntry{}, ErrNotFound
}

func splitPath(p string) (string, string) {
	p = strings.Trim(p, "/")
	i := strings.LastIndex(p, "/")
	if i < 0 {
		return "", p
	}
	return p[:i], p[i+1:]
}

func IsBinary(b []byte) bool {
	limit := len(b)
	if limit > 8000 {
		limit = 8000
	}
	for i := 0; i < limit; i++ {
		if b[i] == 0 {
			return true
		}
	}
	return false
}

func (r *Runner) DiffTree(ctx context.Context, repoDir, sha string) (string, error) {
	if !ValidSHA(sha) {
		return "", errors.New("invalid sha")
	}
	out, err := r.run(ctx, repoDir, nil, "diff-tree", "-p", "--no-color", "--root", sha)
	if err != nil {
		return "", err
	}
	return string(out), nil
}

type BlobAtPath struct {
	SHA       string
	Size      int64
	Data      []byte
	Truncated bool
}

func (r *Runner) CatBlobAtPath(ctx context.Context, repoDir, rev, path string, maxBytes int64) (BlobAtPath, error) {
	if !ValidRef(rev) && !ValidSHA(rev) {
		return BlobAtPath{}, errors.New("invalid rev")
	}
	if path == "" || !ValidPath(path) {
		return BlobAtPath{}, errors.New("invalid path")
	}
	cmd := exec.CommandContext(ctx, r.GitBin, "--git-dir="+repoDir, "cat-file", "--batch")
	cmd.Env = append(cmd.Environ(), "GIT_TERMINAL_PROMPT=0", "GIT_ASKPASS=/bin/true")
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return BlobAtPath{}, err
	}
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return BlobAtPath{}, err
	}
	if err := cmd.Start(); err != nil {
		return BlobAtPath{}, err
	}
	defer func() {
		_ = cmd.Wait()
	}()
	io.WriteString(stdin, rev+":"+path+"\n")
	stdin.Close()

	br := bufio.NewReader(stdout)
	header, err := br.ReadString('\n')
	if err != nil {
		return BlobAtPath{}, fmt.Errorf("cat-file --batch: %w: %s", err, strings.TrimSpace(stderr.String()))
	}
	header = strings.TrimRight(header, "\n")
	if strings.HasSuffix(header, " missing") {
		return BlobAtPath{}, ErrNotFound
	}
	parts := strings.Fields(header)
	if len(parts) < 3 {
		return BlobAtPath{}, fmt.Errorf("unexpected cat-file output: %q", header)
	}
	sha, kind := parts[0], parts[1]
	if kind != "blob" {
		return BlobAtPath{}, fmt.Errorf("not a blob")
	}
	var size int64
	fmt.Sscanf(parts[2], "%d", &size)

	out := BlobAtPath{SHA: sha, Size: size}
	readN := size
	if maxBytes > 0 && size > maxBytes {
		readN = maxBytes
		out.Truncated = true
	}
	out.Data = make([]byte, readN)
	if _, err := io.ReadFull(br, out.Data); err != nil {
		return BlobAtPath{}, err
	}
	if out.Truncated {
		_, _ = io.CopyN(io.Discard, br, size-readN)
	}
	_, _ = br.Discard(1) // trailing newline
	return out, nil
}

type EntryCommitMeta struct {
	SHA     string `json:"sha"`
	Time    int64  `json:"time"`
	Author  string `json:"author"`
	Subject string `json:"subject"`
}

func (r *Runner) LastCommitsForTree(ctx context.Context, repoDir, rev, path string) (map[string]EntryCommitMeta, error) {
	if !ValidRef(rev) && !ValidSHA(rev) {
		return nil, errors.New("invalid rev")
	}
	if path != "" && !ValidPath(path) {
		return nil, errors.New("invalid path")
	}
	out := map[string]EntryCommitMeta{}
	pathPrefix := strings.Trim(path, "/")
	args := []string{
		"log",
		"--pretty=format:\x01%H\x1f%at\x1f%an\x1f%s",
		"--name-only",
		"-z",
		"--max-count=1000",
		rev,
	}
	if pathPrefix != "" {
		args = append(args, "--", pathPrefix+"/")
	}
	raw, err := r.run(ctx, repoDir, nil, args...)
	if err != nil {
		return out, nil
	}
	records := bytes.Split(raw, []byte{0x01})
	for _, rec := range records {
		rec = bytes.TrimLeft(rec, "\n\x00")
		if len(rec) == 0 {
			continue
		}
		header, rest, _ := bytes.Cut(rec, []byte{'\n'})
		fields := bytes.SplitN(header, []byte{0x1f}, 4)
		if len(fields) < 4 {
			continue
		}
		sha := string(fields[0])
		ts, _ := strconv.ParseInt(string(fields[1]), 10, 64)
		author := string(fields[2])
		subject := string(fields[3])
		fileBlob := bytes.Trim(rest, "\x00\n")
		for _, fp := range bytes.Split(fileBlob, []byte{0}) {
			if len(fp) == 0 {
				continue
			}
			rel := string(fp)
			if pathPrefix != "" {
				if !strings.HasPrefix(rel, pathPrefix+"/") {
					continue
				}
				rel = strings.TrimPrefix(rel, pathPrefix+"/")
			}
			name := rel
			if i := strings.Index(rel, "/"); i >= 0 {
				name = rel[:i]
			}
			if _, ok := out[name]; ok {
				continue
			}
			out[name] = EntryCommitMeta{
				SHA: sha, Time: ts, Author: author, Subject: subject,
			}
		}
	}
	return out, nil
}

func (r *Runner) CommitCount(ctx context.Context, repoDir, rev string) (int, error) {
	if rev == "" {
		rev = "HEAD"
	}
	if !ValidRef(rev) && !ValidSHA(rev) {
		return 0, errors.New("invalid rev")
	}
	out, err := r.run(ctx, repoDir, nil, "rev-list", "--count", rev)
	if err != nil {
		return 0, err
	}
	n, _ := strconv.Atoi(strings.TrimSpace(string(out)))
	return n, nil
}

func (r *Runner) Exists(ctx context.Context, repoDir string) bool {
	_, err := r.run(ctx, repoDir, nil, "rev-parse", "--git-dir")
	return err == nil
}
