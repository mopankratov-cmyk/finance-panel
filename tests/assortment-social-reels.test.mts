import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  acceptNeighborTopic, cleanHashtags, detectBrand, detectDirection, extractRefs, intentShare, isEmptyReelShell, looksMenswear, measureDue, medianBaseline, parseAltDate,
  parseCount, parseGoogleReels, parseProfilePage, parseReelPage, parseTopicPage, parseUniqloCard, parseZaraCard, passwordWords, REELS_RULE_VERSION,
  sanitizeCaption, SEED_ACCOUNTS, SEED_TOPICS, shortcodeToDate, socialConfig, socialRefKeyFromUrl, uniqloCardUrls, verdictV1, withinDiscoveryWindow, zaraCardUrl,
  type BaselinePost, type VerdictInput,
} from "../lib/assortment/socialReels.ts";
import { normalizeProductUrl } from "../lib/assortment/extract.ts";
import { containsMoney } from "../lib/assortment/attributes.ts";

/**
 * «Залетает в соцсетях»: разбор страниц Instagram (живые ответы Web Unlocker 06.10, обезличенные), номера товаров, доля «купить»
 * и правило reels-v1 на примерах владельца и обычных постах тех же авторов (калибровка 06.10).
 */

const root = fileURLToPath(new URL("..", import.meta.url));
const fixtures = join(root, "tests/fixtures/assortment-social");
const fixture = (name: string) => readFileSync(join(fixtures, name), "utf8");
const expected = JSON.parse(fixture("responses.json")) as Record<string, { expect: Record<string, unknown> }>;
const DAY = 24 * 3600 * 1000;
const at = (s: string) => Date.parse(s);

// --- дата из кода и числа ---

test("Дата из кода рилса: три примера владельца; дата Instagram в подписи — по Тихоокеанскому времени", () => {
  assert.equal(shortcodeToDate("Dd4Is8To7B0")?.toISOString(), "2026-09-29T15:58:38.592Z");
  assert.equal(shortcodeToDate("Dd0zjHwxvcD")?.toISOString(), "2026-09-28T08:56:04.794Z");
  // Instagram пишет «September 15»: 05:51 UTC 16.09 — это 22:51 15.09 в Лос-Анджелесе.
  assert.equal(shortcodeToDate("DdVk7eRtLMC")?.toISOString(), "2026-09-16T05:51:52.572Z");
  for (const [name, e] of Object.entries(expected)) {
    if (typeof e.expect.postedAtUtc === "string") assert.equal(shortcodeToDate(String(e.expect.code))?.toISOString(), e.expect.postedAtUtc, name);
  }
  assert.equal(shortcodeToDate("Dzzz/zzzzzz"), null);
  assert.equal(shortcodeToDate("Dd4Is8To7B0Dd4Is8To7B0"), null, "длинные коды закрытых аккаунтов не декодируем");
  assert.equal(parseAltDate("September 29, 2026"), "2026-09-29");
  assert.equal(parseAltDate("October 05, 2026"), "2026-10-05");
});

test("Числа со страницы: K, M, запятая тысяч, пробел, неразрывный пробел; непонятное — null, не 0", () => {
  const cases: Array<[string, number | null]> = [
    ["3.7K", 3700], ["1,482", 1482], ["1.1M", 1_100_000], ["3 700", 3700], ["3 700", 3700], ["4,112", 4112], ["57.6K", 57_600],
    ["3,003", 3003], ["315K", 315_000], ["59", 59], ["1,5K", 1500], ["2.9M", 2_900_000], ["", null], ["abc", null], ["1.2.3", null],
  ];
  for (const [raw, value] of cases) assert.equal(parseCount(raw), value, raw);
  assert.equal(parseCount(null), null);
});

// --- страницы ---

test("Страница рилса, десктоп: автор, лайки, комментарии, подпись, хэштеги, номер, видимые комментарии без ников, сетка автора", () => {
  const r = parseReelPage(fixture("reel-desktop-likes-visible.md"))!;
  const e = expected["reel-desktop-likes-visible.md"].expect;
  assert.equal(r.code, e.code);
  assert.equal(r.kind, "reel");
  assert.equal(r.layout, "desktop");
  assert.equal(r.author, e.author);
  assert.equal(r.likes, parseCount(String(e.likes)));
  assert.equal(r.likesHidden, false);
  assert.equal(r.comments, Number(e.comments));
  assert.deepEqual(r.hashtags, e.hashtags);
  assert.match(r.caption, /Reference 5854\/722\/710/);
  assert.equal(r.visibleComments.length, e.visibleComments);
  assert.equal(r.distinctCommenters, e.distinctCommenters);
  assert.equal(r.otherPosts.length, e.morePosts);
  assert.equal(r.altDate, "2026-09-29");
  assert.ok(r.altItems.includes("parka"));
  assert.equal(r.publishedAt, e.postedAtUtc);
  // Людей не отдаём: в результате нет ни одного ника комментатора.
  assert.doesNotMatch(JSON.stringify(r), /commenter\d/);
});

test("Комментарий отделён от ника неразрывным пробелом: с обычным пробелом разбор молча нашёл бы 0 комментариев", () => {
  const md = fixture("reel-desktop-likes-visible.md");
  assert.ok(md.includes("](/commenter1/) [5h]"), "в образце стоит NBSP");
  assert.equal(parseReelPage(md)!.visibleComments.length, 15);
});

test("Лайки скрыты — null и признак «скрыты», а не 0; соавтор из шапки; закреплённые посты в сетке", () => {
  const r = parseReelPage(fixture("reel-desktop-likes-hidden-collab.md"))!;
  assert.equal(r.likes, null);
  assert.equal(r.likesHidden, true);
  assert.equal(r.comments, 10);
  assert.equal(r.author, "buyer_services_");
  assert.deepEqual(r.coauthors, ["addicted_tozara"]);
  assert.equal(r.visibleComments.length, 5);
  assert.deepEqual(r.otherPosts.filter((p) => p.pinned).map((p) => p.code), ["DY14znQoxr-", "DcdYqlkiPhe", "C_fQ644IOWP"], "старые посты в начале сетки — закреплённые");
  const carousel = parseReelPage(fixture("post-carousel-desktop-likes-hidden.md"))!;
  assert.equal(carousel.kind, "post");
  assert.equal(carousel.likes, null);
  assert.equal(carousel.comments, 23);
  assert.equal(carousel.visibleComments.length, 12);
  assert.deepEqual(carousel.otherPosts.filter((p) => p.pinned).map((p) => p.code), ["Dd4Is8To7B0"], "Анна закрепила свой залёт");
});

test("«Edited•2w», артикул хэштегом, чужой пост соавтора в сетке; подпись автора с галочкой; кириллический хэштег", () => {
  const r = parseReelPage(fixture("reel-desktop-edited-hashtag-article.md"))!;
  assert.equal(r.likes, 6400);
  assert.equal(r.comments, 176);
  assert.deepEqual(r.hashtags, ["487882"]);
  assert.match(r.caption, /^ГИБРИДНЫЙ ПУХОВИК/);
  assert.deepEqual(r.otherPosts.filter((p) => p.owner !== r.author).map((p) => `${p.owner}/${p.code}`), ["coauthor1/Dd8nlbbje56"]);
  const v = parseReelPage(fixture("reel-desktop-verified-author.md"))!;
  assert.equal(v.author, "365.prosto");
  assert.deepEqual(v.hashtags, ["uniqlo", "lifewear", "распаковка"]);
  assert.equal(v.likes, 3600);
  assert.equal(v.comments, 118);
});

test("Мобильная вёрстка: «90 likes», «View all 5 comments», обрезанная подпись, без тел комментариев; сетка с обрезанным хвостом", () => {
  const r = parseReelPage(fixture("reel-mobile-layout.md"))!;
  assert.equal(r.layout, "mobile");
  assert.equal(r.likes, 90);
  assert.equal(r.comments, 5);
  assert.equal(r.captionTruncated, true);
  assert.equal(r.visibleComments.length, 0);
  assert.equal(r.altDate, null, "главного alt в мобильной вёрстке нет");
  assert.equal(r.otherPosts.length, 8);
  assert.ok(r.otherPosts.some((p) => p.owner === "coauthor1"));
});

test("Несуществующий рилс — пустая оболочка: «страницы нет», а не 0 лайков", () => {
  const md = fixture("reel-not-found-shell.md");
  assert.equal(isEmptyReelShell(md), true);
  assert.equal(parseReelPage(md), null);
  assert.equal(parseReelPage(""), null);
  // Стена входа: ссылка «Log In» с кодом есть, а поста нет — тоже «страницы нет», а не рилс без лайков.
  const wall = " Instagram \n\n[Log In](/accounts/login/?next=%2Freel%2FDzzzzzzzzzz%2F&source=desktop_nav)\n\n[Sign Up](/accounts/emailsignup/)\n\n![](data:image/png;base64,PLACEHOLDER)";
  assert.equal(parseReelPage(wall), null);
});

test("Страница темы: число рилсов, 10 соседних тем, 12 карточек с ПРОСМОТРАМИ; ник — из адреса, а не из обрезанного текста", () => {
  const t = parseTopicPage(fixture("topic-zara-viral-jacket.md"))!;
  assert.equal(t.total, 4300);
  assert.equal(t.neighbors.length, 10);
  assert.equal(t.cards.length, 12);
  assert.deepEqual({ code: t.cards[0].code, author: t.cards[0].author, views: t.cards[0].views }, { code: "DdzBLwaAG34", author: "what.bri.wears", views: 35_500 });
  const ours = t.cards.find((c) => c.code === "Dd4Is8To7B0")!;
  assert.equal(ours.views, 315_000);
  assert.match(ours.caption, /Reference 5854\/722\/710/);
  const bag = parseTopicPage(fixture("topic-zara-bag.md"))!;
  assert.equal(bag.total, 3_000_000);
  assert.equal(bag.cards[0].verified, true);
  assert.equal(bag.cards.find((c) => c.code === "DVzGwzRiuoe")?.author, "boutique_piana_72", "в тексте ссылки «boutique\\_pian...»");
  assert.equal(bag.cards.find((c) => c.code === "DVzGwzRiuoe")?.views, 4112);
  const uq = parseTopicPage(fixture("topic-uniqlo-jacket.md"))!;
  assert.equal(uq.total, 213_000);
  assert.deepEqual([uq.cards[0].code, uq.cards[0].author, uq.cards[0].views], ["DdfGMmhSyY0", "rachtrinity", 1_100_000]);
  assert.equal(parseTopicPage("Instagram"), null);
});

test("Профиль: подписчики («57.6K», «3,003»), сетка 12 постов, закреплённые и чужой пост соавтора помечены", () => {
  const p = parseProfilePage(fixture("profile-jpnbrands.md"))!;
  assert.equal(p.handle, "jpnbrands");
  assert.equal(p.followers, 57_600);
  assert.equal(p.posts.length, 12);
  assert.deepEqual(p.posts.filter((x) => x.pinned).map((x) => x.code), ["DbShHUXCO46", "C-CqgEwNGDg", "DVXUyIdgkim"]);
  assert.deepEqual(p.posts.filter((x) => x.owner !== "jpnbrands").map((x) => x.code), ["Dd8nlbbje56"]);
  const a = parseProfilePage(fixture("profile-by-annamirabelle.md"))!;
  assert.equal(a.followers, 3003);
  assert.equal(a.posts.length, 12);
  assert.deepEqual(a.posts.filter((x) => x.pinned).map((x) => x.code), ["Dd4Is8To7B0"]);
});

test("Google: только коды рилсов из ссылок; описанию выдачи не верим", () => {
  const z = parseGoogleReels(fixture("google-reel-zara-ref.json"));
  assert.equal(z.length, 10);
  assert.equal(z[0].code, "DeExO9NMruK");
  assert.equal(z[0].url, "https://www.instagram.com/reel/DeExO9NMruK/");
  const u = parseGoogleReels(JSON.parse(fixture("google-reel-uniqlo-jacket-gl-us.json")));
  assert.equal(u[0].code, "DeJ051ioDKn");
  assert.deepEqual(parseGoogleReels(""), [], "пустой ответ (капча) — ничего");
  assert.deepEqual(parseGoogleReels({ organic: [{ link: "https://www.zara.com/x" }, { link: "https://www.instagram.com/someone/reel/DeExO9NMruK/" }] }).map((r) => r.code), ["DeExO9NMruK"]);
});

test("Карточки брендов: Zara — название и цвет по номеру (пола в markdown нет), Uniqlo — женская, фото с image.uniqlo.com; цены не берём", () => {
  const z = parseZaraCard(fixture("zara-card-p05854722.md"), "5854722")!;
  assert.deepEqual(z, { name: "HIGH-NECK POCKET JACKET", gender: "unknown", image: null, color: "Beige" });
  assert.equal(parseZaraCard(fixture("zara-card-p05854722.md"), "1234567"), null, "номера на странице нет — это не та модель");
  const u = parseUniqloCard(fixture("uniqlo-card-E487882.md"), "487882")!;
  assert.equal(u.name, "Hybrid Down Short Jacket");
  assert.equal(u.gender, "women");
  assert.match(u.image ?? "", /^https:\/\/image\.uniqlo\.com\/.*\/487882\/item\//);
  assert.doesNotMatch(JSON.stringify([z, u]), /PRICE/);
  const men = fixture("uniqlo-card-E487882.md").replace("Women's Hybrid", "Men's Hybrid").replace(/\n(\s*)WOMEN\n/, "\n$1MEN\n");
  assert.equal(parseUniqloCard(men, "487882")?.gender, "men");
  assert.equal(parseUniqloCard("# Something\nProduct not found", "487882"), null);
});

// --- номера, бренд, раздел ---

test("Номера Zara: с «ref / reference / ZARA |» и без; цвет отдельно; MMMM/QQQ без цвета — только с пометкой; даты и цены — не номера", () => {
  const keys = (text: string, hint: "zara" | "uniqlo" | null = null) => extractRefs(text, hint).map((r) => r.key);
  assert.deepEqual(keys("Reference 5854/722/710"), ["zara:5854722"]);
  assert.deepEqual(extractRefs("HIGH-COLLAR JACKET | ZARA | 5854/722/710")[0], { key: "zara:5854722", brand: "zara", model: "5854722", color: "710", raw: "5854/722/710" });
  assert.deepEqual(keys("Jacket code : 8490/892/700"), ["zara:8490892"]);
  assert.deepEqual(keys("Ceket ref:4391/892"), ["zara:4391892"]);
  assert.deepEqual(keys("Skirt is from Zara Ref. 2830/423"), ["zara:2830423"]);
  assert.deepEqual(keys("bag 6319/810", "zara"), ["zara:6319810"], "рилс про Zara — номер без цвета принимаем");
  assert.deepEqual(keys("bag 6319/810"), [], "без пометки и вне Zara — не номер");
  assert.deepEqual(keys("4749/723/600; 8490/707/700; 4341/803/800"), ["zara:4749723", "zara:8490707", "zara:4341803"]);
  assert.deepEqual(keys("2026/10/06 и 2026/100"), [], "даты");
  assert.deepEqual(keys("цена 1299/150 руб"), [], "сумма рядом с валютой");
  assert.deepEqual(keys("zara bag 1299/150 руб", "zara"), [], "сумма рядом с валютой — и в рилсе про Zara");
  assert.deepEqual(keys("zara 5854/722/710 €"), [], "число с валютой — сумма, не номер");
  assert.deepEqual(keys("12345/678/901"), [], "часть длинного числа");
});

test("Номера Uniqlo: «АРТИКУЛ: #487882», «Product ID», «арт.», «品番», хэштег #4NNNNN; не в рилсе про Zara; 10-значные хэштеги — не номер", () => {
  const keys = (text: string, hint: "zara" | "uniqlo" | null = null) => extractRefs(text, hint).map((r) => r.key);
  assert.deepEqual(keys("АРТИКУЛ: #487882"), ["uniqlo:487882"]);
  assert.deepEqual(keys("Product ID: 487516 Zip Up Short Jacket"), ["uniqlo:487516"]);
  assert.deepEqual(keys("арт. 478577, состав"), ["uniqlo:478577"]);
  assert.deepEqual(keys("フリーススタンドブルゾン\n品番 487517"), ["uniqlo:487517"]);
  assert.deepEqual(keys("#487689 #uniqlo"), ["uniqlo:487689"]);
  assert.deepEqual(keys("E487882-000"), ["uniqlo:487882"]);
  assert.deepEqual(keys("#5272612331 #4692901414"), [], "10-значные хэштеги");
  assert.deepEqual(keys("#387689 #123456"), [], "номер Uniqlo начинается на 4");
  assert.deepEqual(keys("арт 487882", "zara"), [], "рилс про Zara");
  assert.deepEqual(keys("артикул 459000 сум"), [], "сумма");
});

test("Бренд: по подписи и хэштегам; без слова бренда — по номеру; иначе по теме", () => {
  assert.equal(detectBrand({ caption: "Love it! Zara did it right", hashtags: [] }), "zara");
  assert.equal(detectBrand({ caption: "", hashtags: ["uniqlo", "lifewear"] }), "uniqlo");
  assert.equal(detectBrand({ caption: "ГИБРИДНЫЙ ПУХОВИК. АРТИКУЛ: #487882", hashtags: ["487882"], refs: extractRefs("АРТИКУЛ: #487882") }), "uniqlo");
  assert.equal(detectBrand({ caption: "Welche Jacke?", topic: "zara-viral-jacket" }), "zara");
  assert.equal(detectBrand({ caption: "на базаре купила" }), null, "«базаре» — не Зара");
  assert.equal(detectBrand({ caption: "Zara and Uniqlo haul", topic: "uniqlo-jacket" }), "uniqlo");
});

test("Раздел: куртки или сумки по словам подписи, хэштегам, подписи кадра и теме; без слов — null", () => {
  assert.equal(detectDirection({ caption: "HIGH-COLLAR JACKET WITH POCKETS" }), "jackets");
  assert.equal(detectDirection({ caption: "Современная телогрейка от Uniqlo" }), "jackets");
  assert.equal(detectDirection({ caption: "Sac zara grand modèle" }), "bags");
  assert.equal(detectDirection({ caption: "Love it!", hashtags: ["zarajacket"] }), "jackets");
  assert.equal(detectDirection({ caption: "Zara New in", alt: ["purse", "handbag"] }), "bags");
  assert.equal(detectDirection({ caption: "September coffee strolls" }), null);
  assert.equal(detectDirection({ caption: "jacket and bag", topic: "zara-bag" }), "bags", "оба — решает тема");
});

test("Только женское: мужское по подписи и теме отсеивается (женское подтверждает лишь карточка)", () => {
  assert.equal(looksMenswear("Uniqlo x JW Anderson Jacket — men's"), true);
  assert.equal(looksMenswear("мужская куртка"), true);
  assert.equal(looksMenswear("Women's Hybrid Down Short Jacket"), false, "women's — не men's");
  assert.equal(looksMenswear("ГИБРИДНЫЙ ПУХОВИК (унисекс)"), false);
  assert.equal(acceptNeighborTopic("zara-viral-puffer-jacket"), "zara");
  assert.equal(acceptNeighborTopic("uniqlo-barn-jacket-women"), "uniqlo");
  assert.equal(acceptNeighborTopic("zara-men-jacket"), null);
  assert.equal(acceptNeighborTopic("zara-tote-bag-price"), "zara");
  assert.equal(acceptNeighborTopic("how-to-style-jeans"), null);
  assert.equal(acceptNeighborTopic("zara-dress"), null, "не куртки и не сумки");
});

// --- намерение купить ---

test("Доля «купить»: словарь калибровки; пример Анны — 9 из 15, пример jpnbrands — 11 из 15; ответы автора не в счёт", () => {
  const anna = parseReelPage(fixture("reel-desktop-likes-visible.md"))!;
  assert.deepEqual(intentShare(anna.visibleComments, anna.caption), { count: 9, total: 15, share: 0.6 });
  const jpn = parseReelPage(fixture("reel-desktop-edited-hashtag-article.md"))!;
  const s = intentShare(jpn.visibleComments, jpn.caption);
  assert.equal(s.count, 11);
  assert.equal(s.total, 15);
  const words = ["Link please", "Ref number please", "Where is it from?", "How much?", "price?", "Цена?", "Подскажите цену", "по цене", "стоимость с доставкой", "Сколько стоит?",
    "где купить?", "Где можно приобрести", "можно артикль", "Заказать хочу", "Размер М есть?", "есть такой размер?"];
  for (const w of words) assert.equal(intentShare([w]).count, 1, w);
  for (const w of ["So good 🔥", "😍😍", "Prześlij mi swój post", "Какой размер на вас?", "is it insulated?", "I prefer the black"]) assert.equal(intentShare([w]).count, 0, w);
  assert.deepEqual(intentShare([{ text: "Link in bio", byAuthor: true }, { text: "Link", byAuthor: false }]), { count: 1, total: 1, share: 1 });
});

test("Слова-пароли из подписи («Comment “LINKS”», «напишите ИНСТРУКЦИЯ») — накрутка, такие комментарии не считаются", () => {
  assert.deepEqual(passwordWords("The viral ZARA jacket🤎 Comment “LINKS” and I’ll send it"), ["links"]);
  assert.deepEqual(passwordWords("Comment SHOP below to receive a DM"), ["shop"]);
  assert.deepEqual(passwordWords("напишите в комментариях ИНСТРУКЦИЯ"), ["инструкция"]);
  assert.deepEqual(passwordWords("UNBOXING ZARA ✨ Scrivi REF nei commenti"), ["ref"]);
  assert.deepEqual(passwordWords("Link in my stories 🔗"), []);
  const caption = "Comment “LINK” and I’ll send it over";
  const comments = ["LINK", "Link please", "link 😍", "Цена?", "Where can I buy it?", "😍"];
  assert.deepEqual(intentShare(comments, caption), { count: 2, total: 3, share: 2 / 3 });
  assert.deepEqual(intentShare(Array(20).fill("Fall"), "comment “FALL” for links & sizing!"), { count: 0, total: 0, share: null });
});

// --- подпись для базы ---

test("Отрывок подписи: ≤500 знаков, без @упоминаний и без сумм (тг, руб, ₽, $, €)", () => {
  const raw = "Куртка @zara 5854/722/710 — цена 4 500 тг, в РФ 12 990 руб или 12990₽, $70, 130$, 4.500,00 € и 59.9 EUR. Пишите @shop_name";
  const out = sanitizeCaption(raw)!;
  assert.doesNotMatch(out, /@/);
  assert.doesNotMatch(out, /4 500|12 990|12990|70|130|4\.500|59\.9|[₽$€]|руб|тг/);
  assert.match(out, /5854\/722\/710/, "номер товара — не цена");
  assert.match(out, /цена/, "слово «цена» — не сумма");
  for (const amount of ["4 500 тг", "12 990 руб", "12990₽", "$70", "130$", "59.9 EUR"]) assert.equal(containsMoney(sanitizeCaption(`x ${amount} y`) ?? ""), false, amount);
  assert.equal(sanitizeCaption("а".repeat(800))!.length, 500);
  const emoji = sanitizeCaption("🤎".repeat(600))!;
  assert.equal(Array.from(emoji).length, 500, "500 символов, а не UTF-16 единиц");
  assert.doesNotMatch(emoji, /[\uD800-\uDBFF](?![\uDC00-\uDFFF])/, "эмодзи не разрезано пополам");
  assert.equal(sanitizeCaption("   "), null);
});

// --- база автора и правило ---

const DAYMS = DAY;
type CalPost = { code: string; date: string; likes: number | null; comments: number; pinned?: boolean };
/** Калибровка 06.10 (cal.authors): прошлые посты авторов с лайками и комментариями. */
const ANNA: CalPost[] = [
  { code: "Dd8kIL2IPms", date: "2026-10-01", likes: 113, comments: 0 }, { code: "Dd6RcZgCPXj", date: "2026-09-30", likes: null, comments: 12 },
  { code: "Dd08gHjCN0c", date: "2026-09-28", likes: null, comments: 23 }, { code: "DdWZZ4uo_kJ", date: "2026-09-16", likes: 359, comments: 8 },
  { code: "DdTcg6lovQ1", date: "2026-09-15", likes: 71, comments: 8 }, { code: "Dc_k4M-IEYm", date: "2026-09-07", likes: 96, comments: 13 },
  { code: "Dc0hxxWou9v", date: "2026-09-03", likes: 48, comments: 2 }, { code: "DcgVU3zoJlS", date: "2026-08-26", likes: 71, comments: 7 },
  { code: "DcvnQ7DiE0S", date: "2026-09-01", likes: null, comments: 6 }, { code: "DcbVWcnCOgc", date: "2026-08-24", likes: null, comments: 10 },
  { code: "DcTryw-CL7g", date: "2026-08-21", likes: null, comments: 8 },
];
const AIDA: CalPost[] = [
  { code: "Dd_OKpTR6nk", date: "2026-10-02", likes: 10, comments: 0 }, { code: "Dd_MNZfxjP0", date: "2026-10-02", likes: 15, comments: 0 },
  { code: "Dd3SBq_IVSh", date: "2026-09-29", likes: 29, comments: 3 }, { code: "Dd01GRvxh5V", date: "2026-09-28", likes: 35, comments: 2 },
  { code: "Dd00tLOxzK1", date: "2026-09-28", likes: 62, comments: 3 }, { code: "DdlY_vyIu_2", date: "2026-09-22", likes: 62, comments: 1 },
  { code: "Ddi2Yn4IZ4r", date: "2026-09-21", likes: 47, comments: 6 }, { code: "DdTmSwiI9nG", date: "2026-09-15", likes: 76, comments: 9 },
  { code: "DdTSSHvoCj6", date: "2026-09-15", likes: 93, comments: 8 }, { code: "Dbh91DhsGZe", date: "2026-08-02", likes: 23, comments: 1, pinned: true },
  { code: "DZKM4TxjJGC", date: "2026-06-04", likes: 971, comments: 46, pinned: true },
];
const JPN: CalPost[] = [
  { code: "DeJFcB4iWxs", date: "2026-10-05", likes: 283, comments: 15 }, { code: "DeGmqJRCDPx", date: "2026-10-04", likes: 65, comments: 3 },
  { code: "Dd8NdvPi0Yp", date: "2026-09-30", likes: 1482, comments: 176 }, { code: "Dd5ra5iCAzK", date: "2026-09-29", likes: 90, comments: 5 },
  { code: "Dd0mRmIiacc", date: "2026-09-28", likes: 387, comments: 2 }, { code: "Ddqfse0AohS", date: "2026-09-24", likes: 301, comments: 5 },
  { code: "DdnniDmIw5R", date: "2026-09-22", likes: 111, comments: 3 }, { code: "DdlO3H9iUKx", date: "2026-09-22", likes: 236, comments: 18 },
  { code: "DbShHUXCO46", date: "2026-07-27", likes: 273, comments: 8, pinned: true },
];
const toBase = (list: CalPost[]): BaselinePost[] => list.map((p) => ({ code: p.code, publishedAtMs: at(`${p.date}T12:00:00Z`), likes: p.likes, comments: p.comments, pinned: p.pinned }));
/** Доля намерения у обычных постов — фон из калибровки (строгий словарь): стилист 0%, перекупщик 32%, байер 38–54%. */
const BACKGROUND_INTENT: Record<string, { count: number; total: number }> = { anna: { count: 0, total: 10 }, aida: { count: 3, total: 10 }, jpn: { count: 5, total: 10 } };
const CAPTURE = at("2026-10-06T16:00:00Z");

test("Медиана автора: последние 12 по дате, без закреплённых, без кандидата, без постов младше 48 ч, лайки — без скрытых", () => {
  const anna = medianBaseline(toBase(ANNA), { candidateCode: "Dd4Is8To7B0", nowMs: CAPTURE });
  assert.deepEqual([anna.likesMedian, anna.likesPosts, anna.commentsMedian, anna.commentsPosts], [83.5, 6, 8, 11], "48, 71, 71, 96, 113, 359 → 83,5; комментарии 11 постов → 8");
  const aida = medianBaseline(toBase(AIDA), { candidateCode: "Dd0zjHwxvcD", nowMs: CAPTURE });
  assert.deepEqual([aida.likesMedian, aida.commentsMedian, aida.likesPosts], [47, 3, 9], "закреплённые 971 и 23 в медиану не идут");
  const jpn = medianBaseline(toBase(JPN), { candidateCode: "DdVk7eRtLMC", nowMs: CAPTURE });
  assert.equal(jpn.codes.includes("DeJFcB4iWxs"), false, "пост младше 48 ч не входит");
  assert.equal(jpn.likesMedian, 236);
  assert.equal(jpn.commentsMedian, 5);
  const candidateIn = medianBaseline(toBase([...JPN, { code: "DdVk7eRtLMC", date: "2026-09-16", likes: 6400, comments: 176 }]), { candidateCode: "DdVk7eRtLMC", nowMs: CAPTURE });
  assert.equal(candidateIn.likesMedian, 236, "сам кандидат в свою медиану не входит");
  const many = Array.from({ length: 30 }, (_, i) => ({ code: `C${i}`, publishedAtMs: CAPTURE - (3 + i) * DAYMS, likes: i < 12 ? 100 : 10_000, comments: 1 }));
  assert.equal(medianBaseline(many, { nowMs: CAPTURE }).likesMedian, 100, "берутся 12 последних по дате, старые не тянут медиану");
  const foreign = medianBaseline([...toBase(ANNA).map((p) => ({ ...p, owner: "by.annamirabelle" })), { code: "X", publishedAtMs: CAPTURE - 3 * DAYMS, likes: 99_999, comments: 999, owner: "coauthor1" }], { nowMs: CAPTURE, author: "by.annamirabelle" });
  assert.equal(foreign.likesMedian, 83.5, "пост соавтора не входит");
});

const judge = (likes: number | null, comments: number, intent: { count: number; total: number } | null, base: BaselinePost[], published: string, candidate: string, followers: number | null = null) =>
  verdictV1({ publishedAtMs: at(published), nowMs: CAPTURE, likes, comments, intent, baseline: medianBaseline(base, { candidateCode: candidate, nowMs: CAPTURE }), followers });

test("Правило reels-v1 на трёх примерах владельца: Анна и jpnbrands — «сильный залёт» (А и Б), aida — «залетает» (только А)", () => {
  const anna = parseReelPage(fixture("reel-desktop-likes-visible.md"))!;
  const a = judge(anna.likes, anna.comments!, intentShare(anna.visibleComments, anna.caption), toBase(ANNA), anna.publishedAt!, anna.code);
  assert.equal(a.verdict, "strong");
  assert.equal(a.rule, "main");
  assert.equal(a.preliminary, false);
  assert.equal(a.likesRatio, 44.31);
  assert.equal(a.commentsRatio, 7.38);
  // aida: 7 500 лайков, 59 комментариев, 1 из 4 видимых — «где купить» (25%): Б не выполняется.
  const aida = judge(7500, 59, { count: 1, total: 4 }, toBase(AIDA), "2026-09-28T08:56:04Z", "Dd0zjHwxvcD");
  assert.deepEqual([aida.verdict, aida.a, aida.b], ["viral", true, false]);
  assert.equal(aida.likesRatio, 159.57);
  const jpn = parseReelPage(fixture("reel-desktop-edited-hashtag-article.md"))!;
  const j = verdictV1({ publishedAtMs: at(jpn.publishedAt!), nowMs: at("2026-10-05T07:00:00Z"), likes: jpn.likes, comments: jpn.comments, intent: intentShare(jpn.visibleComments, jpn.caption), baseline: medianBaseline(toBase(JPN), { candidateCode: jpn.code, nowMs: at("2026-10-05T07:00:00Z") }), followers: 57_600 });
  assert.deepEqual([j.verdict, j.a, j.b, j.rule], ["strong", true, true, "main"]);
  assert.equal(j.ruleVersion, REELS_RULE_VERSION);
});

test("Второй залёт jpnbrands — флисовые брюки Dd8NdvPi0Yp: 5,7× лайков (мало), 35× комментариев при 100% «цена» → «залетает»", () => {
  const v = judge(1482, 176, { count: 15, total: 15 }, toBase(JPN), "2026-09-30T12:00:00Z", "Dd8NdvPi0Yp");
  assert.deepEqual([v.verdict, v.a, v.b], ["viral", false, true]);
  assert.ok((v.likesRatio ?? 0) < 10);
});

test("Около 30 обычных постов тех же авторов — «обычно»: ложных залётов нет", () => {
  const authors: Array<[string, CalPost[]]> = [["anna", ANNA], ["aida", AIDA], ["jpn", JPN]];
  let judged = 0;
  for (const [name, list] of authors) {
    for (const post of list) {
      if (post.code === "Dd8NdvPi0Yp") continue;
      // Судим пост так, как его судил бы крон: на 3-й день после публикации, по базе из остальных постов автора.
      const published = at(`${post.date}T12:00:00Z`);
      const nowMs = published + 3 * DAYMS;
      const v = verdictV1({ publishedAtMs: published, nowMs, likes: post.likes, comments: post.comments, intent: BACKGROUND_INTENT[name], baseline: medianBaseline(toBase(list), { candidateCode: post.code, nowMs: CAPTURE }), followers: null });
      assert.equal(v.verdict, "normal", `${name} ${post.code}`);
      judged += 1;
    }
  }
  assert.ok(judged >= 29, `обычных постов ${judged}`);
});

test("Моложе 48 ч — «рано судить», старше 21 дня — вне окна; лайки скрыты — судим только по Б", () => {
  const base = toBase(ANNA);
  const fresh = verdictV1({ publishedAtMs: CAPTURE - 9 * 3600 * 1000, nowMs: CAPTURE, likes: 283, comments: 15, intent: null, baseline: medianBaseline(base, { nowMs: CAPTURE }), followers: null });
  assert.equal(fresh.verdict, "too_fresh");
  assert.equal(verdictV1({ publishedAtMs: CAPTURE - 22 * DAYMS, nowMs: CAPTURE, likes: 99_999, comments: 999, intent: { count: 9, total: 9 }, baseline: null, followers: null }).verdict, "too_old");
  const hidden = verdictV1({ publishedAtMs: CAPTURE - 5 * DAYMS, nowMs: CAPTURE, likes: null, comments: 76, intent: { count: 6, total: 10 }, baseline: medianBaseline(base, { nowMs: CAPTURE }), followers: null });
  assert.deepEqual([hidden.verdict, hidden.a, hidden.b], ["viral", false, true]);
});

test("Мало постов у автора (< 6 с видимыми лайками) — запасное правило с пометкой «предварительно»", () => {
  const few: VerdictInput["baseline"] = { likesMedian: 50, commentsMedian: 2, likesPosts: 3 };
  const base = { publishedAtMs: CAPTURE - 5 * DAYMS, nowMs: CAPTURE, intent: { count: 1, total: 10 } };
  const byFollowers = verdictV1({ ...base, likes: 700, comments: 5, baseline: few, followers: 3000 });
  assert.deepEqual([byFollowers.verdict, byFollowers.preliminary, byFollowers.rule], ["viral", true, "fallback"], "700 ≥ 20% от 3 000");
  assert.equal(verdictV1({ ...base, likes: 5000, comments: 5, baseline: few, followers: null }).verdict, "viral", "≥ 5 000 без подписчиков");
  assert.equal(verdictV1({ ...base, likes: 4999, comments: 5, baseline: few, followers: null }).verdict, "normal");
  const b = verdictV1({ ...base, likes: 100, comments: 30, intent: { count: 5, total: 10 }, baseline: null, followers: 100_000 });
  assert.deepEqual([b.verdict, b.preliminary], ["viral", true], "Б без множителя: ≥ 30 и ≥ 50%");
  assert.equal(verdictV1({ ...base, likes: 100, comments: 29, intent: { count: 5, total: 10 }, baseline: null, followers: 100_000 }).verdict, "normal");
  assert.equal(verdictV1({ ...base, likes: 100, comments: 5, baseline: few, followers: null }).preliminary, false, "«обычно» не помечаем");
});

test("Пороги main-правила на границе: 10× и 1 000 лайков, 5× и 30 комментариев и 50% намерения", () => {
  const baseline = { likesMedian: 100, commentsMedian: 6, likesPosts: 8 };
  const base = { publishedAtMs: CAPTURE - 5 * DAYMS, nowMs: CAPTURE, baseline, followers: null };
  assert.equal(verdictV1({ ...base, likes: 1000, comments: 1, intent: null }).a, true);
  assert.equal(verdictV1({ ...base, likes: 999, comments: 1, intent: null }).a, false, "меньше 1 000");
  assert.equal(verdictV1({ ...base, baseline: { ...baseline, likesMedian: 101 }, likes: 1000, comments: 1, intent: null }).a, false, "меньше 10×");
  assert.equal(verdictV1({ ...base, likes: 10, comments: 30, intent: { count: 1, total: 2 } }).b, true);
  assert.equal(verdictV1({ ...base, likes: 10, comments: 30, intent: { count: 4, total: 9 } }).b, false, "меньше 50%");
  assert.equal(verdictV1({ ...base, baseline: { ...baseline, commentsMedian: 7 }, likes: 10, comments: 34, intent: { count: 1, total: 1 } }).b, false, "меньше 5×");
  assert.equal(verdictV1({ ...base, baseline: { ...baseline, commentsMedian: 1 }, likes: 10, comments: 29, intent: { count: 1, total: 1 } }).b, false, "меньше 30");
});

test("Замеры: первый в окне 2–21 день, затем на 3-й и на 7-й день, не больше трёх", () => {
  const pub = CAPTURE - 10 * DAYMS;
  assert.equal(measureDue({ publishedAtMs: CAPTURE - DAYMS, checks: 0, lastCheckedAtMs: null }, CAPTURE), false, "моложе 48 ч");
  assert.equal(measureDue({ publishedAtMs: CAPTURE - 22 * DAYMS, checks: 0, lastCheckedAtMs: null }, CAPTURE), false, "старше 21 дня");
  assert.equal(measureDue({ publishedAtMs: pub, checks: 0, lastCheckedAtMs: null }, CAPTURE), true);
  const p2 = CAPTURE - 2.5 * DAYMS;
  assert.equal(measureDue({ publishedAtMs: p2, checks: 1, lastCheckedAtMs: CAPTURE }, CAPTURE), false, "только что мерили");
  assert.equal(measureDue({ publishedAtMs: p2, checks: 1, lastCheckedAtMs: p2 + 2.1 * DAYMS }, p2 + 3 * DAYMS), true, "3-й день");
  assert.equal(measureDue({ publishedAtMs: p2, checks: 2, lastCheckedAtMs: p2 + 3 * DAYMS }, p2 + 5 * DAYMS), false, "между 3-м и 7-м");
  assert.equal(measureDue({ publishedAtMs: p2, checks: 2, lastCheckedAtMs: p2 + 3 * DAYMS }, p2 + 7 * DAYMS), true, "7-й день");
  assert.equal(measureDue({ publishedAtMs: p2, checks: 3, lastCheckedAtMs: p2 + 7 * DAYMS }, p2 + 15 * DAYMS), false, "три замера");
  assert.equal(measureDue({ publishedAtMs: p2, checks: 3, lastCheckedAtMs: p2 + 3.5 * DAYMS }, p2 + 8 * DAYMS), false, "три замера — и на 7-й день больше не мерим");
  assert.equal(measureDue({ publishedAtMs: pub, checks: 1, lastCheckedAtMs: pub + 10 * DAYMS }, pub + 12 * DAYMS), false, "первый замер поздно — повторов нет");
  assert.equal(withinDiscoveryWindow("Dd4Is8To7B0", at("2026-10-06T00:00:00Z")), true);
  assert.equal(withinDiscoveryWindow("DTfauF8CL-J", at("2026-10-06T00:00:00Z")), false, "январский рилс в теме не берём");
});

// --- настройки и стартовые источники ---

test("Настройки: 150 запросов за прогон; в неделю — сколько даёт строка соцсетей ($3 ≈ 2 000 запросов), явный ASSORTMENT_SOCIAL_WEEKLY_REQUESTS — ограничение сверху; выключатель off", () => {
  assert.deepEqual(socialConfig({}), { enabled: true, maxRequestsPerRun: 150, weeklyRequests: 2000, maxBaselineAuthorsPerRun: 4 });
  assert.equal(socialConfig({ ASSORTMENT_SOCIAL: " OFF " }).enabled, false);
  assert.equal(socialConfig({ ASSORTMENT_SOCIAL_MAX_REQUESTS_PER_RUN: "40", ASSORTMENT_SOCIAL_WEEKLY_REQUESTS: "300" }).maxRequestsPerRun, 40);
  assert.equal(socialConfig({ ASSORTMENT_SOCIAL_WEEKLY_REQUESTS: "300" }).weeklyRequests, 300, "явный потолок запросов строже строки — он");
  assert.equal(socialConfig({ ASSORTMENT_SOCIAL_WEEKLY_REQUESTS: "5000" }).weeklyRequests, 2000, "явный потолок шире строки — строка");
  assert.equal(socialConfig({ ASSORTMENT_SOCIAL_WEEKLY_USD: "6" }).weeklyRequests, 4000, "владелец поднял строку — запросов больше");
  assert.equal(socialConfig({ ASSORTMENT_SOCIAL_WEEKLY_REQUESTS: "abc" }).weeklyRequests, 2000);
});

test("Стартовые источники: ≈25 аккаунтов (официальный @zara — «без номеров»), темы женских курток и сумок по обоим брендам", () => {
  assert.ok(SEED_ACCOUNTS.length >= 20 && SEED_ACCOUNTS.length <= 30);
  assert.equal(new Set(SEED_ACCOUNTS.map((a) => a.handle)).size, SEED_ACCOUNTS.length);
  assert.match(SEED_ACCOUNTS.find((a) => a.handle === "zara")?.note ?? "", /без номеров/);
  for (const a of SEED_ACCOUNTS) assert.match(a.handle, /^[a-z0-9._]+$/);
  const zara = SEED_TOPICS.filter((t) => t.brand === "zara");
  const uniqlo = SEED_TOPICS.filter((t) => t.brand === "uniqlo");
  assert.ok(zara.length >= 12 && zara.length <= 15 && uniqlo.length >= 12 && uniqlo.length <= 15, `${zara.length}/${uniqlo.length}`);
  for (const slug of ["zara-viral-jacket", "zara-high-collar-jacket", "zara-bag", "uniqlo-jacket", "uniqlo-down-jacket", "uniqlo-round-mini-shoulder-bag"]) assert.ok(SEED_TOPICS.some((t) => t.slug === slug), slug);
  for (const t of SEED_TOPICS) assert.ok(detectDirection({ topic: t.slug }), `${t.slug}: тема про куртки или сумки`);
  for (const t of SEED_TOPICS) assert.equal(looksMenswear(t.slug.replace(/-/g, " ")), false, t.slug);
});

// --- по ревью: вёрстка, деньги, раздел, пол, адрес модели ---

test("Подпись кончается на шапке первого комментария: без «Load more comments» и без аватарок ник и текст комментатора в отрывок не попадают", () => {
  const anna = fixture("reel-desktop-likes-visible.md");
  // Мало комментариев — «Load more comments» нет; аватарок нет (вёрстка без картинок).
  const bare = anna.replace(/\[!\[commenter\d+'s profile picture\]\([^)]*\)\]\(\/commenter\d+\/\)\n\n/g, "").replace("Load more comments\n", "");
  assert.ok(!bare.includes("Load more comments") && !bare.includes("commenter1's profile picture"), "варианты вёрстки собраны");
  for (const md of [bare, anna.replace("Load more comments\n", "")]) {
    const r = parseReelPage(md)!;
    assert.match(r.caption, /Reference 5854\/722\/710/);
    assert.doesNotMatch(r.caption, /commenter\d|This jacket looks perfect|\b5h\b/, "чужой текст — не подпись");
    assert.doesNotMatch(sanitizeCaption(r.caption) ?? "", /commenter\d/);
    assert.equal(r.visibleComments.length, 15, "комментарии разобраны и без «Load more comments»");
    assert.deepEqual(intentShare(r.visibleComments, r.caption), { count: 9, total: 15, share: 0.6 });
  }
});

test("Блок счётчиков не распознан (вёрстка изменилась) — countsFound=false: лайки и комментарии неизвестны, а не «скрыты»", () => {
  const anna = fixture("reel-desktop-likes-visible.md");
  assert.equal(parseReelPage(anna)!.countsFound, true);
  const changed = anna.replace(/\nLike\n\n3\.7K\n/, "\nLike\n\n3,700 likes\n");
  assert.notEqual(changed, anna, "вариант собран");
  const r = parseReelPage(changed)!;
  assert.deepEqual([r.countsFound, r.likes, r.likesHidden, r.comments], [false, null, false, null]);
  assert.equal(parseReelPage(fixture("reel-desktop-likes-hidden-collab.md"))!.countsFound, true, "скрытые лайки — блок есть, это не сбой");
  assert.equal(parseReelPage(fixture("reel-mobile-layout.md"))!.countsFound, true);
});

test("Просмотры темы — со строки счётчика после автора, а не из подписи с «views 2026»", () => {
  const md = fixture("topic-zara-viral-jacket.md");
  const from = "![Love it! Zara did it right👌 Link in my stories 🔗\nReference 5854/722/710";
  assert.ok(md.includes(from));
  const changed = md.replace(from, "![Love it! Zara did it right👌 City views 2026 🔗\nReference 5854/722/710");
  const card = parseTopicPage(changed)!.cards.find((c) => c.code === "Dd4Is8To7B0")!;
  assert.equal(card.views, 315_000);
  assert.match(card.caption, /City views 2026/, "подпись та же");
});

test("Цены: сторона валюты — номер перед «$89.90» не теряется и не портится; «4500р», «KZT 4500», «12 тыс. руб» и прочие суммы вырезаны", () => {
  const zara = "Zara jacket 5854/722/710 $89.90";
  assert.deepEqual(extractRefs(zara, "zara").map((r) => r.key), ["zara:5854722"]);
  assert.equal(sanitizeCaption(zara), "Zara jacket 5854/722/710 …");
  const uniqlo = "Uniqlo арт 487882 ₸24990";
  assert.deepEqual(extractRefs(uniqlo, "uniqlo").map((r) => r.key), ["uniqlo:487882"]);
  assert.equal(sanitizeCaption(uniqlo), "Uniqlo арт 487882 …");
  assert.deepEqual(extractRefs("ZARA 5854/722/710 € 59,95").map((r) => r.key), ["zara:5854722"]);
  assert.deepEqual(extractRefs("арт 487882 тг").map((r) => r.key), [], "сумма в тенге после шести цифр — не номер");
  const amounts = ["4500р", "4 500 р", "4 500 р.", "KZT 4500", "USD 70", "RUB 4990", "45 GBP", "CHF 89", "89 CHF", "12 тыс. руб", "4,5к руб", "4990 rub", "1 500 000 сум",
    "4990 рублей", "4990руб.", "2 990,00 ₽", "7 990 ₸", "59,90 EUR", "99.90 USD", "4.990 руб", "4500 тнг", "4500тенге"];
  for (const amount of amounts) {
    const out = sanitizeCaption(`Куртка ${amount}`) ?? "";
    assert.equal(containsMoney(out), false, `${amount} → «${out}»`);
    assert.doesNotMatch(out, /\d/, `${amount} → «${out}»: сумма не осталась`);
  }
  assert.equal(sanitizeCaption("Куртка 44 р-р, рост 170"), "Куртка 44 р-р, рост 170", "размер — не сумма");
});

test("Хэштеги про деньги не храним: «#цена4990руб», «#4990тг», «#usd70», «#prix» — вон; «#sale50», «#priceless», «#zarabag» — остаются", () => {
  const tags = ["цена4990руб", "4990тг", "usd70", "prix", "цена", "sale50", "priceless", "zarabag", "487882"];
  const kept = cleanHashtags(tags);
  assert.deepEqual(kept, ["sale50", "priceless", "zarabag", "487882"]);
  assert.equal(containsMoney(kept.join(" ")), false);
  const out = sanitizeCaption("Куртка Zara #цена4990руб #4990тг #sale50")!;
  assert.equal(out, "Куртка Zara #sale50");
  assert.equal(containsMoney(out), false);
});

test("Раздел по слитным хэштегам — по корню на конце тега: «#baggyjeans», «#zarabaggy», «#teabag», «#lifejacket» — не раздел; «#zarabag», «#bagsoftheday» — сумки", () => {
  for (const tag of ["baggyjeans", "zarabaggy", "teabag", "airbag", "lifejacket", "topcoat", "bagel"]) assert.equal(detectDirection({ caption: "Zara new in", hashtags: [tag] }), null, tag);
  assert.equal(detectDirection({ caption: "Zara new in", hashtags: ["zarabag"] }), "bags");
  assert.equal(detectDirection({ caption: "Zara new in", hashtags: ["bagsoftheday"] }), "bags");
  assert.equal(detectDirection({ caption: "Zara new in", hashtags: ["zarajacket"] }), "jackets");
  assert.equal(detectDirection({ caption: "Zara new in", hashtags: ["zarajacketwomen"] }), "jackets");
  assert.equal(detectDirection({ caption: "jeans w/ #baggyjeans", hashtags: ["baggyjeans", "zara"] }), null);
  assert.equal(detectDirection({ caption: "Weekend at Mont Blanc in Zara" }), null, "Mont Blanc — не «mont»");
  assert.equal(detectDirection({ caption: "Zara mont aldım" }), "jackets", "тур. «mont» — куртка");
  assert.equal(detectDirection({ caption: "Una veste di Zara bellissima" }), null, "ит. «veste» — платье");
  assert.equal(detectDirection({ caption: "Ela veste Zara todos os dias" }), null, "порт. «veste» — глагол");
  assert.equal(detectDirection({ caption: "Ma nouvelle veste Zara" }), "jackets", "фр. «une / ma veste» — куртка");
});

test("Только женское: соседние темы с girls / guys / детской — не берём; «for him», «мужу», «мужчине», «парню» — мужское", () => {
  for (const slug of ["zara-girls-jacket", "zara-girl-bag", "uniqlo-jacket-for-guys", "zara-jacket-for-him", "zara-детская-куртка", "zara-куртка-для-мальчика", "uniqlo-kid-jacket", "zara-teen-bag"]) {
    assert.equal(acceptNeighborTopic(slug), null, slug);
  }
  assert.equal(acceptNeighborTopic("zara-women-jacket"), "zara");
  for (const text of ["Perfect gift for him", "Куртка мужчине на зиму", "Купила мужу", "подарок для мужа", "куртка парню", "для парня", "for my boyfriend"]) assert.equal(looksMenswear(text), true, text);
  for (const text of ["Women's jacket", "for her", "подарок маме", "for women"]) assert.equal(looksMenswear(text), false, text);
});

test("Б не измерено (тел комментариев нет, а их ≥ 30): не «нет» — без А вердикта нет, с А — «залетает»", () => {
  const baseline = { likesMedian: 100, commentsMedian: 5, likesPosts: 8 };
  const base = { publishedAtMs: CAPTURE - 5 * DAYMS, nowMs: CAPTURE, baseline, followers: null };
  const noA = verdictV1({ ...base, likes: 300, comments: 176, intent: null });
  assert.deepEqual([noA.verdict, noA.b, noA.bUnknown], ["normal", false, true], "правило говорит «обычно», а замер — «не измерено»");
  const withA = verdictV1({ ...base, likes: 5000, comments: 176, intent: null });
  assert.deepEqual([withA.verdict, withA.a, withA.bUnknown], ["viral", true, true]);
  assert.equal(verdictV1({ ...base, likes: 300, comments: 176, intent: { count: 0, total: 0 } }).bUnknown, false, "видели комментарии, покупательских нет — это «нет»");
  assert.equal(verdictV1({ ...base, likes: 300, comments: 12, intent: null }).bUnknown, false, "комментариев мало — Б «нет» и без тел");
});

test("Номер модели из адреса карточки бренда — как у номеров из подписей; адрес находки нормализован (без www, без витрины)", () => {
  assert.equal(socialRefKeyFromUrl(zaraCardUrl("5854722")), "zara:5854722");
  assert.equal(socialRefKeyFromUrl(normalizeProductUrl(zaraCardUrl("5854722"))), "zara:5854722");
  assert.equal(socialRefKeyFromUrl("https://www.zara.com/us/en/high-neck-pocket-jacket-p05854722.html?v1=123"), "zara:5854722");
  assert.equal(socialRefKeyFromUrl(uniqloCardUrls("487882")[0]), "uniqlo:487882");
  assert.equal(socialRefKeyFromUrl(normalizeProductUrl(uniqloCardUrls("487882")[0])), "uniqlo:487882");
  assert.equal(socialRefKeyFromUrl("https://www.polene-paris.com/products/numero-un"), null);
  assert.equal(socialRefKeyFromUrl("not a url"), null);
});
