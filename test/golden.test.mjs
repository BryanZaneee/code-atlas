/**
 * Golden payloads.
 *
 * mini-monorepo is the permanent, CI-enforced golden. taxvault is the Phase 0
 * equivalence check with a defined end: it proves the lift-and-shift changed
 * nothing, and once Phase 2's general path reproduces it from config alone it
 * demotes to an opt-in corpus assertion.
 *
 * Re-baseline deliberately: UPDATE_GOLDEN=1 npm test, then READ the diff before
 * committing it. A golden re-baselined without reading the diff is worse than
 * no golden, because it looks like coverage.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { scan } from "../src/build/build.mjs";
import { checkGolden, firstDiff, serialize, scanFixture, requireCorpus, scanTaxvault, TAXVAULT_COMMIT, GOLDEN_DIR } from "./helpers.mjs";
import { readFileSync } from "node:fs";

test("mini-monorepo payload matches its golden", async () => {
  const { payload } = await scanFixture("mini-monorepo");
  const r = checkGolden("mini-monorepo", payload);
  if (r.updated) return;
  assert.ok(!r.missing, `golden missing: ${r.file} — create it with UPDATE_GOLDEN=1`);
  assert.ok(r.ok, `payload drifted from ${path.basename(r.file)}\n${firstDiff(r.expected, r.actual)}`);
});

/**
 * The lift-and-shift guarantee, kept alive past the phase that earned it.
 *
 * test/golden/taxvault.prototype.json is frozen forever: it is the prototype's
 * output, and the observed facts in it -- nodes, edges, endpoints, coverage --
 * must never drift. Later phases legitimately ADD to the payload, so those
 * additions are listed here explicitly and stripped before comparing. The list
 * only ever grows with a deliberate, reviewed entry; anything else moving is a
 * regression in what the scanner reports.
 */
const ADDED_TOP = ["views", "theme",
  // phase 6: derived paths, kept in their own array so curated data keeps its
  // exact prototype shape and nothing conflates the two.
  "derivedFlows",
  // phase 5: structural findings over the graph the prototype never computed
  // at all — an addition, not a correction, so the observed facts above it
  // still have to match exactly.
  "findings"];
const ADDED_META = ["schemaVersion", "acquisition", "suiteCount",
  // phase 2.5: the map's own coverage, so the chrome can state it permanently.
  "unsortedCount", "unresolvedCount", "derivedCount",
  // phase 11: how many blocks on this map are somebody else's code. Zero unless
  // --include-vendor asked for them, which the prototype had no notion of.
  "vendorCount"];
// phase 1: the viewer used to sniff a step's prose for two phrases to decide
// whether to highlight it; the curated data says so outright now.
const ADDED_STEP = ["warn"];
// phase 2: every node records the rule that placed it. Additive — the layer and
// service themselves must still match the prototype exactly, and they do.
const ADDED_NODE = ["layerWhy", "serviceWhy",
  // phase 2.5: the flow index read from the node's end. Absent when empty, so
  // deleting it is a no-op on the nodes no flow touches.
  "travelledBy",
  // phase 7 follow-up: an endpoint node's own registration-rule provenance —
  // layerWhy/serviceWhy above now cover endpoint and datastore nodes too.
  "why"];
// phase 2.5: a stable two-character district name, and the district-hierarchy
// field PLAN.md ships ahead of the layout that consumes it.
const ADDED_DISTRICT = ["code", "parentId"];
// phase 11: present only on a node --include-vendor admitted, so absent here.
const ADDED_NODE_11 = ["vendor"];
// phase 4: the line a route is declared on, which is what makes Phase 7's
// jump-to-line possible. Additive — the method, path and definedIn of all 18
// endpoints must still match the prototype exactly, and they do.
// phase 6: the derived internal path, MODELLED rather than observed — it adds
// a field to every endpoint but changes no observed fact about it.
// phase 7 follow-up: which registration rule matched and how its mount prefix
// was decided, in one string — additive, the method/path/definedIn of all 18
// endpoints still match the prototype exactly.
const ADDED_ENDPOINT = ["line", "derivedPath", "why"];
// phase 7 prep: the line an import edge is declared on — the same
// jump-to-line field as ADDED_ENDPOINT's, on the other side of the graph.
// Additive — from/to/kind/cross of every edge must still match, and do.
const ADDED_EDGE = ["line"];

/**
 * The one deliberate CORRECTION to the prototype's observed facts, as opposed to
 * the additions above.
 *
 * The prototype decided a file's language with a three-way test and markdown as
 * the else branch, which held only while the kept set was `.ts .py .sql .md`. A
 * `.json` contract file — kept on purpose, because two languages import it —
 * was therefore reported as prose: counted in `docCount` instead of
 * `fileCount`, its lines missing from `lineCount`, and hidden behind the DOCS
 * toggle. Phase 2 widens the kept set, which would have made that silent bug
 * systematic, so it is fixed rather than preserved.
 *
 * Reversing exactly that correction here keeps every other byte of the payload
 * under comparison. It is deliberately narrow: it names one bug and undoes one
 * bug.
 */
/**
 * Phase 3, the same shape of thing: one bug named, one bug undone.
 *
 * The prototype extracted imports from raw source, so a line of English prose
 * inside a module docstring that happens to begin `import <word>:` was read as
 * an import — this repository has exactly one, and it has been reporting a
 * package named after a stdlib module that the file never imports. The Phase 3
 * adapters blank comments and string bodies before matching, which removes it.
 *
 * Undoing it means re-adding a package to whichever node lost one, found by
 * comparison rather than named: the golden is the record of what the prototype
 * said, so a hardcoded path here would just be the same claim written twice.
 */
function undoDocstringImportFix(p, expected) {
  const was = new Map(JSON.parse(expected).nodes.map((n) => [n.id, n.externals]));
  for (const n of p.nodes) {
    const before = was.get(n.id);
    if (!before || before.length === n.externals.length) continue;
    const missing = before.filter((e) => !n.externals.includes(e));
    n.externals = [...n.externals, ...missing].sort();
    p.meta.packageCount = new Set(p.nodes.flatMap((x) => x.externals)).size;
  }
}

/**
 * Phase 2.7 renamed the payload key `groups` to `districts` — the word the
 * viewer, the docs and the UI had always used for the same thing — and bumped
 * schemaVersion to 2 for it.
 *
 * The golden is not rewritten to match. It is the prototype's output, and the
 * prototype said `groups`; editing it would make a historical record agree with
 * a decision taken years after it. Renaming the key back on the clone, in
 * place so the serialized order is untouched, keeps the comparison honest: one
 * rename named, one rename undone, exactly as the two corrections below.
 */
function undoDistrictRename(p) {
  for (const k of Object.keys(p)) {
    const v = p[k];
    delete p[k];
    p[k === "districts" ? "groups" : k] = v;
  }
}

function undoJsonLangFix(p) {
  const json = p.nodes.filter((n) => n.lang === "json");
  for (const n of json) n.lang = "md";
  p.meta.fileCount -= json.length;
  p.meta.docCount += json.length;
  p.meta.lineCount -= json.reduce((a, n) => a + n.loc, 0);
}

test("taxvault's observed facts have not drifted from the prototype", async (t) => {
  const repo = requireCorpus(t, "taxvault");
  if (!repo) return;

  const { payload } = await scanTaxvault(repo);

  // Deleting a key leaves the order of the rest intact, so this stays a plain
  // string comparison rather than a structural walk.
  const stripped = structuredClone(payload);
  // Phase 2, and the one entry here that is not a new field: the prototype
  // assigned five root-level files to a service it never declared, so the viewer
  // filtered them out with no checkbox to bring them back — PLAN.md failure mode
  // #1, frozen into this golden. Reconciliation declares the id the config
  // already used rather than moving the files, so every node's service is
  // unchanged and the services list gains one marked entry. Dropping the marked
  // entries compares like for like.
  stripped.services = stripped.services.filter((s) => !s.synthesized);
  undoJsonLangFix(stripped);
  for (const k of ADDED_TOP) delete stripped[k];
  for (const k of ADDED_META) delete stripped.meta[k];
  for (const n of stripped.nodes) for (const k of [...ADDED_NODE, ...ADDED_NODE_11]) delete n[k];
  for (const d of stripped.districts) for (const k of ADDED_DISTRICT) delete d[k];
  undoDistrictRename(stripped);
  for (const e of stripped.endpoints) for (const k of ADDED_ENDPOINT) delete e[k];
  for (const e of stripped.edges) for (const k of ADDED_EDGE) delete e[k];
  for (const f of stripped.flows) for (const st of f.steps) for (const k of ADDED_STEP) delete st[k];

  const expected = readFileSync(path.join(GOLDEN_DIR, "taxvault.prototype.json"), "utf8");
  undoDocstringImportFix(stripped, expected);
  const actual = serialize(stripped);
  assert.equal(actual, expected, `the scanner's output drifted\n${firstDiff(expected, actual)}`);
});

test("meta carries the fields later phases added", async (t) => {
  const repo = requireCorpus(t, "taxvault");
  if (!repo) return;

  const { payload } = await scanTaxvault(repo);

  assert.equal(payload.meta.schemaVersion, 2);
  assert.deepEqual(payload.meta.acquisition, {
    mode: "ref",
    ref: TAXVAULT_COMMIT,
    commit: "22595f3",
    dirty: false,
  });
  // Four suite kinds, which the viewer used to print as a literal "4".
  assert.equal(payload.meta.suiteCount, 4);
  // The map's own coverage, on a target that actually has curated flows: every
  // hop of them is modeled, so DERIVED must be a real number and not zero.
  assert.ok(payload.meta.derivedCount > 0, "curated flow hops are modeled, not observed");
  assert.ok(payload.meta.derivedCount <= payload.flows.reduce((a, f) => a + f.steps.length, 0));
  assert.equal(payload.meta.unresolvedCount, 0);
  // The flow index, on a target that has nine of them: some nodes are on a
  // flow, most are not, and the ones that are name flows that exist.
  const travelled = payload.nodes.filter((n) => n.travelledBy);
  const flowIds = new Set(payload.flows.map((f) => f.id));
  assert.ok(travelled.length > 0 && travelled.length < payload.nodes.length);
  assert.ok(travelled.every((n) => n.travelledBy.every((id) => flowIds.has(id))));
  // Phase 6 appends a DERIVED PATHS view to a config that predates derivation,
  // rather than letting the config lose it by not knowing to list it. On this
  // target that means curated and derived paths sit in the same strip, which is
  // the only way to compare what a person asserted against what was inferred.
  // Phase 5 appends FINDINGS to a config that predates it, and Phase 8 API
  // REQUEST, for the same reason: a config cannot lose a view by not having
  // known to list it. FINDINGS is unconditional — a clean repository has a
  // result to show, and hiding the view would make "checked, found nothing"
  // look like "never checked".
  //
  // There is no DERIVED PATHS entry any more. Phase 11 folded inferred paths
  // into the composer, which opens on every endpoint's path; a derived one is
  // reached by picking the endpoint, and `derived: true` on the flow is what
  // still marks it inferred. This target's own curated views are untouched,
  // which is the half that matters: dropping a built-in view must not disturb
  // a config's.
  assert.deepEqual(payload.views.map((v) => v.id), ["structure", "api", "engagement", "tests", "request", "findings"]);
  assert.ok(payload.derivedFlows.every((f) => f.derived), "an inferred path still says so on the flow");
  assert.equal(payload.views.find((v) => v.id === "findings").kind, "findings");
  assert.ok(payload.derivedFlows.length > 0, "endpoints exist, so derived paths should too");
  // Curated data keeps its exact shape: derivation never writes into `flows`.
  assert.ok(payload.flows.every((f) => !f.derived));
  assert.equal(payload.views.find((v) => v.id === "engagement").showPhase, true);
  assert.equal(payload.views.find((v) => v.id === "api").showPhase, false);
});
