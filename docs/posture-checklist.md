# Posture checklist

Also summarised in [CONTRIBUTING.md](../CONTRIBUTING.md). Follow these rules for
code changes, reviews, and AI-assisted work.

This tool reads **other people's repositories** and draws conclusions about
them. Both halves of that sentence carry risk: their source is data we are
trusted with, and our conclusions are claims a reader will act on. The rules
below are the ones that actually bite here, not generic hygiene.

## Do not leak the target repository

1. **No target-repo content in logs or errors.** Scanned source, file contents,
   and the text of somebody else's code must never reach stderr, an error
   message, or a stack trace. Reporting a *path* is fine and necessary; pasting
   the line that failed to parse is not.
2. **No secrets in source.** No API keys, credentials, private keys, or tokens
   in code, fixtures, examples, or tests. Auth tokens reach the live proxy
   through `--auth-env` and are injected server-side, so they never enter the
   browser, stderr, or `document.documentElement.outerHTML`.
3. **`--json` is the sanctioned channel.** The payload is a documented, versioned
   contract. Anything a consumer needs goes there, where its shape is reviewed,
   rather than being smuggled out through a log line.
4. **Embedding source is opt-in and badged.** `--embed-source` puts the target's
   code inside a shareable HTML file. That is why it is a flag, why the viewer
   carries a permanent badge, and why the CLI warns about the size. Do not make
   it a default, and do not soften the badge.

## Do not overclaim

5. **Never emit a phantom endpoint.** A non-literal route path is skipped and
   counted, never guessed at. This generalises: **under-report, and say so.**
   "Parse harder" is not the answer to a missed pattern: skip it, count it,
   report it.
6. **Never let modelled read as observed.** A path inferred from the import
   graph must be legible as inferred. A number the tool does not measure, and
   per-hop timing above all, is not drawn at all.
7. **Nothing target-specific in `src/` or `bin/`.** The validation corpus proves
   the tool works on real code; it is never encoded into it. `test/generic.test.mjs`
   catches only *named* strings, not a rule quietly shaped around one repo's
   directory layout. So the review question stays: *would this be right on a
   repo I have never seen?*
8. **Every classification carries its provenance.** A heuristic that cannot say
   why it fired turns a misclassification into a bug report instead of a config
   edit. Carry the reason alongside the result.

## Secure defaults for the server

9. **`serve` binds `127.0.0.1` as a literal, never a flag.** There is nothing a
   caller can pass to change it, and that is deliberate.
10. **File access is allowlist membership, never path sanitization.** `allow.has(rel)`
    against the exact scanned set *is* the defense. Sanitizing a user-supplied
    string is the losing game; set membership is not. On top of it: `lstat`
    symlink refusal, a size cap, and always `text/plain`.
11. **The proxy takes no host and no URL.** It accepts `{method, path, headers, body}`,
    with the origin from server config. Anything that could turn it into an open
    relay is a defect, not a feature request.
12. **Read-only on the target repository.** `git archive <ref>` into a temp
    dir, or a plain fs walk. Never switch branches, never mutate a working
    tree. `atlas init` is the only command permitted to write to a target repo,
    and it refuses to overwrite.

## Dependencies

13. **A dependency is a conversation, not a rule to obey.** Propose one in the
    pull request body. Weigh it against the single-self-contained-file promise
    and against install friction for a tool people point at someone else's repo.
    **Vendoring is the third option** and has precedent (Prism, CodeMirror). A
    vendored file is still a dependency, tested like anything else in `src/`,
    with its version and licence in its header.
14. **Never add a dependency to make one target repo work.** This is the one part
    that is hard rather than negotiable.

## Code review expectations

During review, explicitly check:

- whether a new log line or error string could carry target-repo content
- whether new code hard-codes anything about a specific repository
- whether a new visual element could make an inference look like a measurement
- whether a new heuristic records why it fired
- whether a new file-serving or file-writing path went through the allowlist
  rather than around it
