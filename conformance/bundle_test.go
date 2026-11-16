package conformance_test

import (
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// TestStaticBundle is the static-bundle check of spec chapter 08: the web
// build must produce a standalone dist/ (index.html plus a content-hashed
// wasm, all-relative URLs). The test skips when web/dist has not been built
// (run `make dist` first).
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
}
