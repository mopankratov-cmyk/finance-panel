// Content disk path fixtures. Run: npx tsx lib/factory/contentDisks.test.mts
import { articleForPath, nicheForPath, sourceFor } from "./contentDisks";

let pass = 0, fail = 0;
function ok(c: boolean, m: string) { if (c) pass++; else { fail++; console.error("✗ " + m); } }

const greenUzi = "/МАША/УЗИ зеленый/NEW светлая/2.png";
ok(articleForPath("design", greenUzi) === "TT04102", "green UZI disk path maps to TT04102");
ok(nicheForPath("design", greenUzi)?.niche === "blasters", "green UZI disk path maps to blasters niche");
ok(Boolean(sourceFor("green water blaster", "TT04102")?.paths.includes("/МАША/УЗИ зеленый")), "sourceFor returns actual green UZI path");
ok(articleForPath("design", "/МАША/Крем-молочко YOYO/1.png") === "YYS0101", "YOYO path maps to YYS0101");

console.log(`\ncontentDisks: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
