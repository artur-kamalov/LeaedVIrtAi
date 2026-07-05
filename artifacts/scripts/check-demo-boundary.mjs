import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();
const scannedRoots = [
  "apps/api/src/modules/integrations",
  "apps/web/src/app/(app)",
  "apps/web/src/app/(auth)",
  "apps/web/src/design/product",
  "apps/web/src/components",
  "apps/web/src/lib",
];

const forbiddenPatterns = [
  { pattern: /from\s+["']\.\.\/data["']/u, reason: "imports product demo fixtures" },
  { pattern: /from\s+["']\.\/data["']/u, reason: "imports product demo fixtures" },
  { pattern: /from\s+["']@\/design\/product\/data["']/u, reason: "imports product demo fixtures" },
  { pattern: /from\s+["']@\/design\/demo\//u, reason: "imports demo-only module" },
  { pattern: /from\s+["']@\/features\/mock\//u, reason: "imports archived mock data" },
  { pattern: /from\s+["']@\/legacy-functional\//u, reason: "imports archived legacy UI" },
  { pattern: /legacy-functional/u, reason: "references archived legacy UI" },
  { pattern: /authMode\s*\?\?\s*["']demo["']/u, reason: "falls back to demo auth mode" },
  { pattern: /demo-режим|Demo-подключён|показаны демо-данные|показаны демо-переключатели/u, reason: "shows demo fallback in real app" },
  { pattern: /fallback-\d{4}-\d{2}/u, reason: "contains fake billing rows" },
  { pattern: /sk-(?:live|test)-[•\w-]+/u, reason: "contains fake API key material" },
  { pattern: /@glow\.ru/u, reason: "contains copied demo team members" },
  { pattern: /leadvirt_demo|demo_client|leadvirt-demo-event|webhook\.demo@example\.com|mock-адаптер/u, reason: "contains demo-looking integration sample data" },
];

const forbiddenFiles = [
  {
    path: "apps/web/src/design/product/data.ts",
    reason: "keeps copied demo fixtures inside the real product design area",
  },
];

function walk(dir) {
  const entries = [];
  for (const item of readdirSync(dir)) {
    const path = join(dir, item);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      entries.push(...walk(path));
      continue;
    }
    if (/\.(tsx?|jsx?)$/u.test(item)) entries.push(path);
  }
  return entries;
}

const failures = [];

for (const file of forbiddenFiles) {
  if (existsSync(join(root, file.path))) {
    failures.push(`${file.path}: ${file.reason}`);
  }
}

for (const scannedRoot of scannedRoots) {
  const absoluteRoot = join(root, scannedRoot);
  for (const file of walk(absoluteRoot)) {
    const source = readFileSync(file, "utf8");
    for (const { pattern, reason } of forbiddenPatterns) {
      if (pattern.test(source)) {
        failures.push(`${relative(root, file)}: ${reason}`);
      }
    }
  }
}

if (failures.length > 0) {
  console.error("Demo boundary check failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Demo boundary check passed.");
