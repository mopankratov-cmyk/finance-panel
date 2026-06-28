import { readFileSync } from "node:fs";
import { ok } from "node:assert/strict";

const source = readFileSync("lib/factory/recipeTransfer.ts", "utf8");

ok(!/prompt:\s*specializeText\(n\.prompt/.test(source), "recipeTransfer must not copy template prompt verbatim");
ok(!/voiceover:\s*voiceover\s*\|\|\s*n\.voiceover/.test(source), "recipeTransfer must not store competitor voiceover fallback");
ok(/source:\s*"pattern_skeleton"/.test(source), "transferred recipes are marked as pattern skeletons");
ok(/template_skeleton_only:\s*true/.test(source), "node params declare skeleton-only transfer");
ok(/Do not copy competitor wording/.test(source), "generated prompt explicitly forbids competitor copy");

console.log("recipeTransferNoVerbatim: passed");
