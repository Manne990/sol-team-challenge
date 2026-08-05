import { readFileSync } from "node:fs";
import { globSync } from "node:fs";

const files = globSync(
  "{src,test,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,tsx}",
).sort();
if (files.length === 0) throw new Error("CI requires at least one test file");

const forbidden = [
  [
    /\b(?:describe|it|test)\.(?:only|skip|todo)\s*\(/,
    "focused, skipped, or todo test",
  ],
  [/\b(?:xdescribe|xit|xtest)\s*\(/, "disabled test"],
  [/\btest\.fixme\s*\(/, "fixme test"],
];
const violations = [];
for (const file of files) {
  const source = readFileSync(file, "utf8");
  if (!/\b(?:it|test)\s*\(/u.test(source))
    violations.push(`${file}: empty test file`);
  for (const [pattern, description] of forbidden) {
    if (pattern.test(source)) violations.push(`${file}: ${description}`);
  }
}
if (violations.length)
  throw new Error(`Test policy violations:\n${violations.join("\n")}`);
console.log(
  `test policy: ${files.length} test files, no focused or skipped tests`,
);
