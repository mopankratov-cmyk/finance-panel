import { readdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const roots = ["lib", "tests", "components"];
const files = [];

function collect(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) collect(path);
    else if (entry.isFile() && entry.name.endsWith(".test.mts")) files.push(path);
  }
}

for (const root of roots) collect(root);
files.sort();

// Windows ограничивает длину командной строки. Небольшие партии сохраняют
// единый кроссплатформенный npm test и тот же Node test runner, что использует CI.
for (let offset = 0; offset < files.length; offset += 40) {
  const batch = files.slice(offset, offset + 40);
  const result = spawnSync(process.execPath, ["--import", "tsx", "--test", ...batch], {
    stdio: "inherit",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log(`Проверено файлов тестов: ${files.length}`);
