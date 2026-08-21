/** Lexing helpers shared by every adapter. Nothing here knows a language. */

/**
 * Attach a 1-based line number to each match, walking the text once. Matches
 * are sorted by `index` first, and `index` is dropped from the result.
 */
export function withLines(text, matches) {
  matches.sort((a, b) => a.index - b.index);
  let line = 1, pos = 0;
  return matches.map((m) => {
    while (pos < m.index) { if (text[pos] === "\n") line++; pos++; }
    const { index, ...rest } = m;
    return { ...rest, line };
  });
}
