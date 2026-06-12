import { chromium, type Page } from "playwright";
import { mkdirSync } from "fs";

const VIEWPORT = { width: 1440, height: 900 };

// вкладка inferno (page=...) ↔ мой роут
const TABS: { key: string; mine: string }[] = [
  { key: "home", mine: "/" }, // главная: inferno / ↔ мой /
  { key: "rnp", mine: "/analytics/rnp" },
  { key: "planning", mine: "/analytics/planning" },
  { key: "unit", mine: "/unit" },
  { key: "supplies", mine: "/supplies" },
  { key: "adverts", mine: "/analytics/ads" },
  { key: "ctrtest", mine: "/analytics/ctrtest" },
  { key: "design", mine: "/analytics/design" },
  { key: "seo", mine: "/analytics/seo" },
  { key: "sklejki", mine: "/analytics/sklejki" },
  { key: "roadmap", mine: "/roadmap" },
];

async function shoot(page: Page, path: string) {
  await page.screenshot({ path, fullPage: false });
}

async function captureInferno(page: Page) {
  // главная
  await page.goto("https://infernoff.ru/", { waitUntil: "networkidle", timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(1500);
  await shoot(page, "shots/inferno/home.png");

  // SPA /wb/ — переключаем вкладки через Alpine
  await page.goto("https://infernoff.ru/wb/", { waitUntil: "networkidle", timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(2500);
  for (const t of TABS) {
    if (t.key === "home") continue;
    await page.evaluate((key) => {
      // @ts-expect-error Alpine глобально
      const A = window.Alpine;
      const root = document.querySelector("[x-data]");
      if (A && root) {
        const d = A.$data(root);
        if (d) {
          d.page = key;
          if ("view" in d) d.view = "main";
        }
      }
    }, t.key).catch(() => {});
    await page.waitForTimeout(1800);
    await shoot(page, `shots/inferno/${t.key}.png`);
  }
}

async function captureMine(page: Page) {
  for (const t of TABS) {
    await page.goto(`http://localhost:3000${t.mine}`, { waitUntil: "networkidle", timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(1800);
    await shoot(page, `shots/mine/${t.key}.png`);
  }
}

async function main() {
  mkdirSync("shots/inferno", { recursive: true });
  mkdirSync("shots/mine", { recursive: true });

  const target = process.argv[2]; // "inferno" | "mine" | undefined (оба)
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: VIEWPORT, colorScheme: "dark", deviceScaleFactor: 1 });
  const page = await ctx.newPage();

  if (target !== "mine") await captureInferno(page);
  if (target !== "inferno") await captureMine(page);

  await browser.close();
  console.log("done");
}

main();
