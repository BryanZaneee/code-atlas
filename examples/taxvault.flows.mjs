/**
 * Curated request flows for the TaxVault Code Atlas.
 *
 * Static imports cannot express request ORDERING, so the step lists below are
 * hand-authored from the real call chains. Every `from`/`to` is validated
 * against the scanned node set by atlas.mjs — a rename that breaks an id fails
 * the build loudly instead of silently drawing the wrong picture.
 *
 * Sample payloads are synthetic. No real fixture data, no taxpayer identifiers
 * (AGENTS.md rules 1 and 4).
 */

export const DATASTORES = [
  { id: "db:postgres", label: "POSTGRES 17", note: "System of record. Two migration owners: Drizzle (apps/api/drizzle) runs first, then the OCR service's raw SQL — document.engagement_id FKs into tax_engagement." },
  { id: "db:redis",    label: "REDIS",       note: "Three uses: idempotency locks, the case-queue cache with a generation counter, and per-tenant rate limiting." },
  { id: "db:dynamodb", label: "DYNAMODB",    note: "Case-queue read model projection. Absent config degrades the endpoint to 503 rather than failing the boot." },
  { id: "db:s3",       label: "S3 / LOCALSTACK", note: "Document blobs at tenants/{t}/engagements/{e}/{uuid4} — the key carries no filename and no identifiers." },
];

/** Edges that exist at runtime but not in any import statement. */
export const EXTRA_EDGES = [
  { from: "apps/api/src/db/client.ts", to: "db:postgres", kind: "sql" },
  { from: "apps/api/src/repository/case-queue-dynamo.repository.ts", to: "db:dynamodb", kind: "sql" },
  { from: "apps/api/src/cache/redis-shared.ts", to: "db:redis", kind: "cache" },
  { from: "apps/api/src/cache/case-queue-cache.ts", to: "db:redis", kind: "cache" },
  { from: "apps/api/src/middleware/idempotency.ts", to: "db:redis", kind: "cache" },
  { from: "apps/api/src/middleware/tenant-rate-limit.ts", to: "db:redis", kind: "cache" },
  { from: "ingestion-ocr-service/app/repository/document_repository.py", to: "db:postgres", kind: "sql" },
  { from: "ingestion-ocr-service/app/storage/document_storage.py", to: "db:s3", kind: "s3" },
  {
    from: "ingestion-ocr-service/app/repository/document_repository.py",
    to: "apps/api/src/repository/audit-entry.repository.ts",
    kind: "coupling",
    warn: true, note: "CROSS-BOUNDARY WRITE. insert_audit_entry writes straight into Core's audit_entry table — no API call — matching Core's engagement:{id} target format so Core's audit endpoint picks it up. Shared database, not a contract.",
  },
  {
    from: "ingestion-ocr-service/app/repository/document_repository.py",
    to: "apps/api/src/repository/engagement.repository.ts",
    kind: "coupling",
    warn: true, note: "CROSS-BOUNDARY READ. find_engagement_tenant SELECTs tenant_id FROM tax_engagement — a table Core owns and migrates. document.engagement_id also carries a real FK into it, which is why Drizzle migrations must run before the OCR ones.",
  },

  // Black-box tests drive HTTP, so they import nothing from the code they cover.
  // Without these the e2e and the Pact pair look unattached in the TESTS view.
  {
    from: "ingestion-ocr-service/test/e2e/test_missing_documents_flow.py",
    to: "POST /v1/engagements/{engagement_id}/documents",
    kind: "test:subject",
    note: "S2-TV-029. Boots BOTH services for real against one Postgres and one RS256 keypair, nothing stubbed, then walks upload → attach → missing-list until the list is empty.",
  },
  { from: "ingestion-ocr-service/test/e2e/test_missing_documents_flow.py", to: "POST /v1/engagements/:id/documents", kind: "test:exercises" },
  { from: "ingestion-ocr-service/test/e2e/test_missing_documents_flow.py", to: "GET /v1/engagements/:id/documents/missing", kind: "test:exercises" },
  {
    from: "apps/api/test/pact/attach-document.pact.test.ts",
    to: "apps/api/src/ingestion/ingestion.client.ts",
    kind: "test:subject",
    note: "Pact consumer side. Pins the request shape Core sends; the provider side verifies it in the OCR service's own suite.",
  },
  {
    from: "ingestion-ocr-service/test/pact/test_extract_provider.py",
    to: "POST /v1/documents/{document_id}/extract",
    kind: "test:subject",
    note: "Pact provider verification. Constrains SHAPE only and fabricates the document row — which is exactly the gap the S2-TV-029 end-to-end test exists to close.",
  },
];

const CORE_ATTACH = "POST /v1/engagements/:id/documents";
const ING_UPLOAD = "POST /v1/engagements/{engagement_id}/documents";
const ING_EXTRACT = "POST /v1/documents/{document_id}/extract";
const CORE_MISSING = "GET /v1/engagements/:id/documents/missing";

export const FLOWS = [
  /* ─────────── the marquee cross-service trace ─────────── */
  {
    id: "upload",
    label: "1 · UPLOAD",
    view: "engagement",
    phase: "1 UPLOAD",
    blurb: "Client posts a document to the OCR service. The blob lands in S3 before the row lands in Postgres, and a failed insert compensates the blob.",
    steps: [
      { from: ING_UPLOAD, to: "ingestion-ocr-service/app/main.py", kind: "request", label: "multipart in", note: "FastAPI app; /v1 prefix is applied once at the mount so the router path cannot drift.", sample: { file: "w2.pdf", doc_type: "W-2" } },
      { from: "ingestion-ocr-service/app/main.py", to: "ingestion-ocr-service/app/middleware/body_size_limit.py", kind: "request", label: "size gate", note: "Refuses an oversized Content-Length before Starlette spools the body to disk." },
      { from: "ingestion-ocr-service/app/middleware/body_size_limit.py", to: "ingestion-ocr-service/app/routers/document_routes.py", kind: "request", label: "route", note: "Wiring only — verb + path to a controller method. AGENTS.md rule 10." },
      { from: "ingestion-ocr-service/app/routers/document_routes.py", to: "ingestion-ocr-service/app/controllers/document_controller.py", kind: "request", label: "controller" },
      { from: "ingestion-ocr-service/app/controllers/document_controller.py", to: "ingestion-ocr-service/app/middleware/dependencies.py", kind: "request", label: "Depends graph", note: "Built lazily per request, which is why /health boots without a database." },
      { from: "ingestion-ocr-service/app/middleware/dependencies.py", to: "shared-python/src/tax_vault_shared/verifier.py", kind: "request", label: "verify RS256", note: "iss tax-vault-api, aud tax-vault-clients. The public key is captured once at module scope.", sample: { alg: "RS256", tenant_id: "tenant-demo", role: "Tax Preparer" } },
      { from: "shared-python/src/tax_vault_shared/verifier.py", to: "shared-python/src/tax_vault_shared/context.py", kind: "request", label: "→ RequestContext" },
      { from: "shared-python/src/tax_vault_shared/context.py", to: "ingestion-ocr-service/app/services/document_upload_service.py", kind: "request", label: "service", note: "Owns the ordering: size cap → empty → content-type → doc_type → ROLE → tenant. The role check runs before any DB read so a rejected caller cannot tell 403 from 404." },
      { from: "ingestion-ocr-service/app/services/document_upload_service.py", to: "ingestion-ocr-service/app/repository/document_repository.py", kind: "read", label: "find_engagement_tenant", note: "SELECT tenant_id FROM tax_engagement — reading a table the Core service owns." },
      { from: "ingestion-ocr-service/app/repository/document_repository.py", to: "db:postgres", kind: "read", label: "SELECT", sample: { tenant_id: "tenant-demo" } },
      { from: "ingestion-ocr-service/app/services/document_upload_service.py", to: "ingestion-ocr-service/app/storage/document_storage.py", kind: "write", label: "build_key + put", note: "Key is tenants/{t}/engagements/{e}/{uuid4} — no filename, no identifiers." },
      { from: "ingestion-ocr-service/app/storage/document_storage.py", to: "db:s3", kind: "s3", label: "put_object", note: "The blob is written BEFORE the row. A failed insert compensates with a delete; a failed COMMIT deliberately does not, because the outcome is ambiguous.", sample: { s3_key: "tenants/t/engagements/e/9f2c…", bytes: 84213 } },
      { from: "ingestion-ocr-service/app/services/document_upload_service.py", to: "ingestion-ocr-service/app/repository/document_repository.py", kind: "write", label: "insert_document" },
      { from: "ingestion-ocr-service/app/repository/document_repository.py", to: "db:postgres", kind: "write", label: "INSERT … RETURNING", note: "Then COMMIT. 201 with the new document id.", sample: { id: 42, doc_type: "W-2", uploaded_at: "2026-08-16T10:04:00Z" } },
    ],
  },
  {
    id: "attach",
    label: "2 · ATTACH",
    view: "engagement",
    phase: "2 ATTACH",
    blurb: "Core attaches the uploaded document: guards, then a cross-service HTTP hop into the OCR service with the caller's own token, then a single Drizzle transaction that writes the extraction and its audit entry together.",
    steps: [
      { from: CORE_ATTACH, to: "apps/api/src/app.ts", kind: "request", label: "express", sample: { documentId: 42 } },
      { from: "apps/api/src/app.ts", to: "apps/api/src/middleware/tenant-rate-limit.ts", kind: "request", label: "rate limit", note: "Limit key is derived from the JWT tenant_id, not the IP." },
      { from: "apps/api/src/middleware/tenant-rate-limit.ts", to: "db:redis", kind: "cache", label: "INCR", note: "Fails closed — no Redis means no writes." },
      { from: "apps/api/src/app.ts", to: "apps/api/src/routes/v1/engagement.routes.ts", kind: "request", label: "mount /v1" },
      { from: "apps/api/src/routes/v1/engagement.routes.ts", to: "apps/api/src/middleware/require-principal.ts", kind: "request", label: "auth + role", note: "Auth and role both run BEFORE idempotency: a replay must not return stored fields to a caller the write path would have refused." },
      { from: "apps/api/src/middleware/require-principal.ts", to: "apps/api/src/auth/auth.service.ts", kind: "request", label: "jwtVerify" },
      { from: "apps/api/src/middleware/require-principal.ts", to: "apps/api/src/middleware/idempotency.ts", kind: "request", label: "canAttachDocuments ✓", note: "ATTACH_ROLES mirrors the OCR service's UPLOAD_ROLES: Firm Admin and Tax Preparer." },
      { from: "apps/api/src/middleware/idempotency.ts", to: "db:redis", kind: "cache", label: "lock", note: "Key is sha256(tenantId:METHOD URL:clientKey). Only the row id is cached — never the extracted fields.", sample: { key: "sha256(tenant-demo:POST /v1/…)", state: "acquired" } },
      { from: "apps/api/src/middleware/idempotency.ts", to: "apps/api/src/controllers/engagement.controller.ts", kind: "request", label: "controller" },
      { from: "apps/api/src/controllers/engagement.controller.ts", to: "apps/api/src/services/attach-document.service.ts", kind: "request", label: "zod-parsed" },
      { from: "apps/api/src/services/attach-document.service.ts", to: "apps/api/src/repository/engagement.repository.ts", kind: "read", label: "findById", note: "Tenant-scoped. A miss is a 404 before any stage logic runs." },
      { from: "apps/api/src/repository/engagement.repository.ts", to: "db:postgres", kind: "read", label: "SELECT", sample: { stage: "Documents", on_hold: false } },
      { from: "apps/api/src/services/attach-document.service.ts", to: "apps/api/src/ingestion/ingestion.client.ts", kind: "request", label: "stage gate ✓", note: "The engagement must be in the Documents stage; otherwise the service audits the failure and throws DocumentStageRequiredError → 409." },
      { from: "apps/api/src/ingestion/ingestion.client.ts", to: ING_EXTRACT, kind: "http", label: "CROSS-SERVICE", warn: true, note: "The caller's Authorization header is forwarded verbatim so the OCR service verifies the same principal against the same issuer. 3 attempts, exponential backoff with full jitter, per-attempt AbortSignal.timeout. 4xx never retries.", sample: { method: "POST", authorization: "Bearer <caller's own token>", attempt: 1 } },
      { from: ING_EXTRACT, to: "ingestion-ocr-service/app/controllers/document_controller.py", kind: "request", label: "verify again", note: "Ingestion re-verifies the token independently — it does not trust the hop." },
      { from: "ingestion-ocr-service/app/controllers/document_controller.py", to: "ingestion-ocr-service/app/services/document_extract_service.py", kind: "request", label: "extract" },
      { from: "ingestion-ocr-service/app/services/document_extract_service.py", to: "ingestion-ocr-service/app/storage/document_storage.py", kind: "read", label: "get_object" },
      { from: "ingestion-ocr-service/app/storage/document_storage.py", to: "db:s3", kind: "s3", label: "GET blob" },
      { from: "ingestion-ocr-service/app/services/document_extract_service.py", to: "ingestion-ocr-service/app/services/mock_ocr.py", kind: "request", label: "mock OCR", note: "assign_doc_type maps content-type to doc type: PDF→W-2, PNG→1099-INT, JPEG→K-1, else Other. Field values are hard-coded synthetic — no taxpayer identifiers by design.", sample: { doc_type: "W-2", fields: { employer_name: "…", wages: "…" } } },
      { from: "ingestion-ocr-service/app/services/mock_ocr.py", to: "ingestion-ocr-service/app/repository/document_repository.py", kind: "write", label: "one txn", note: "update_document_doc_type, insert_succeeded_ocr_job, replace_extracted_fields, insert_audit_entry — then COMMIT. A Pydantic ValidationError instead quarantines the job and returns 422." },
      { from: "ingestion-ocr-service/app/repository/document_repository.py", to: "db:postgres", kind: "write", label: "INSERT ×N", note: "Includes a row in Core's audit_entry table — written directly, not through an API." },
      { from: "ingestion-ocr-service/app/services/document_extract_service.py", to: "apps/api/src/ingestion/ingestion.client.ts", kind: "response", label: "200 ExtractResponse", sample: { document_id: 42, doc_type: "W-2", ocr_job_status: "succeeded" } },
      { from: "apps/api/src/ingestion/ingestion.client.ts", to: "apps/api/src/services/attach-document.service.ts", kind: "response", label: "zod-validated", note: "extractedDocumentSchema.parse runs before the payload enters Core. A mismatched engagement_id is a 409 — Ingestion owns that link." },
      { from: "apps/api/src/services/attach-document.service.ts", to: "apps/api/src/repository/extracted-document.repository.ts", kind: "write", label: "save" },
      { from: "apps/api/src/repository/extracted-document.repository.ts", to: "apps/api/src/services/audit-entry.service.ts", kind: "write", label: "same txn", note: "The audit append shares the transaction, so the engagement can never carry attached fields the trail does not record." },
      { from: "apps/api/src/repository/extracted-document.repository.ts", to: "db:postgres", kind: "write", label: "UPSERT", note: "ON CONFLICT (ingestion_document_id) DO UPDATE … setWhere taxEngagementId = :id. The setWhere is what makes a cross-engagement re-attach return zero rows and surface as a 409.", sample: { extracted_document_id: 7, audit: "engagement.document.attach" } },
    ],
  },
  {
    id: "missing",
    label: "3 · MISSING LIST",
    view: "engagement",
    phase: "3 MISSING-LIST",
    blurb: "The checklist read: required doc types minus the distinct doc types already attached. This is the endpoint the S2-TV-029 end-to-end test drives to zero.",
    steps: [
      { from: CORE_MISSING, to: "apps/api/src/routes/v1/engagement.routes.ts", kind: "request", label: "GET missing" },
      { from: "apps/api/src/routes/v1/engagement.routes.ts", to: "apps/api/src/middleware/require-principal.ts", kind: "request", label: "role gate", note: "canReadMissingDocuments. Role runs before the handler so a forbidden caller cannot probe which engagements exist by comparing 403 against 404. A Client-role token gets 403." },
      { from: "apps/api/src/middleware/require-principal.ts", to: "apps/api/src/controllers/engagement.controller.ts", kind: "request", label: "controller" },
      { from: "apps/api/src/controllers/engagement.controller.ts", to: "apps/api/src/services/missing-document.service.ts", kind: "request", label: "service" },
      { from: "apps/api/src/services/missing-document.service.ts", to: "apps/api/src/repository/required-document.repository.ts", kind: "read", label: "checklist", note: "Seeded inside the create transaction, so every engagement has its required rows from birth." },
      { from: "apps/api/src/repository/required-document.repository.ts", to: "db:postgres", kind: "read", label: "SELECT doc_type", sample: { required: ["W-2", "1099-INT"] } },
      { from: "apps/api/src/services/missing-document.service.ts", to: "apps/api/src/repository/extracted-document.repository.ts", kind: "read", label: "attached", note: "SELECT DISTINCT doc_type FROM extracted_document, engagement-scoped." },
      { from: "apps/api/src/repository/extracted-document.repository.ts", to: "db:postgres", kind: "read", label: "SELECT DISTINCT", sample: { attached: ["W-2"], missing: ["1099-INT"] } },
    ],
  },

  /* ─────────── per-endpoint API traces ─────────── */
  {
    id: "login",
    label: "POST /v1/auth/login",
    view: "api",
    blurb: "First factor only. A correct password returns 202 and a short-lived MFA token — never a session.",
    steps: [
      { from: "POST /v1/auth/login", to: "apps/api/src/app.ts", kind: "request", label: "express", sample: { email: "preparer@example.test" } },
      { from: "apps/api/src/app.ts", to: "apps/api/src/routes/v1/auth.routes.ts", kind: "request", label: "route" },
      { from: "apps/api/src/routes/v1/auth.routes.ts", to: "apps/api/src/controllers/auth.controller.ts", kind: "request", label: "controller" },
      { from: "apps/api/src/controllers/auth.controller.ts", to: "apps/api/src/services/credential.service.ts", kind: "request", label: "service" },
      { from: "apps/api/src/services/credential.service.ts", to: "apps/api/src/auth/hashing.ts", kind: "request", label: "argon2id verify" },
      { from: "apps/api/src/services/credential.service.ts", to: "apps/api/src/repository/credential.repository.ts", kind: "read", label: "load credential" },
      { from: "apps/api/src/repository/credential.repository.ts", to: "db:postgres", kind: "read", label: "SELECT" },
      { from: "apps/api/src/services/credential.service.ts", to: "apps/api/src/auth/auth.service.ts", kind: "response", label: "202 + MFA token", note: "Deliberately not an access token. The session only exists after the TOTP challenge succeeds.", sample: { status: 202, mfa_token: "<short-lived>" } },
    ],
  },
  {
    id: "mfa",
    label: "POST /v1/auth/mfa/challenge",
    view: "api",
    blurb: "Second factor. A valid TOTP mints the RS256 access token that every other endpoint — and the OCR service — verifies.",
    steps: [
      { from: "POST /v1/auth/mfa/challenge", to: "apps/api/src/routes/v1/auth.routes.ts", kind: "request", label: "route", sample: { code: "██████" } },
      { from: "apps/api/src/routes/v1/auth.routes.ts", to: "apps/api/src/controllers/auth.controller.ts", kind: "request", label: "controller" },
      { from: "apps/api/src/controllers/auth.controller.ts", to: "apps/api/src/auth/mfa.ts", kind: "request", label: "TOTP verify", note: "Secrets are sealed with AES-256-GCM at rest and the response carries Cache-Control: no-store." },
      { from: "apps/api/src/auth/mfa.ts", to: "apps/api/src/auth/auth.service.ts", kind: "request", label: "sign" },
      { from: "apps/api/src/auth/auth.service.ts", to: "apps/api/src/repository/auth.repository.ts", kind: "write", label: "refresh token" },
      { from: "apps/api/src/repository/auth.repository.ts", to: "db:postgres", kind: "write", label: "INSERT" },
      { from: "apps/api/src/auth/auth.service.ts", to: "apps/api/src/schemas/auth.schema.ts", kind: "response", label: "200 tokens", note: "RS256, iss tax-vault-api, aud tax-vault-clients — the same trust the Python verifier is built against.", sample: { access_token: "<RS256 jwt>", expires_in: 900 } },
    ],
  },
  {
    id: "create-engagement",
    label: "POST /v1/engagements",
    view: "api",
    blurb: "Creates the case for one (client × tax year) and seeds its required-document checklist in the same transaction.",
    steps: [
      { from: "POST /v1/engagements", to: "apps/api/src/routes/v1/engagement.routes.ts", kind: "request", label: "route", sample: { clientId: "client-9", taxYear: 2025 } },
      { from: "apps/api/src/routes/v1/engagement.routes.ts", to: "apps/api/src/middleware/idempotency.ts", kind: "request", label: "idempotency" },
      { from: "apps/api/src/middleware/idempotency.ts", to: "db:redis", kind: "cache", label: "lock" },
      { from: "apps/api/src/middleware/idempotency.ts", to: "apps/api/src/controllers/engagement.controller.ts", kind: "request", label: "controller" },
      { from: "apps/api/src/controllers/engagement.controller.ts", to: "apps/api/src/services/engagement.service.ts", kind: "request", label: "service" },
      { from: "apps/api/src/services/engagement.service.ts", to: "apps/api/src/repository/engagement.repository.ts", kind: "write", label: "insert" },
      { from: "apps/api/src/repository/engagement.repository.ts", to: "apps/api/src/repository/required-document.repository.ts", kind: "write", label: "seed checklist", note: "Same transaction — an engagement without its checklist would report an empty missing-list forever." },
      { from: "apps/api/src/repository/required-document.repository.ts", to: "db:postgres", kind: "write", label: "INSERT ×2", note: "A duplicate (tenant, client, year) surfaces as 409 via the Postgres unique violation.", sample: { stage: "Intake", required: ["W-2", "1099-INT"] } },
    ],
  },
  {
    id: "stage",
    label: "PATCH /v1/engagements/:id/stage",
    view: "api",
    blurb: "Advances the six-stage machine and projects the result into the DynamoDB case queue.",
    steps: [
      { from: "PATCH /v1/engagements/:id/stage", to: "apps/api/src/routes/v1/engagement.routes.ts", kind: "request", label: "route", sample: { to: "Preparation" } },
      { from: "apps/api/src/routes/v1/engagement.routes.ts", to: "apps/api/src/middleware/require-principal.ts", kind: "request", label: "auth" },
      { from: "apps/api/src/middleware/require-principal.ts", to: "apps/api/src/controllers/engagement.controller.ts", kind: "request", label: "controller" },
      { from: "apps/api/src/controllers/engagement.controller.ts", to: "apps/api/src/services/stage-transition.service.ts", kind: "request", label: "stage machine", note: "Intake → Documents → Preparation → Review → Filed → Archived. Backward and skipped transitions are refused; on_hold preserves the resume stage." },
      { from: "apps/api/src/services/stage-transition.service.ts", to: "apps/api/src/repository/stage-transition.repository.ts", kind: "write", label: "record" },
      { from: "apps/api/src/repository/stage-transition.repository.ts", to: "db:postgres", kind: "write", label: "INSERT" },
      { from: "apps/api/src/services/stage-transition.service.ts", to: "apps/api/src/services/case-queue.service.ts", kind: "write", label: "project" },
      { from: "apps/api/src/services/case-queue.service.ts", to: "apps/api/src/cache/case-queue-cache.ts", kind: "cache", label: "invalidate", note: "Generation-counter fence, so a slow read cannot resurrect a stale queue after the write." },
      { from: "apps/api/src/cache/case-queue-cache.ts", to: "db:redis", kind: "cache", label: "bump gen" },
      { from: "apps/api/src/services/case-queue.service.ts", to: "apps/api/src/repository/case-queue-dynamo.repository.ts", kind: "write", label: "TransactWrite" },
      { from: "apps/api/src/repository/case-queue-dynamo.repository.ts", to: "db:dynamodb", kind: "write", label: "PUT", sample: { stage: "Preparation", queue: "preparer-queue" } },
    ],
  },
  {
    id: "case-queue",
    label: "GET /v1/case-queue",
    view: "api",
    blurb: "Redis-cached read over the DynamoDB projection. Unconfigured DynamoDB degrades to 503 instead of failing the boot.",
    steps: [
      { from: "GET /v1/case-queue", to: "apps/api/src/routes/v1/engagement.routes.ts", kind: "request", label: "route" },
      { from: "apps/api/src/routes/v1/engagement.routes.ts", to: "apps/api/src/controllers/engagement.controller.ts", kind: "request", label: "controller" },
      { from: "apps/api/src/controllers/engagement.controller.ts", to: "apps/api/src/services/case-queue.service.ts", kind: "request", label: "service" },
      { from: "apps/api/src/services/case-queue.service.ts", to: "apps/api/src/cache/case-queue-cache.ts", kind: "cache", label: "cache read" },
      { from: "apps/api/src/cache/case-queue-cache.ts", to: "db:redis", kind: "cache", label: "GET", note: "A miss coalesces concurrent callers onto one Dynamo query rather than stampeding.", sample: { hit: false } },
      { from: "apps/api/src/services/case-queue.service.ts", to: "apps/api/src/repository/case-queue-dynamo.repository.ts", kind: "read", label: "on miss" },
      { from: "apps/api/src/repository/case-queue-dynamo.repository.ts", to: "db:dynamodb", kind: "read", label: "Query", sample: { items: 12 } },
    ],
  },
  {
    id: "audit",
    label: "GET /v1/engagements/:id/audit",
    view: "api",
    blurb: "The append-only trail. Database triggers reject UPDATE, DELETE and TRUNCATE, and the OCR service writes into this same table.",
    steps: [
      { from: "GET /v1/engagements/:id/audit", to: "apps/api/src/routes/v1/engagement.routes.ts", kind: "request", label: "route" },
      { from: "apps/api/src/routes/v1/engagement.routes.ts", to: "apps/api/src/middleware/require-principal.ts", kind: "request", label: "auth" },
      { from: "apps/api/src/middleware/require-principal.ts", to: "apps/api/src/controllers/engagement.controller.ts", kind: "request", label: "controller" },
      { from: "apps/api/src/controllers/engagement.controller.ts", to: "apps/api/src/services/audit-entry.service.ts", kind: "request", label: "role-filtered" },
      { from: "apps/api/src/services/audit-entry.service.ts", to: "apps/api/src/repository/audit-entry.repository.ts", kind: "read", label: "list" },
      { from: "apps/api/src/repository/audit-entry.repository.ts", to: "db:postgres", kind: "read", label: "SELECT", note: "Rows here come from BOTH services — Core writes engagement.document.attach, the OCR service writes document.ocr.extract.", sample: { entries: 4, actions: ["engagement.document.attach", "document.ocr.extract"] } },
    ],
  },
];
