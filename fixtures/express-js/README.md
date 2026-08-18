# express-js

An Express app in **plain JavaScript**, with no TypeScript anywhere.

It exists because endpoint extraction was gated to `.ts`/`.py`, so this — the
most common shape a Node web service takes — reported zero endpoints, zero
derived paths, and nothing in `atlas scan` to say why. The gate is an adapter
question now, and the ts adapter has always claimed `.js`, `.jsx`, `.mjs`
and `.cjs`.

Covers, deliberately:

- `app.get`/`app.post` registered directly on the app, in `.js`
- a router in a **`.mjs`** file and another in a **`.cjs`** file, both mounted
  under a prefix, so the mount chain has to compose the served path across
  three files and two module systems
- one non-literal path (`router.post(pathFromConfig)`), which must be
  **skipped and counted**, never guessed at

## A limitation this fixture pins

`server.js` uses ESM `import` rather than `require()` on purpose. Mount
resolution reads the specifier a router symbol was imported from, and that
reader understands `import` syntax only — a router brought in with
`require()` still yields its endpoints, but at the path it declares rather
than the path it is served at. Making the fixture CommonJS throughout would
bake that wrong answer into a golden as though it were correct.
