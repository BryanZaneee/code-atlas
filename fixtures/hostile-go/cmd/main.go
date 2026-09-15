// Every import shape Go has, in one file.
//
//	"fmt"                     stdlib, must be external
//	widget                    the module's own root package, one file
//	store                     a nested package of the same module
//	_ "net/http/pprof"        side-effect import, binds no name
//	alias "encoding/json"     renamed, binds the alias
//
// The /* block comment */ and the // line comment above both have to be blanked
// before any of that is matched.
package main

import (
	"fmt"

	alias "encoding/json"
	_ "net/http/pprof"

	"github.com/example/widget"
	"github.com/example/widget/internal/store"
)

/* import ( "github.com/example/widget/commented/out" ) */

func main() {
	b, _ := alias.Marshal(store.Get())
	fmt.Println(widget.Name, string(b))
}
