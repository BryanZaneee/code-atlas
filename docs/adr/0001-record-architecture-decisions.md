# 1. Record architecture decisions

Date: 2026-08-18

## Status

Accepted

## Context

Design decisions for this project already live in [PLAN.md](../../PLAN.md),
including a **Decisions reversed** section that keeps the reasoning behind a
change rather than editing the old reasoning away. That works well as a
*narrative*: it reads top to bottom and explains why the tool is shaped the
way it is.

What it does not give is a dated record of a single decision that can be linked
from a pull request. When a PR changes something structural, a reviewer wants
the one decision in front of them, not the chapter it belongs to.

## Decision

Record architecture decisions as numbered files under `docs/adr/`, one decision
per file, using [template.md](./template.md).

PLAN.md keeps the narrative. An ADR holds the dated record of one decision and
is linked from the pull request that makes it.

**Write an ADR when a decision would be expensive to reverse.** A config
default is not one. A build step, a dependency, a change to the payload
contract, or a reversal of a standing constraint is.

The pull request template carries an explicit *not applicable* box for the
common case, because a requirement that is routinely ignored stops being read.

## Consequences

A structural change now costs one short file. In exchange, the reason for it
survives the person who made it and the pull request that carried it.

An ADR is never edited to say something different. It is superseded by a
later one, which links back. That is the same rule PLAN.md's Decisions-reversed
section already follows, and for the same reason: the reasoning that produced a
decision is the interesting part, even once the decision changes.
