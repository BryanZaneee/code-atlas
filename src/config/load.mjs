/** Config normalization, defaults < detected < config file < CLI flags, into the one shape everything downstream reads. See docs/config.md. */
import { DEFAULTS, DEFAULT_EXCLUDE, HARD_EXCLUDE } from "./defaults.mjs";
import { classifyLayer, makeServiceOf } from "../model/classify.mjs";

/** The sentinel a hand-written classify() returns for "no rule of mine matched". */
const NO_MATCH = "other";

export function loadConfig(user = {}, { detected = {}, overrides = {} } = {}) {
  const merged = { ...DEFAULTS, ...detected, ...user, ...overrides };

  // `exclude` ADDS rather than replaces, or a config that forgot the defaults would walk every installed dependency.
  // `includeVendor` is the one thing that SUBTRACTS: it drops the vendor patterns from the floor, so a reader who asked for node_modules gets it. Everything in HARD_EXCLUDE stays whatever they asked for.
  const floor = merged.includeVendor ? HARD_EXCLUDE : DEFAULT_EXCLUDE;
  merged.exclude = [...floor, ...(detected.exclude ?? []), ...(user.exclude ?? []), ...(overrides.exclude ?? [])]
    .filter((re, i, all) => all.findIndex((o) => o.source === re.source) === i);

  const { layers, services, layerRules, fallbackLayer } = merged;

  // A user classify() wins over rules, and its no-match sentinel lands in `tooling`, not `unsorted`.
  const layerOf = user.classify
    ? (p) => {
        const layer = user.classify(p);
        return layer && layer !== NO_MATCH
          ? { layer, why: "matched a rule in the config's classify()", matched: true }
          : { layer: user.fallbackLayer ?? "tooling", why: "the config's classify() matched no rule", matched: false };
      }
    : (p) => classifyLayer(p, layerRules, fallbackLayer);

  // Same precedence for services; a user serviceOf is trusted as written, misses included.
  const serviceOf = user.serviceOf
    ? (p) => ({ service: user.serviceOf(p), why: "placed by the config's serviceOf()" })
    : makeServiceOf(services);

  return {
    ...merged,
    layers,
    services,
    layerOf,
    serviceOf,
    // Total: a repo with no suite config still classifies, as all-unit.
    testKind: merged.testKind ?? (() => "unit"),
    suiteConfigs: merged.suiteConfigs ?? [],
  };
}
