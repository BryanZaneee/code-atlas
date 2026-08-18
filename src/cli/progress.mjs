/**
 * Streamed scan progress.
 *
 * A first scan of a large repository is indistinguishable from a hang, and the
 * fix for that is not a job queue — it is one line that keeps moving:
 *
 *   walk 1,240 files · parse 890/1,240 · resolve · endpoints · derive
 *
 * Two rules keep it from becoming a liability. It is throttled, because
 * rewriting a line once per file is slower than the work it reports on. And it
 * writes nothing at all unless the stream is a TTY, which is what keeps
 * `--json | jq` and every redirect clean without the pipeline knowing anything
 * about how it is being consumed.
 */

/** ~10 writes a second: fast enough to read as live, slow enough to be free. */
const INTERVAL = 100;

/**
 * @param stream  where to draw; anything non-TTY yields a no-op
 * @param now     injectable clock, so the throttle is testable
 * @returns tick(phase, detail) with a .done() that clears the line
 */
export function makeProgress(stream, now = Date.now) {
  if (!stream?.isTTY) {
    const noop = () => {};
    noop.clear = noop;
    noop.done = noop;
    return noop;
  }

  const phases = new Map();     // insertion-ordered: phases read left to right
  let last = -Infinity;         // the first tick always draws, whatever the clock reads

  const draw = () => stream.write("\r\x1b[K" + [...phases].map(([p, d]) => (d ? `${p} ${d}` : p)).join(" · "));

  const tick = (phase, detail = "") => {
    // Entering a phase always draws. Only the counter inside one is throttled,
    // because that is the only tick that arrives per file — and a line reading
    // `parse 12000/40000` while the scan is really three phases further on
    // answers "is it hung?" wrongly, which is the whole job.
    const entering = !phases.has(phase);
    phases.set(phase, detail);
    const t = now();
    if (!entering && t - last < INTERVAL) return;
    last = t;
    draw();
  };

  // Anything else writing to the same stream wipes the line first, or its
  // message lands on top of a half-drawn one. The next tick redraws it.
  tick.clear = () => stream.write("\r\x1b[K");
  tick.done = () => {
    phases.clear();
    tick.clear();
  };
  return tick;
}
