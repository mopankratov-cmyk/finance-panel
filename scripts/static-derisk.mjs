// Де-риск StaticV1: рендер нескольких стиллов локально через renderStill (без fal/VM) → out/static-*.png.
// usage: node scripts/static-derisk.mjs
import {bundle} from "@remotion/bundler";
import {renderStill, selectComposition} from "@remotion/renderer";
import path from "path";
import fs from "fs";

const entry = path.resolve("remotion/index.ts");
const BAG = "https://jwjobmdihddytqfgymus.supabase.co/storage/v1/object/public/factory-media/prepared/CLR00912/7943edeb28fa-staged.png";
const variants = [
  {name: "pin-hero", props: {format: "pin_2x3", archetype: "headline_hero", productImage: BAG, headline: "Сумка, в которую влезает рабочая неделя", price: "2 990 ₽", oldPrice: "4 490 ₽", badge: "-33%", brand: "CLÉRIN", accent: "#d9603b"}},
  {name: "pin-color", props: {format: "pin_2x3", archetype: "product_color", productImage: BAG, headline: "Та самая офисная", price: "2 990 ₽", brand: "CLÉRIN", bg: "#e0a92e"}},
  {name: "pin-proof", props: {format: "pin_2x3", archetype: "social_proof", productImage: BAG, headline: "Кожа, что держит форму", price: "2 990 ₽", proof: "12 000+ отзывов", accent: "#d12f4a"}},
  {name: "card-benefits", props: {format: "card_3x4", archetype: "card_benefits", productImage: BAG, headline: "Каркасная сумка-тоут", bullets: ["Держит форму годами", "Вмещает ноутбук 14\"", "Эко-кожа, не царапается"], price: "2 990 ₽", badge: "ХИТ", accent: "#d9603b"}},
];

fs.mkdirSync("out", {recursive: true});
const serveUrl = await bundle({entryPoint: entry});
for (const v of variants) {
  const composition = await selectComposition({serveUrl, id: "StaticV1", inputProps: v.props});
  const output = `out/static-${v.name}.png`;
  await renderStill({serveUrl, composition, output, frame: 0, inputProps: v.props, overwrite: true});
  console.log(`✅ ${v.name} (${composition.width}x${composition.height}) → ${output}`);
}
process.exit(0);
