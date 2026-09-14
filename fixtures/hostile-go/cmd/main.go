// Imports one stdlib package (must resolve external) and the module's own
// root package by its full import path (must resolve internal, to widget.go).
package main

import (
	"fmt"

	"github.com/example/widget"
)

func main() { fmt.Println(widget.Name) }
