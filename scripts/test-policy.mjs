import { readdir, readFile } from "node:fs/promises";
import { extname, join } from "node:path";

const roots = ["tests/unit", "tests/browser"];
const forbidden =
  /\b(?:describe|it|test)\s*\.\s*(?:only|skip|todo|fixme)\b|\b(?:xdescribe|xit|xtest)\s*\(/;
let suites = 0;

async function inspect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await inspect(path);
    else if ([".ts", ".tsx", ".js", ".mjs"].includes(extname(path))) {
      const source = await readFile(path, "utf8");
      if (forbidden.test(source))
        throw new Error(`Focused or skipped test found in ${path}`);
      if (/\.(?:spec|test)\.[cm]?[jt]sx?$/.test(path)) suites += 1;
    }
  }
}

for (const root of roots) await inspect(root);
if (suites < roots.length)
  throw new Error("Unit and browser suites must both be non-empty");
console.log(`Test policy accepted ${suites} suite files.`);
