/**
 * Config normalization and precedence.
 *
 *   defaults < detected < config file < CLI flags
 *
 * The pipeline downstream of this file reads exactly one shape, so nothing in
 * `src/scan/` or `src/model/` has to know whether a value was configured,
 * detected or defaulted. That is what lets `--config` become optional without a
 * second code path.
 *
 * Two classifier shapes are supported on purpose:
 *
 *   layerRules: [...]     data — provenance says WHICH rule matched
 *   classify(p) -> string code — provenance can only say THAT config decided
 *
 * The rule form is what defaults and detection emit, so the no-config path — the
 * one a stranger's repo takes — gets the good provenance. A hand-written
 * `classify()` keeps working and degrades honestly rather than being rewritten.
 */
import { DEFAULTS } from "./defaults.mjs";
import { classifyLayer, makeServiceOf } from "../model/classify.mjs";

/** The sentinel a hand-written classify() returns for "no rule of mine matched". */
const NO_MATCH = "other";

export function loadConfig(user = {}, { detected = {}, overrides = {} } = {}) {
  const merged = { ...DEFAULTS, ...detected, ...user, ...overrides };
  const { layers, services, layerRules, fallbackLayer } = merged;

  // A user `classify()` wins over rules: someone who wrote one means it.
  //
  // Its no-match sentinel keeps landing in `tooling`, which is what that shape
  // has always meant, unless the config says otherwise. The rules path uses the
  // `unsorted` column instead, because there the tool is admitting it did not
  // recognise the file rather than reporting a decision someone made.
  const layerOf = user.classify
    ? (p) => {
        const layer = user.classify(p);
        return layer && layer !== NO_MATCH
          ? { layer, why: "matched a rule in the config's classify()", matched: true }
          : { layer: user.fallbackLayer ?? "tooling", why: "the config's classify() matched no rule", matched: false };
      }
    : (p) => classifyLayer(p, layerRules, fallbackLayer);

  // Same precedence for services. Phase 2's totality guarantee lives in
  // makeServiceOf; a user function is trusted as written, including its misses,
  // so an existing config's payload does not move underneath it.
  const serviceOf = user.serviceOf
    ? (p) => ({ service: user.serviceOf(p), why: "placed by the config's serviceOf()" })
    : makeServiceOf(services);

  return {
    ...merged,
    layers,
    services,
    layerOf,
    serviceOf,
    // Total by construction: a repo with no suite config still classifies its
    // tests, it just calls all of them unit tests.
    testKind: merged.testKind ?? (() => "unit"),
    suiteConfigs: merged.suiteConfigs ?? [],
  };
}
