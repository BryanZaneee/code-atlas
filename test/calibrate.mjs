#!/usr/bin/env node
/**
 * Calibration — how far derivation (src/model/derive.mjs) is from the truth,
 * measured against every one of TaxVault's 9 hand-curated flows.
 *
 * One endpoint is an anecdote; nine is a measurement (PLAN.md "Path derivation
 * + calibration"). This never runs unattended against curation: a curated flow
 * IS the ground truth here, hand-authored from the real call chains, so a
 * derived hop that disagrees with it is derivation's error to own, not a
 * reason to loosen the comparison.
 *
 * Only the REQUEST leg of a derived path is compared. `derive.mjs`'s response
 * leg is a blind reversal of the last <=3 request hops (PLAN step 4) — a
 * placeholder honest about being one, not an attempt to reconstruct the real
 * response chain curation hand-models. Diffing it against curated `response`
 * steps would either credit a coincidence or, far more often, flag "wrong
 * order" on every hop the request leg already got right, just because its own
 * mirror walks back over it. Excluding it keeps the score about the one thing
 * derivation actually attempts: the forward path.
 */
import { scan } from "../src/build/build.mjs";
import { corpusRepo, FASTAPI_TEMPLATE_COMMIT } from "./helpers.mjs";
import taxvaultConfig from "../examples/taxvault.config.mjs";
import { FLOWS } from "../examples/taxvault.flows.mjs";
import fastapiConfig from "../examples/fastapi-template.config.mjs";
import { FLOWS as FASTAPI_FLOWS } from "../examples/fastapi-template.flows.mjs";

/** `{id -> id}` hop pairs from curated steps, exactly as authored. */
function curatedHops(flow) {
  return new Set(flow.steps.map((s) => `${s.from}|${s.to}`));
}

/** Same shape from a derived path's request leg, node indices resolved back to ids. */
function derivedHops(endpoint, nodes) {
  const steps = (endpoint.derivedPath?.steps ?? []).filter((s) => s.kind !== "response");
  return new Set(steps.map((s) => `${nodes[s.from].id}|${nodes[s.to].id}`));
}

/**
 * One flow's precision/recall against its derived counterpart, plus which
 * hops were invented, missed, or found in the wrong order — the three ways a
 * derived path can disagree with the truth, named separately because they are
 * different failures: a fabrication, a gap, and a sequencing error.
 */
export function diffFlow(flow, payload) {
  const entryId = flow.steps[0]?.from;
  const endpoint = payload.endpoints.find((e) => e.id === entryId);
  if (!endpoint) {
    return { id: flow.id, label: flow.label, error: `no endpoint matches curated entry "${entryId}"` };
  }

  const curated = curatedHops(flow);
  const derived = derivedHops(endpoint, payload.nodes);

  const invented = [], wrongOrder = [];
  let tp = 0;
  for (const pair of derived) {
    if (curated.has(pair)) { tp++; continue; }
    const [a, b] = pair.split("|");
    if (curated.has(`${b}|${a}`)) wrongOrder.push(pair);
    else invented.push(pair);
  }
  const missed = [...curated].filter((pair) => {
    if (derived.has(pair)) return false;
    const [a, b] = pair.split("|");
    return !derived.has(`${b}|${a}`); // already counted as wrongOrder above
  });

  return {
    id: flow.id,
    label: flow.label,
    curated: curated.size,
    derived: derived.size,
    tp,
    invented,
    missed,
    wrongOrder,
    precision: derived.size ? tp / derived.size : 0,
    recall: curated.size ? tp / curated.size : 0,
  };
}

/**
 * Every curated flow against one scanned payload, plus the aggregate across all
 * of them.
 *
 * `flows` defaults to TaxVault's so the original one-argument call still reads
 * the same at the call site. A second corpus passes its own set rather than
 * this module reaching for a global, which is what lets the same diff logic
 * score a repository whose wiring style is nothing like TaxVault's.
 */
export function calibrate(payload, curatedFlows = FLOWS) {
  const flows = curatedFlows.map((f) => diffFlow(f, payload));
  const ok = flows.filter((f) => !f.error);
  const agg = ok.reduce(
    (a, f) => ({
      tp: a.tp + f.tp,
      curated: a.curated + f.curated,
      derived: a.derived + f.derived,
      invented: a.invented + f.invented.length,
      missed: a.missed + f.missed.length,
      wrongOrder: a.wrongOrder + f.wrongOrder.length,
    }),
    { tp: 0, curated: 0, derived: 0, invented: 0, missed: 0, wrongOrder: 0 },
  );
  return {
    flows,
    aggregate: {
      ...agg,
      precision: agg.derived ? agg.tp / agg.derived : 0,
      recall: agg.curated ? agg.tp / agg.curated : 0,
    },
  };
}

function pct(n) {
  return `${Math.round(n * 100)}%`;
}

function report(result) {
  const lines = [];
  for (const f of result.flows) {
    if (f.error) {
      lines.push(`${f.id.padEnd(18)} SKIP — ${f.error}`);
      continue;
    }
    lines.push(
      `${f.id.padEnd(18)} precision ${pct(f.precision).padStart(4)}  recall ${pct(f.recall).padStart(4)}` +
        `  (tp=${f.tp} curated=${f.curated} derived=${f.derived}` +
        `  invented=${f.invented.length} missed=${f.missed.length} wrongOrder=${f.wrongOrder.length})`,
    );
    for (const h of f.invented) lines.push(`  invented:    ${h.replace("|", " -> ")}`);
    for (const h of f.missed) lines.push(`  missed:      ${h.replace("|", " -> ")}`);
    for (const h of f.wrongOrder) lines.push(`  wrong order: ${h.replace("|", " -> ")}`);
  }
  const a = result.aggregate;
  lines.push("");
  lines.push(
    `aggregate          precision ${pct(a.precision).padStart(4)}  recall ${pct(a.recall).padStart(4)}` +
      `  (tp=${a.tp} curated=${a.curated} derived=${a.derived}` +
      `  invented=${a.invented} missed=${a.missed} wrongOrder=${a.wrongOrder})`,
  );
  return lines.join("\n");
}

/**
 * The corpora this harness can score, and how to scan each one.
 *
 * TaxVault stays on HEAD, which is what it has always done and what the numbers
 * published in the README were taken at. The template is pinned, because it is
 * somebody else's active repository: scoring its moving HEAD would report a
 * figure that drifts without anything here changing.
 */
const CORPORA = {
  taxvault: { ref: "HEAD", config: taxvaultConfig, flows: FLOWS },
  "fastapi-template": { ref: FASTAPI_TEMPLATE_COMMIT, config: fastapiConfig, flows: FASTAPI_FLOWS },
};

async function main() {
  const name = process.argv[2] ?? "taxvault";
  const corpus = CORPORA[name];
  if (!corpus) {
    console.error(`calibrate: unknown corpus "${name}" — expected one of ${Object.keys(CORPORA).join(", ")}`);
    process.exitCode = 2;
    return;
  }

  const repo = corpusRepo(name);
  if (!repo) {
    console.error(`calibrate: ${name} not present — the corpus lives outside this repo`);
    return;
  }
  const { payload } = scan({ repo, ref: corpus.ref, config: corpus.config, fetch: false, warn: () => {} });
  const result = calibrate(payload, corpus.flows);
  console.log(report(result));
}

// Only run as a script — importing this module (the regression test does) must
// not scan a repository as a side effect of loading it. Compared on paths
// rather than by building a file:// URL by hand, which does not survive a
// repository checked out under a directory with a space in its name.
if (import.meta.filename === process.argv[1]) {
  main();
}
