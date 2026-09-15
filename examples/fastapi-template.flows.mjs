/**
 * Curated request flows for fastapi/full-stack-fastapi-template.
 *
 * A second calibration corpus, added so the derivation numbers in the README
 * rest on more than one repository. TaxVault wires its controllers and services
 * through dependency injection, which the import graph cannot follow; this
 * template imports its collaborators directly at module scope, so it exercises
 * the opposite end of what derivation can see. Two corpora with opposite wiring
 * styles say more about the deriver than two of either kind.
 *
 * Pinned at commit cb740b6 (see FASTAPI_TEMPLATE_COMMIT in test/helpers.mjs).
 * Steps are hand-authored from the real call chains, read out of the route
 * bodies rather than guessed from the layer names. Every `from`/`to` is
 * validated against the scanned node set at build time, so a rename upstream
 * fails the build instead of quietly drawing a chain that is not there.
 *
 * Endpoint ids are the paths as the scanner sees them, which are the decorator
 * literals: FastAPI applies `APIRouter(prefix=...)` and the `/api/v1` mount at
 * runtime, and the regex adapter deliberately does not guess at either. The
 * full runtime path is in each flow's label.
 *
 * Sample payloads are synthetic. No real account, address or credential.
 */

export const DATASTORES = [
  {
    id: "db:postgres",
    label: "POSTGRES",
    note: "The only datastore. SQLModel sessions are opened per request by get_db and closed by the generator, so every hop below that touches data goes through one Session.",
  },
];

/** Edges that exist at runtime but appear in no import statement. */
export const EXTRA_EDGES = [
  { from: "backend/app/core/db.py", to: "db:postgres", kind: "sql" },
];

export const FLOWS = [
  {
    id: "login",
    label: "POST /api/v1/login/access-token",
    view: "api",
    blurb:
      "The only unauthenticated write. Verifies a password against the stored hash and returns a signed JWT; every other flow below starts from the token this one issues.",
    steps: [
      { from: "POST /login/access-token", to: "backend/app/main.py", kind: "request", label: "ASGI app", note: "CORS runs first, then the router mounted at settings.API_V1_STR." },
      { from: "backend/app/main.py", to: "backend/app/api/main.py", kind: "request", label: "include_router", note: "Wiring only. api_router collects login, users, utils and items; private is added when FASTAPI_ENV is development." },
      { from: "backend/app/api/main.py", to: "backend/app/api/routes/login.py", kind: "request", label: "route", note: "APIRouter(tags=[\"login\"]) carries no prefix, so this path is absolute under /api/v1." },
      { from: "backend/app/api/routes/login.py", to: "backend/app/api/deps.py", kind: "request", label: "SessionDep", note: "Depends(get_db) resolves before the handler body runs." },
      { from: "backend/app/api/deps.py", to: "backend/app/core/db.py", kind: "request", label: "engine" },
      { from: "backend/app/core/db.py", to: "db:postgres", kind: "read", label: "Session open", sample: { pool: "sqlmodel" } },
      { from: "backend/app/api/routes/login.py", to: "backend/app/crud.py", kind: "request", label: "authenticate", note: "crud.authenticate is the whole check: look the user up by email, then verify the password." },
      { from: "backend/app/crud.py", to: "backend/app/models.py", kind: "read", label: "select User", note: "get_user_by_email builds the statement; the Session executes it." },
      { from: "backend/app/models.py", to: "db:postgres", kind: "read", label: "SELECT", sample: { email: "user@example.com", is_active: true } },
      { from: "backend/app/crud.py", to: "backend/app/core/security.py", kind: "request", label: "verify_password", note: "Runs after the lookup, so a missing user and a wrong password cost different time. Upstream accepts that." },
      { from: "backend/app/api/routes/login.py", to: "backend/app/core/security.py", kind: "request", label: "create_access_token", note: "HS256 over settings.SECRET_KEY, expiring after ACCESS_TOKEN_EXPIRE_MINUTES.", sample: { token_type: "bearer" } },
      { from: "backend/app/core/security.py", to: "backend/app/core/config.py", kind: "request", label: "SECRET_KEY" },
    ],
  },
  {
    id: "create-item",
    label: "POST /api/v1/items/",
    view: "api",
    blurb:
      "The shortest authenticated write. No service layer and no crud call: the route validates the body into a model and commits it on the request session.",
    steps: [
      { from: "POST /", to: "backend/app/main.py", kind: "request", label: "ASGI app" },
      { from: "backend/app/main.py", to: "backend/app/api/main.py", kind: "request", label: "include_router" },
      { from: "backend/app/api/main.py", to: "backend/app/api/routes/items.py", kind: "request", label: "route", note: "APIRouter(prefix=\"/items\"), so the runtime path is /api/v1/items/." },
      { from: "backend/app/api/routes/items.py", to: "backend/app/api/deps.py", kind: "request", label: "CurrentUser", note: "get_current_user decodes the JWT, loads the User row and rejects an inactive one before the body runs." },
      { from: "backend/app/api/deps.py", to: "backend/app/core/security.py", kind: "request", label: "ALGORITHM", note: "deps imports the module for its ALGORITHM constant; the decode itself is jwt.decode." },
      { from: "backend/app/api/deps.py", to: "backend/app/models.py", kind: "read", label: "session.get(User)" },
      { from: "backend/app/models.py", to: "db:postgres", kind: "read", label: "SELECT user" },
      { from: "backend/app/api/routes/items.py", to: "backend/app/models.py", kind: "write", label: "Item.model_validate", note: "owner_id is forced from the authenticated user rather than read off the body, which is what keeps one tenant out of another's rows.", sample: { title: "example", owner_id: "uuid4" } },
      { from: "backend/app/models.py", to: "db:postgres", kind: "write", label: "INSERT then COMMIT", sample: { id: "uuid4" } },
    ],
  },
  {
    id: "list-items",
    label: "GET /api/v1/items/",
    view: "api",
    blurb:
      "Reads split on a role check. A superuser counts and pages the whole table; everyone else gets the same two queries constrained to their own owner_id.",
    steps: [
      { from: "GET /", to: "backend/app/main.py", kind: "request", label: "ASGI app" },
      { from: "backend/app/main.py", to: "backend/app/api/main.py", kind: "request", label: "include_router" },
      { from: "backend/app/api/main.py", to: "backend/app/api/routes/items.py", kind: "request", label: "route" },
      { from: "backend/app/api/routes/items.py", to: "backend/app/api/deps.py", kind: "request", label: "CurrentUser" },
      { from: "backend/app/api/deps.py", to: "backend/app/core/db.py", kind: "request", label: "engine" },
      { from: "backend/app/core/db.py", to: "db:postgres", kind: "read", label: "Session open" },
      { from: "backend/app/api/routes/items.py", to: "backend/app/models.py", kind: "read", label: "count + page", note: "Two statements either way. The branch changes the WHERE clause, not the shape of the response.", sample: { skip: 0, limit: 100 } },
      { from: "backend/app/models.py", to: "db:postgres", kind: "read", label: "SELECT count()" },
      { from: "backend/app/models.py", to: "db:postgres", kind: "read", label: "SELECT page", sample: { count: 12 } },
    ],
  },
  {
    id: "read-user",
    label: "GET /api/v1/users/{user_id}",
    view: "api",
    blurb:
      "Reads one user by id. The row is fetched before the privilege check, so the handler can let a caller read itself without being a superuser.",
    steps: [
      { from: "GET /{user_id}", to: "backend/app/main.py", kind: "request", label: "ASGI app" },
      { from: "backend/app/main.py", to: "backend/app/api/main.py", kind: "request", label: "include_router" },
      { from: "backend/app/api/main.py", to: "backend/app/api/routes/users.py", kind: "request", label: "route", note: "APIRouter(prefix=\"/users\")." },
      { from: "backend/app/api/routes/users.py", to: "backend/app/api/deps.py", kind: "request", label: "CurrentUser" },
      { from: "backend/app/api/deps.py", to: "backend/app/core/config.py", kind: "request", label: "SECRET_KEY", note: "deps decodes the bearer token against the same key security signs with." },
      { from: "backend/app/api/routes/users.py", to: "backend/app/models.py", kind: "read", label: "session.get(User)" },
      { from: "backend/app/models.py", to: "db:postgres", kind: "read", label: "SELECT", note: "Fetched first. Self-reads return here; anyone else falls through to the is_superuser check and a 403.", sample: { id: "uuid4" } },
    ],
  },
  {
    id: "update-user-me",
    label: "PATCH /api/v1/users/me",
    view: "api",
    blurb:
      "Updates the caller's own record. The email uniqueness check is a separate read before the write, which is why a conflicting address returns 409 rather than a database error.",
    steps: [
      { from: "PATCH /me", to: "backend/app/main.py", kind: "request", label: "ASGI app" },
      { from: "backend/app/main.py", to: "backend/app/api/main.py", kind: "request", label: "include_router" },
      { from: "backend/app/api/main.py", to: "backend/app/api/routes/users.py", kind: "request", label: "route" },
      { from: "backend/app/api/routes/users.py", to: "backend/app/api/deps.py", kind: "request", label: "CurrentUser" },
      { from: "backend/app/api/deps.py", to: "backend/app/models.py", kind: "read", label: "session.get(User)" },
      { from: "backend/app/models.py", to: "db:postgres", kind: "read", label: "SELECT user" },
      { from: "backend/app/api/routes/users.py", to: "backend/app/crud.py", kind: "read", label: "get_user_by_email", note: "Only when the patch carries an email. A hit belonging to somebody else is the 409." },
      { from: "backend/app/crud.py", to: "backend/app/models.py", kind: "read", label: "select User" },
      { from: "backend/app/models.py", to: "db:postgres", kind: "read", label: "SELECT by email", sample: { conflict: false } },
      { from: "backend/app/api/routes/users.py", to: "backend/app/models.py", kind: "write", label: "sqlmodel_update", note: "exclude_unset keeps an omitted field untouched instead of nulling it." },
      { from: "backend/app/models.py", to: "db:postgres", kind: "write", label: "UPDATE then COMMIT" },
    ],
  },
];
