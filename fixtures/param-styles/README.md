# param-styles

One file, two param syntaxes, the same route declared both ways. Pins path
normalization: `{id}` and `:id` name the same logical path parameter in
different frameworks, so the extractor collapses a repeat declaration onto the
node the first one drew instead of drawing a second — the payload still shows
`path` exactly as the source wrote it, since `path` is documented as literal.
