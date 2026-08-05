import { globSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

for (const file of globSync("{scripts,src/db,test,tests}/**/*.{js,mjs,cjs}").sort()) {
  const result = spawnSync(process.execPath, ["--check", file], { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
for (const file of ["package.json", "package-lock.json"]) JSON.parse(readFileSync(file, "utf8"));
console.log("static checks: JavaScript syntax and package metadata valid");
