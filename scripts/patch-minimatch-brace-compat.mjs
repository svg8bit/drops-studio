import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const minimatchPath = path.join(
  process.cwd(),
  "node_modules",
  "minimatch",
  "minimatch.js",
);
const legacyImport = "var expand = require('brace-expansion')";
const compatibleImport = [
  "var braceExpansion = require('brace-expansion')",
  "var expand = typeof braceExpansion === 'function'",
  "  ? braceExpansion",
  "  : braceExpansion.expand",
].join("\n");

let source;
try {
  source = await readFile(minimatchPath, "utf8");
} catch (error) {
  throw new Error(
    `Cannot apply the minimatch 3 compatibility patch at ${minimatchPath}.`,
    { cause: error },
  );
}

if (source.includes(compatibleImport)) {
  process.stdout.write("minimatch brace-expansion compatibility already applied\n");
  process.exit(0);
}

if (!source.includes(legacyImport)) {
  throw new Error(
    "The installed minimatch source changed; review the brace-expansion compatibility patch before continuing.",
  );
}

await writeFile(
  minimatchPath,
  source.replace(legacyImport, compatibleImport),
  "utf8",
);
process.stdout.write("minimatch brace-expansion compatibility applied\n");
