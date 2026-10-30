// Removes packages from a `pnpm deploy` output that are only reachable through optional peer
// dependencies. In this workspace drizzle-orm's optional peers (expo-sqlite, better-sqlite3)
// resolve to the mobile app's copies, which would otherwise pull React Native into server images.
// Usage: node scripts/prune-optional-peers.mjs <deploy-dir>
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.argv[2] ?? '.');
const store = path.join(root, 'node_modules', '.pnpm');
const readPkg = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));

function resolveFrom(dir, name) {
  // dir is a real package directory; its siblings live in the enclosing node_modules folders.
  for (let d = path.dirname(dir); d !== path.dirname(d); d = path.dirname(d)) {
    const scopeAware = d.endsWith('node_modules') ? d : null;
    if (!scopeAware) continue;
    const candidate = path.join(d, name);
    if (fs.existsSync(path.join(candidate, 'package.json'))) return fs.realpathSync(candidate);
  }
  return null;
}

function requiredDeps(pkg) {
  const optionalPeers = new Set(
    Object.entries(pkg.peerDependenciesMeta ?? {})
      .filter(([, m]) => m?.optional)
      .map(([n]) => n),
  );
  return [
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.optionalDependencies ?? {}),
    ...Object.keys(pkg.peerDependencies ?? {}).filter((n) => !optionalPeers.has(n)),
  ];
}

const visited = new Set();
const queue = [];
const top = readPkg(root);
for (const name of Object.keys(top.dependencies ?? {})) {
  const p = path.join(root, 'node_modules', name);
  if (fs.existsSync(p)) queue.push(fs.realpathSync(p));
}
while (queue.length) {
  const dir = queue.pop();
  if (visited.has(dir)) continue;
  visited.add(dir);
  for (const dep of requiredDeps(readPkg(dir))) {
    const r = resolveFrom(dir, dep);
    if (r && !visited.has(r)) queue.push(r);
  }
}

let removed = 0;
for (const entry of fs.readdirSync(store)) {
  const nm = path.join(store, entry, 'node_modules');
  if (!fs.existsSync(nm)) continue;
  const owned = fs
    .readdirSync(nm)
    .flatMap((n) =>
      n.startsWith('@')
        ? fs.readdirSync(path.join(nm, n)).map((s) => path.join(nm, n, s))
        : [path.join(nm, n)],
    )
    .filter((p) => !fs.lstatSync(p).isSymbolicLink());
  if (owned.length && owned.every((p) => !visited.has(fs.realpathSync(p)))) {
    fs.rmSync(path.join(store, entry), { recursive: true, force: true });
    removed += 1;
  }
}
// Drop dangling top-level links left behind.
for (const name of fs.readdirSync(path.join(root, 'node_modules'))) {
  const p = path.join(root, 'node_modules', name);
  if (name.startsWith('.')) continue;
  const items = name.startsWith('@') ? fs.readdirSync(p).map((s) => path.join(p, s)) : [p];
  for (const i of items) if (!fs.existsSync(i)) fs.rmSync(i, { force: true });
}
console.log(`pruned ${removed} packages reachable only through optional peers`);
