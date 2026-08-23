// Package store is imported by cmd/main.go under its full module path, which
// exercises a package nested below the module root.
package store

// A backtick raw string containing what looks like an import block. The blanker
// has to swallow it, or the specifier below gets extracted as a real edge.
const Sample = `
import (
	"github.com/example/widget/not/a/real/package"
)
`

func Get() string { return "row" }
