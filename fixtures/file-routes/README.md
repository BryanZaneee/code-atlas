# file-routes

A Next.js-style App Router tree with no registration call anywhere in it — the
directory structure is the only thing that says a route exists. Pins the rules
that turn a file into a path: `(groups)` are organisational and never become a
URL segment, `[id]` becomes `:id`, `[...slug]` becomes a catch-all, `route.ts`
exports the methods it serves, `page.tsx` is served with `GET`, and a component
file that merely sits inside a route directory is not a route.
