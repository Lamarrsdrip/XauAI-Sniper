import { cpSync, existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const build = path.join(root, "build");
const publicDir = path.join(root, "..", "backend_node", "public");
const managedStatic = path.join(publicDir, "static");
if (!existsSync(build)) throw new Error("frontend build output is missing");

// Only CRA-managed hashed assets are removed. Public runtime assets outside
// static/ are intentionally preserved.
rmSync(managedStatic, { recursive: true, force: true });
cpSync(build, publicDir, { recursive: true, force: true });

const index = readFileSync(path.join(publicDir, "index.html"), "utf8");
const refs = [...index.matchAll(/(?:src|href)="(\/static\/[^"?]+)"/g)].map((m) => m[1]);
if (refs.length === 0 || refs.some((ref) => !existsSync(path.join(publicDir, ref)))) {
  throw new Error("production index.html does not reference the copied hashed bundle");
}
const maps = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const p = path.join(dir, entry.name);
  return entry.isDirectory() ? maps(p) : [p];
});
if (maps(publicDir).some((file) => file.endsWith(".js.map") || file.endsWith(".css.map"))) {
  throw new Error("production source maps must not be served");
}
console.log(`synced ${refs.length} production bundle references to backend_node/public`);
