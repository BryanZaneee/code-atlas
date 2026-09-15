/** Streamed scan progress: one line that keeps moving, so a first scan of a large repo is not indistinguishable from a hang. Throttled, and silent unless the stream is a TTY, which keeps `--json | jq` and every redirect clean. */

/** ~10 writes a second: fast enough to read as live, slow enough to be free. */
const INTERVAL = 100;

/** @param stream where to draw (non-TTY yields a no-op) @param now injectable clock @returns tick(phase, detail), with a .done() that clears the line */
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
    // Entering a phase always draws; only the per-file counter is throttled, since a stale phase name answers "is it hung?" wrongly.
    const entering = !phases.has(phase);
    phases.set(phase, detail);
    const t = now();
    if (!entering && t - last < INTERVAL) return;
    last = t;
    draw();
  };

  // Anything else writing to this stream wipes the line first, or its message lands on a half-drawn one; the next tick redraws.
  tick.clear = () => stream.write("\r\x1b[K");
  tick.done = () => {
    phases.clear();
    tick.clear();
  };
  return tick;
}
