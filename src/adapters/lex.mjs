/** Lexing helpers shared by every adapter. Nothing here knows a language. */

/** Attach a 1-based line number to each match, walking the text once; matches are sorted by `index` first and `index` is dropped. */
export function withLines(text, matches) {
  matches.sort((a, b) => a.index - b.index);
  let line = 1, pos = 0;
  return matches.map((m) => {
    while (pos < m.index) { if (text[pos] === "\n") line++; pos++; }
    const { index, ...rest } = m;
    return { ...rest, line };
  });
}

/**
 * Blank comments and raw-string bodies, preserving length and every newline so
 * downstream offsets and line numbers still line up.
 *
 * Ordinary `"..."` strings are kept intact, because that is where a specifier
 * lives. Raw strings are blanked, because that is where a `//` that is not a
 * comment lives.
 *
 * Shared by every C-shaped language — Go, Java, Kotlin, Rust — which all agree
 * on `//`, on `/* ... *\/` and on double quotes. `ts.mjs` and `py.mjs` keep
 * their own: one has regex literals to worry about and the other has triple
 * quotes, and rewriting two working blankers to prove a point is not a fix.
 *
 * `raw` names the delimiters whose bodies get blanked, each as a `[open, close]`
 * pair. Known miss, and it is the accepted one: an unterminated raw string
 * blanks to end of file, which under-reports rather than inventing an import.
 */
export function blankCLike(text, { raw = [], lineComment = "//" } = {}) {
  const n = text.length;
  const lc = lineComment;
  let out = "";
  let i = 0;
  const pad = (s) => s.replace(/[^\n]/g, " ");
  while (i < n) {
    if (text.startsWith(lc, i)) {
      const end = text.indexOf("\n", i);
      const stop = end === -1 ? n : end;
      out += " ".repeat(stop - i);
      i = stop;
      continue;
    }
    if (text.startsWith("/*", i)) {
      const end = text.indexOf("*/", i + 2);
      const stop = end === -1 ? n : end + 2;
      out += pad(text.slice(i, stop));
      i = stop;
      continue;
    }
    const r = raw.find(([open]) => text.startsWith(open, i));
    if (r) {
      const [open, close] = r;
      const end = text.indexOf(close, i + open.length);
      const stop = end === -1 ? n : end + close.length;
      out += pad(text.slice(i, stop));
      i = stop;
      continue;
    }
    if (text[i] === '"') {
      // Kept, not blanked: the specifier is inside it. Escapes are copied whole so a `\"` cannot end the string early.
      out += '"'; i++;
      while (i < n && text[i] !== '"' && text[i] !== "\n") {
        if (text[i] === "\\") { out += text.slice(i, i + 2); i += 2; continue; }
        out += text[i]; i++;
      }
      if (i < n && text[i] === '"') { out += '"'; i++; }
      continue;
    }
    out += text[i]; i++;
  }
  return out;
}
