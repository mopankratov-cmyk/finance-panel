// Clean product source prompt fixtures. Run: npx tsx lib/factory/productCleanSource.test.mts
import { buildProductCleanPrompt, imageBufferToDataUrl } from "./productCleanSource";

let pass = 0, fail = 0;
function ok(c: boolean, m: string) { if (c) pass++; else { fail++; console.error("✗ " + m); } }

{
  const p = buildProductCleanPrompt({ article: "TT04102", product: "green water blaster", category: "toy" });
  ok(/Extract only the green water blaster/i.test(p), "toy prompt extracts only product");
  ok(/Remove all people, hands, water streams/i.test(p), "toy prompt removes people/hands/water streams");
  ok(/background Russian promo text, badges, checkmarks, EAC marks/i.test(p), "toy prompt removes infographic marks");
  ok(/Do not remove or rewrite real markings printed directly on the toy body/i.test(p), "toy prompt preserves product body markings");
  ok(/no fire, no extra objects/i.test(p), "toy prompt blocks effects/extras");
}

{
  const p = buildProductCleanPrompt({ article: "YYS0101", product: "YOYO SPF50 sunscreen cream", category: "cosmetics" });
  ok(/skin photos, claims, plus icons/i.test(p), "cosmetics prompt removes infographic/claims");
  ok(new RegExp("printed SPF/shade text, brand logo", "i").test(p), "cosmetics prompt preserves label/logo");
  ok(/Do not simplify the packaging into a generic blank bottle/i.test(p), "cosmetics prompt blocks over-simplified packaging");
  ok(/Do not remove, rewrite, blur, enlarge, translate or invent real product markings/i.test(p), "cosmetics prompt protects label identity");
  ok(/Keep only the real product packaging text/i.test(p), "cosmetics prompt distinguishes packaging text from poster text");
  ok(/No extra text outside the product/i.test(p), "cosmetics prompt distinguishes product markings from outside text");
  ok(/no extra objects/i.test(p), "cosmetics prompt blocks extras");
}

{
  const uri = imageBufferToDataUrl(Buffer.from("abc"), "image/png");
  ok(uri === "data:image/png;base64,YWJj", "buffer converts to data URL");
}

{
  const p = buildProductCleanPrompt({ article: "NV-08", product: "NORVIA jacket", category: "apparel" });
  ok(/Remove the model body, face, hair, hands/i.test(p), "apparel prompt removes model/person from clean twin");
  ok(/ghost mannequin or flat clean packshot/i.test(p), "apparel prompt creates clean garment twin");
  ok(/fabric texture, wrinkles, color/i.test(p), "apparel prompt preserves fabric detail");
}

{
  const p = buildProductCleanPrompt({ article: "CLR00716", product: "CLERIN crossbody bag", category: "bag" });
  ok(/handle and strap geometry/i.test(p), "bag prompt preserves strap/handle geometry");
  ok(/leather grain|fabric texture/i.test(p), "bag prompt preserves material detail");
  ok(/Remove the model, hands, body/i.test(p), "bag prompt separates clean bag from lifestyle source");
}

console.log(`\nproductCleanSource: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
