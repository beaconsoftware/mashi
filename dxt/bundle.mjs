// Zip dist/ + manifest.json into a versioned .dxt at the repo root.
// File name: mashi-<version>.dxt — version is read from manifest.json
// so the filename, manifest, and the version Claude Desktop displays
// always agree.
import { readFileSync, existsSync, unlinkSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolve } from "node:path";

const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
const version = manifest.version;
const outName = `mashi-${version}.dxt`;
const outPath = resolve("..", outName);

if (existsSync(outPath)) unlinkSync(outPath);

// icon.png is optional; include if present.
const files = ["manifest.json", "dist"];
if (existsSync("icon.png")) files.push("icon.png");

execSync(`zip -r "${outPath}" ${files.join(" ")}`, { stdio: "inherit" });

const sizeKb = Math.round(
  Number(execSync(`stat -f %z "${outPath}"`).toString().trim()) / 1024,
);
console.log(`\n✓ ${outName} (${sizeKb} KB)`);
