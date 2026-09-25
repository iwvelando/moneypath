// Package webembed carries the static web app served by `moneypath serve`.
// The dist/ tree here is a copy of the web build artifact (spec chapter
// 02): `make dist` builds web/dist and copies it over the placeholder.
// A release binary must embed the real tree — the conformance workflow's
// embedded-tree identity check (TestStaticBundle) enforces that.
package webembed

import (
	"embed"
	"io/fs"
)

//go:embed all:dist
var embedded embed.FS

// FS returns the embedded dist/ tree rooted at its index.html.
func FS() (fs.FS, error) {
	return fs.Sub(embedded, "dist")
}
