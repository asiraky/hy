// stdout discipline, installed before anything else is imported.
//
// Only framed JSON-RPC may reach stdout: a single stray write — ours, a
// dependency's, or a Node deprecation warning — desynchronises the host's
// frame reader. This module must be imported FIRST, because ES imports are
// evaluated before the importing module's body, so a guard installed in the
// body would arrive after a noisy dependency had already written.

const stdoutWrite = process.stdout.write.bind(process.stdout);

const render = (v) => {
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
};

for (const method of ["log", "info", "warn", "error", "debug", "trace", "dir"]) {
  console[method] = (...args) => process.stderr.write(args.map(render).join(" ") + "\n");
}

// Node's own warnings (deprecations, experimental flags) go to stderr already,
// but pin it so a changed default cannot leak onto stdout.
process.on("warning", (w) => process.stderr.write(`${w.name}: ${w.message}\n`));

/** Writes one framed line. The only sanctioned path to stdout. */
export const writeFrame = (frame) => stdoutWrite(JSON.stringify(frame) + "\n");
