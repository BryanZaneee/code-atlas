# express-cjs

A CommonJS Express server, which `fixtures/express-js` deliberately is not: that
fixture uses an ESM server so its `.cjs` router still resolves through `import`.
This one has no `import` anywhere, so a mount chain here can only be followed by
reading `require` — and until it existed, every route in a CommonJS app was
reported at the path it declares rather than the path it is served at.

Both `require` shapes appear on purpose: a default binding and a destructured
one. A commented-out mount is here too, because a mount inside a comment would
otherwise move every route behind it.
