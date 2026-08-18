# route-skips

Zero real endpoints on purpose. `_shared.ts` registers a route on a path that
is a variable, not a literal (`router.post(cfg.path, ...)`); `items.ts` hands
a helper a literal path inside a config object, but the method that helper
calls is invisible from here. Neither is guessable without fabricating a
route, so both are skipped and counted rather than emitted.
