// A _test.go file: part of the package, never what an importer meant, so it
// must not appear in the ids `resolve` returns for the package.
package store

import "testing"

func TestGet(t *testing.T) {
	if Get() == "" {
		t.Fatal("empty")
	}
}
