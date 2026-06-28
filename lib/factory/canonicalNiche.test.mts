import { equal } from "node:assert/strict";
import { canonicalNiche } from "./rubric";

equal(canonicalNiche("ru_cosmetics"), "cosmetics");
equal(canonicalNiche("cream"), "cosmetics");
equal(canonicalNiche("beauty"), "cosmetics");
equal(canonicalNiche("apparel"), "clothing");
equal(canonicalNiche("jackets"), "clothing");
equal(canonicalNiche("blasters"), "toys");
equal(canonicalNiche("water-guns"), "toys");
equal(canonicalNiche("unknown", "TT-1", ""), "toys");
equal(canonicalNiche("", "", "spf cream"), "cosmetics");

console.log("canonicalNiche: passed");
