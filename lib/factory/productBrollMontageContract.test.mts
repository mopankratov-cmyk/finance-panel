// Contract test for real-photo montage lane. Run: npx tsx lib/factory/productBrollMontageContract.test.mts
import { readFileSync } from "node:fs";
import { ok } from "node:assert/strict";

const route = readFileSync("app/api/factory/product-broll-montage/route.ts", "utf8");
const studio = readFileSync("app/inferno/product-twins/ProductTwinStudio.tsx", "utf8");
const falVideo = readFileSync("lib/factory/falVideo.ts", "utf8");

ok(/isAuthorizedReelsBrainJobRequest/.test(route), "montage route uses existing operator auth");
ok(/derived_from_source/.test(route) && /real-photo/i.test(route), "montage route only selects real-photo derived views");
ok(/falTimeline/.test(route) && /rehostImageForFal/.test(route), "montage route renders a still-image timeline through existing compose helpers");
ok(/archiveExternalMediaToYandex/.test(route) && /disk: "gen"/.test(route), "montage route archives completed renders and catalogs them");
ok(/"status" \| "feedback"/.test(route) && /resolveTimelineStatus/.test(route), "montage route supports pending-status polling and operator feedback");
ok(/hero_front/.test(route) && /hardware_detail|closure_detail/.test(route), "montage route uses slot-based ordering for apparel and bag views");
ok(/id: "img", type: "image", keyframes: imageKeyframes/.test(falVideo), "fal timeline keeps slideshow stills on one image track");
ok(/Plan Montage/.test(studio) && /Render Montage/.test(studio), "studio exposes montage actions");
ok(/manual only · use real-photo motion montage/.test(studio) && /Check Status/.test(studio), "studio sends apparel and bags into the montage lane with status polling");

console.log("productBrollMontageContract: passed");
