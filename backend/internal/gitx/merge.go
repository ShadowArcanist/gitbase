package gitx

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

type BranchDiff struct {
	Ahead  int    `json:"ahead"`
	Behind int    `json:"behind"`
	Patch  string `json:"patch"`
}

func (r *Runner) BranchDiff(ctx context.Context, repoDir, base, head string) (BranchDiff, error) {
	if !ValidRef(base) || !ValidRef(head) {
		return BranchDiff{}, fmt.Errorf("invalid ref")
	}
	var d BranchDiff
	ahead, _ := r.run(ctx, repoDir, nil, "rev-list", "--count", base+".."+head)
	d.Ahead, _ = strconv.Atoi(strings.TrimSpace(string(ahead)))
	behind, _ := r.run(ctx, repoDir, nil, "rev-list", "--count", head+".."+base)
	d.Behind, _ = strconv.Atoi(strings.TrimSpace(string(behind)))
	patch, err := r.run(ctx, repoDir, nil, "diff", "--no-color", base+"..."+head)
	if err != nil {
		return d, nil
	}
	d.Patch = string(patch)
	return d, nil
}

func (r *Runner) LogBetween(ctx context.Context, repoDir, base, head string, limit int) ([]Commit, error) {
	if !ValidRef(base) || !ValidRef(head) {
		return nil, fmt.Errorf("invalid ref")
	}
	if limit <= 0 {
		limit = 100
	}
	args := []string{
		"log",
		"--date=iso-strict",
		"--format=%H%x1f%P%x1f%an%x1f%ae%x1f%ad%x1f%cn%x1f%s%x1f%b%x1e",
		fmt.Sprintf("-n%d", limit),
		base + ".." + head,
	}
	out, err := r.run(ctx, repoDir, nil, args...)
	if err != nil {
		return nil, err
	}
	return parseCommits(out), nil
}

func (r *Runner) CanMerge(ctx context.Context, repoDir, base, head string) (bool, error) {
	if !ValidRef(base) || !ValidRef(head) {
		return false, fmt.Errorf("invalid ref")
	}
	mergeBase, err := r.run(ctx, repoDir, nil, "merge-base", base, head)
	if err != nil {
		return false, err
	}
	mb := strings.TrimSpace(string(mergeBase))
	out, err := r.run(ctx, repoDir, nil, "merge-tree", mb, base, head)
	if err != nil {
		return false, nil
	}
	return !strings.Contains(string(out), "<<<<<<"), nil
}

func (r *Runner) Merge(ctx context.Context, repoDir, base, head, message string) (string, error) {
	if !ValidRef(base) || !ValidRef(head) {
		return "", fmt.Errorf("invalid ref")
	}
	tmpDir := filepath.Join(r.Tmp, fmt.Sprintf("merge-%d", os.Getpid()))
	defer os.RemoveAll(tmpDir)

	if _, err := r.run(ctx, repoDir, nil, "worktree", "add", tmpDir, base); err != nil {
		return "", fmt.Errorf("worktree add: %w", err)
	}
	defer func() {
		r.run(ctx, repoDir, nil, "worktree", "remove", "--force", tmpDir)
	}()

	gitDir := repoDir
	workArgs := func(args ...string) []string {
		return append([]string{"-c", "user.name=Gitbase", "-c", "user.email=gitbase@localhost", "--git-dir=" + gitDir, "--work-tree=" + tmpDir}, args...)
	}

	resetArgs := workArgs("checkout", "-f", base)
	r.run(ctx, "", nil, resetArgs...)

	mergeArgs := workArgs("merge", "--no-ff", "-m", message, head)
	if _, err := r.run(ctx, "", nil, mergeArgs...); err != nil {
		return "", fmt.Errorf("merge failed: %w", err)
	}

	out, err := r.run(ctx, repoDir, nil, "rev-parse", base)
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(out)), nil
}

func (r *Runner) DiffStats(ctx context.Context, repoDir, base, head string) (additions, deletions, changedFiles int, err error) {
	if !ValidRef(base) || !ValidRef(head) {
		return 0, 0, 0, fmt.Errorf("invalid ref")
	}
	out, err := r.run(ctx, repoDir, nil, "diff", "--shortstat", base+"..."+head)
	if err != nil {
		return 0, 0, 0, nil
	}
	s := strings.TrimSpace(string(out))
	if s == "" {
		return 0, 0, 0, nil
	}
	parts := strings.Split(s, ",")
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if strings.Contains(p, "file") {
			fmt.Sscanf(p, "%d", &changedFiles)
		} else if strings.Contains(p, "insertion") {
			fmt.Sscanf(p, "%d", &additions)
		} else if strings.Contains(p, "deletion") {
			fmt.Sscanf(p, "%d", &deletions)
		}
	}
	return
}

func (r *Runner) SquashMerge(ctx context.Context, repoDir, base, head, message string) (string, error) {
	if !ValidRef(base) || !ValidRef(head) {
		return "", fmt.Errorf("invalid ref")
	}
	tmpDir := filepath.Join(r.Tmp, fmt.Sprintf("squash-%d", os.Getpid()))
	defer os.RemoveAll(tmpDir)

	if _, err := r.run(ctx, repoDir, nil, "worktree", "add", tmpDir, base); err != nil {
		return "", fmt.Errorf("worktree add: %w", err)
	}
	defer func() {
		r.run(ctx, repoDir, nil, "worktree", "remove", "--force", tmpDir)
	}()

	workArgs := func(args ...string) []string {
		return append([]string{"-c", "user.name=Gitbase", "-c", "user.email=gitbase@localhost", "--git-dir=" + repoDir, "--work-tree=" + tmpDir}, args...)
	}

	resetArgs := workArgs("checkout", "-f", base)
	r.run(ctx, "", nil, resetArgs...)

	squashArgs := workArgs("merge", "--squash", head)
	if _, err := r.run(ctx, "", nil, squashArgs...); err != nil {
		return "", fmt.Errorf("squash failed: %w", err)
	}

	commitArgs := workArgs("commit", "-m", message)
	if _, err := r.run(ctx, "", nil, commitArgs...); err != nil {
		return "", fmt.Errorf("commit failed: %w", err)
	}

	out, err := r.run(ctx, repoDir, nil, "rev-parse", base)
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(out)), nil
}

func (r *Runner) RebaseMerge(ctx context.Context, repoDir, base, head string) (string, error) {
	if !ValidRef(base) || !ValidRef(head) {
		return "", fmt.Errorf("invalid ref")
	}
	tmpDir := filepath.Join(r.Tmp, fmt.Sprintf("rebase-%d", os.Getpid()))
	defer os.RemoveAll(tmpDir)

	if _, err := r.run(ctx, repoDir, nil, "worktree", "add", tmpDir, head); err != nil {
		return "", fmt.Errorf("worktree add: %w", err)
	}
	defer func() {
		r.run(ctx, repoDir, nil, "worktree", "remove", "--force", tmpDir)
	}()

	workArgs := func(args ...string) []string {
		return append([]string{"-c", "user.name=Gitbase", "-c", "user.email=gitbase@localhost", "--git-dir=" + repoDir, "--work-tree=" + tmpDir}, args...)
	}

	resetArgs := workArgs("checkout", "-f", head)
	r.run(ctx, "", nil, resetArgs...)

	rebaseArgs := workArgs("rebase", base)
	if _, err := r.run(ctx, "", nil, rebaseArgs...); err != nil {
		return "", fmt.Errorf("rebase failed: %w", err)
	}

	// Fast-forward base to rebased head
	ffArgs := []string{"-c", "user.name=Gitbase", "-c", "user.email=gitbase@localhost", "--git-dir=" + repoDir, "branch", "-f", base, head}
	// After rebase, head worktree branch has the rebased commits. Update base ref.
	headSHA, _ := r.run(ctx, "", nil, workArgs("rev-parse", "HEAD")...)
	sha := strings.TrimSpace(string(headSHA))
	_, err := r.run(ctx, repoDir, nil, "update-ref", "refs/heads/"+base, sha)
	if err != nil {
		return "", fmt.Errorf("update-ref failed: %w", err)
	}
	_ = ffArgs // unused after refactor

	return sha, nil
}

func (r *Runner) MergedDiff(ctx context.Context, repoDir, parent, mergeSHA string) (string, error) {
	out, err := r.run(ctx, repoDir, nil, "diff", "--no-color", parent+".."+mergeSHA)
	if err != nil {
		return "", err
	}
	return string(out), nil
}

func (r *Runner) MergedCommits(ctx context.Context, repoDir, parent, mergeSHA string) ([]Commit, error) {
	args := []string{
		"log",
		"--date=iso-strict",
		"--format=%H%x1f%P%x1f%an%x1f%ae%x1f%ad%x1f%cn%x1f%s%x1f%b%x1e",
		"--no-merges",
		parent + ".." + mergeSHA,
	}
	out, err := r.run(ctx, repoDir, nil, args...)
	if err != nil {
		return nil, err
	}
	return parseCommits(out), nil
}

func (r *Runner) BranchExists(ctx context.Context, repoDir, branch string) bool {
	if !ValidRef(branch) {
		return false
	}
	_, err := r.run(ctx, repoDir, nil, "rev-parse", "--verify", "refs/heads/"+branch)
	return err == nil
}
