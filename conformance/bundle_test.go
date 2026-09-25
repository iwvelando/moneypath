package conformance_test

import (
	"crypto/sha256"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"github.com/iwvelando/moneypath/internal/webembed"
)

// TestStaticBundle is the static-bundle check of spec chapter 08: the web
// build must produce a standalone dist/ (index.html plus a content-hashed
// wasm, all-relative URLs), and the tree embedded in the binary must be
// identical to it. The
// test skips when web/dist has not been built (run `make dist` first); a
// release must run it against the real tree.
func TestStaticBundle(t *testing.T) {
	distDir := filepath.Join("..", "web", "dist")
	if _, err := os.Stat(filepath.Join(distDir, "index.html")); err != nil {
		t.Skip("web/dist not built (run `make dist`); skipping bundle check")
	}

	// index.html exists and references no absolute-path assets (sub-path
	// hosting, spec chapters 02/06).
	index, err := os.ReadFile(filepath.Join(distDir, "index.html"))
	if err != nil {
		t.Fatal(err)
	}
	for _, m := range regexp.MustCompile(`(?:src|href)="([^"]+)"`).FindAllStringSubmatch(string(index), -1) {
		if strings.HasPrefix(m[1], "/") && !strings.HasPrefix(m[1], "//") {
			t.Errorf("index.html references absolute path %q; sub-path hosting requires relative URLs", m[1])
		}
	}

	// Exactly the wasm artifacts present are content-hashed (a bare
	// moneypath.wasm would defeat the coherent-cache guarantee). The hash is
	// base64url, so it may itself contain '-' or '_'.
	hashed := regexp.MustCompile(`[-.][0-9a-zA-Z_-]{8,}\.wasm$`)
	foundWasm := false
	err = filepath.WalkDir(distDir, func(path string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		if strings.HasSuffix(path, ".wasm") {
			foundWasm = true
			if !hashed.MatchString(path) {
				t.Errorf("wasm asset %s is not content-hashed", path)
			}
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if !foundWasm {
		t.Error("no .wasm asset in web/dist")
	}

	// The embedded tree walks to the same file list with the same hashes.
	embeddedFS, err := webembed.FS()
	if err != nil {
		t.Fatal(err)
	}
	diskFiles := hashTree(t, os.DirFS(distDir))
	embFiles := hashTree(t, embeddedFS)
	for name, h := range diskFiles {
		eh, ok := embFiles[name]
		if !ok {
			t.Errorf("embedded tree missing %s (stale embed? run `make dist` before building)", name)
			continue
		}
		if eh != h {
			t.Errorf("embedded %s differs from web/dist copy", name)
		}
	}
	for name := range embFiles {
		if _, ok := diskFiles[name]; !ok {
			t.Errorf("embedded tree has extra file %s", name)
		}
	}
}

func hashTree(t *testing.T, fsys fs.FS) map[string]string {
	t.Helper()
	out := map[string]string{}
	err := fs.WalkDir(fsys, ".", func(path string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		data, err := fs.ReadFile(fsys, path)
		if err != nil {
			return err
		}
		out[path] = fmt.Sprintf("%x", sha256.Sum256(data))
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	return out
}
