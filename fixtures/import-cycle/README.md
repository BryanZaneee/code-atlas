# import-cycle

The Phase 5 findings gate: a small, hand-built repo where every one of the
eight findings has exactly one deliberate, known-true instance, isolated from
the rest — the cycle does not cross a layer boundary, the layering violation
is not part of the cycle, the cross-service edge does not violate layering,
and so on. Each finding's test can point at a specific id and know what it
should find, rather than asserting "some findings exist somewhere."

| finding | where |
| --- | --- |
| import cycle | `src/services/a.ts` -> `b.ts` -> `c.ts` -> `a.ts` |
| layering violation | `src/repository/store.ts` imports `src/routes/handler.ts` — repository (rank 7) importing route (rank 2) |
| oversized file | `src/util/big.ts`, well past `findings.locThreshold` |
| endpoint no test reaches | `GET /health`, declared in `src/routes/handler.ts`, which no test imports |
| orphan | `src/util/orphan.ts` — zero in-edges, zero out-edges |
| unreachable from any entrypoint | everything past `src/routes/handler.ts`: `src/index.ts` is the only `entry`-layer file and it wires up nothing else |
| god node | `src/util/shared.ts`, imported by all three cycle files |
| cross-service coupling | `src/controller/handler2.ts` (service `app`) imports `packages/billing/ledger.ts` (service `billing`) directly |

`test/a.test.ts` exists so coverage is measured at all — `src/services/a.ts`
is directly tested, `b.ts`/`c.ts`/`shared.ts` are indirectly covered through
the cycle's own imports, and `handler.ts` stays uncovered on purpose.
