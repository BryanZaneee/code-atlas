/**
 * fastapi/full-stack-fastapi-template, as a calibration corpus.
 *
 * Deliberately thin. Detection already places this repository well without a
 * config (11 unsorted files out of 152, one unresolved specifier), so the only
 * things here are the two that cannot be detected: the curated flows, and the
 * datastore the ORM reaches through a connection string rather than an import.
 *
 * Kept minimal on purpose. A config that also hand-tuned the layering would
 * make the calibration measure the config rather than the deriver, and the
 * point of a second corpus is to measure the deriver somewhere its assumptions
 * were not already accommodated.
 */
import { FLOWS, DATASTORES, EXTRA_EDGES } from "./fastapi-template.flows.mjs";

export default {
  flows: FLOWS,
  datastores: DATASTORES,
  extraEdges: EXTRA_EDGES,
};
