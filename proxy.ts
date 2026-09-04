import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";
import { canAccess, roleHome } from "@/lib/auth/roles";

// Защищаем всё, кроме /login, /privacy, /api/auth/*, статики и публичных шар-доков (/share/*).
export const config = {
  matcher: ["/((?!_next/|favicon.ico|login|privacy|api/auth|share).*)"],
};

// /api/*-эндпоинты, доступные БЕЗ сессии и БЕЗ cron-секрета (явный allowlist).
// Это тонкие прокси внешнего медиа — их публичный URL отдаётся внешним рендерам
// (FAL/Seedance), которые фетчат его сервер-сайд без нашей куки.
// ВНИМАНИЕ: всё ОСТАЛЬНОЕ под /api/* требует сессию ИЛИ Bearer CRON_SECRET (fail-closed).
//
// img-proxy / media-proxy / yandex-img / drive-img НЕ открыты нараспашку: гейт их пропускает,
// но САМ РОУТ требует HMAC-подпись (signProxyUrl) ИЛИ сессию ИЛИ cron (lib/auth/proxyAuth.ts),
// иначе 401 — это закрывает open-relay/SSRF. img-proxy вдобавок пускает только WB-баскеты.
// Подпись им выдаёт сервер при отдаче URL внешнему рендеру (см. disk-source). Прод-инвариант:
// задан SIGN_SECRET или AUTH_SECRET, иначе подпись на небезопасном дефолте.
const PUBLIC_API: { prefix: string; methods?: string[] }[] = [
  { prefix: "/api/lab/img-proxy" }, // CORS-прокси картинок (само-гард: подпись/сессия + host-allowlist WB)
  { prefix: "/api/lab/media-proxy" }, // CORS-прокси видео/аудио (само-гард: подпись/сессия)
  { prefix: "/api/lab/yandex-img" }, // «стабильный публичный URL» → FAL/Seedance (само-гард: подпись/сессия)
  { prefix: "/api/lab/drive-img" }, // фото моделей с Google Drive → Seedance i2v (само-гард: подпись/сессия)
  { prefix: "/api/lab/model-avatar" }, // аватар модели (<img> + внешний рендер)
  { prefix: "/api/lab/model-photos" }, // список фото модели (отдаёт yandex-img URL)
  { prefix: "/api/lab/product-image" }, // резолвер WB-картинки товара
  { prefix: "/api/opiu/telegram", methods: ["POST"] }, // Telegram webhook: сам роут проверяет secret-token
  { prefix: "/api/opiu/monitor", methods: ["GET", "POST"] }, // cron мониторинга: сам роут проверяет Bearer-секрет
  { prefix: "/api/sync/watchdog", methods: ["GET"] }, // внешний watchdog: сам роут проверяет узкий SYNC_WATCHDOG_SECRET
  // Сборщик «Полок» на Mac владельца: сам роут проверяет Bearer SHELF_CRON_SECRET
  // (или CRON_SECRET) — lib/shelf/collectorAuth.ts. Узко: два пути, по одному методу.
  { prefix: "/api/shelf/watchlist", methods: ["GET"] },
  { prefix: "/api/shelf/ingest", methods: ["POST"] },
  // Браузерный сборщик выплат на Mac владельца: сам роут проверяет Bearer
  // FINANCE_MONITOR_SECRET (или CRON_SECRET). Без этой строки запрос умирал бы
  // здесь 401-м, не дойдя до само-гарда — гейт знает только CRON_SECRET.
  // Узко: только POST приёма снимков; GET читается под сессией и сюда не попадает.
  { prefix: "/api/opiu/browser-payout-snapshots", methods: ["POST"] },
];

function isPublicApi(pathname: string, method: string): boolean {
  return PUBLIC_API.some(
    (p) => pathname.startsWith(p.prefix) && (!p.methods || p.methods.includes(method)),
  );
}

// Внешний WB-селлер — deny-by-default. Разрешаем только чтение аналитики
// и отдельный endpoint подключения собственного токена. Проверка конкретного
// cabinet_id всё равно выполняется рядом с данными в route handler.
const SELLER_READ_API_EXACT = [
  "/api/abc",
  "/api/adverts/list",
  "/api/cabinets",
  // Настройки налога и доп. комиссии кабинета: читать нужно всем, кто смотрит
  // юнит-экономику, менять — только director/finance (проверка в самом роуте,
  // а сюда попадает только GET).
  "/api/cabinet-settings/unit",
  // Справочник «артикул → категория»: фильтр «Все / Куртки / Сумки» на РНП,
  // воронке, полках и ещё нескольких экранах селлера. Роут сам режет выдачу по
  // его кабинетам (session.role === "seller" → session.cabinet_ids), а гейт до
  // сегодня отвечал 403 — и фильтр молча исчезал, потому что 403 это не
  // сетевая ошибка: пустой ответ выглядел как «категорий нет».
  "/api/costs/categories",
  "/api/ctrtest/adv-analysis",
  "/api/ctrtest/list",
  "/api/design/day-metrics",
  "/api/operational-health",
  "/api/pim",
  "/api/reviews",
  "/api/sales-plan",
  "/api/signals",
  "/api/sklejki",
  "/api/supplies",
  "/api/trends",
  "/api/unit/price-solver",
  "/api/unit/table",
  // Уровень сотрудника в кабинете: интерфейсу нужно знать, показывать ли
  // кнопки. Решение всё равно принимает сервер при записи.
  "/api/wb/cabinet-rights",
  // Разбивка дневного CTR по кампаниям и справочник «артикул → название» —
  // сопровождение тех же экранов, которые селлеру уже открыты.
  "/api/wb/ctr-breakdown",
  "/api/wb/losses",
  "/api/wb/sku-directory",
  "/api/wb/sync-health",
] as const;

const SELLER_READ_API_PREFIXES = [
  "/api/market/",
  "/api/pim/",
  "/api/planning/",
  "/api/rnp/",
  "/api/seo/",
] as const;

// Оператор склада — сотрудник фулфилмента, то есть ДРУГОЙ компании, работающий
// в нашей системе. Страницы ему закрыты ролью, а /api/* до этого пропускал любую
// живую сессию: из консоли браузера открывались /api/opiu, /api/costs и
// /api/purchase-orders — прибыль, закупочные цены по всем юрлицам и условия
// фабрик. Решение показывать ему себестоимость касалось одной колонки на его
// экране, а не всего финансового контура компании.
function isWarehouseApiAllowed(pathname: string, method: string): boolean {
  if (pathname.startsWith("/api/warehouse/")) return true;
  // Отметка факта приёмки живёт в старом разделе поставок, но делает её тот же
  // оператор из окна приёмки склада.
  if (/^\/api\/supplies\/receipts\//.test(pathname)) return method === "PATCH" || method === "GET";
  return false;
}

function isSellerApiAllowed(pathname: string, method: string): boolean {
  // Модуль склада: внешний селлер ведёт в нём СВОЙ склад — приёмки, задания,
  // отгрузки, брак. Граница здесь не в списке путей, а в юрлице: каждый роут
  // проходит resolveEntity, а тот отдаёт селлеру только юрлица его организации.
  // Контур маркировки — исключение: он ходит в Честный Знак нашими токенами.
  if (pathname.startsWith("/api/warehouse/")) return !pathname.startsWith("/api/warehouse/kiz");
  if (pathname === "/api/cabinets/self-service") return method === "GET" || method === "POST";
  // «Полки» открыты селлеру целиком: он сам ведёт конкурентов своего кабинета.
  // Tenant-граница — hasCabinetAccess в роутах: чужой кабинет и агрегат all → 403.
  if (pathname === "/api/shelf/watch") return ["GET", "POST", "PATCH", "DELETE", "PUT"].includes(method);
  if (pathname === "/api/shelf/table") return method === "GET";
  // Вторая вкладка тех же «Полок» — мониторинг конкурентов по цене. Селлер
  // ведёт свой список артикулов сам: добавляет товар, привязывает конкурента,
  // убирает лишнего. Роут для этого и написан — requireApiSession пускает
  // seller, кабинет держит hasCabinetAccess, а cabinet_id стоит в каждом
  // запросе к базе, — но путь сюда не попал, и живой экран отвечал «Внешнему
  // селлеру доступна только WB-аналитика» под заголовком «WB не загрузились».
  if (pathname === "/api/wb/competitors") return ["GET", "POST", "DELETE"].includes(method);
  // Свой порядок артикулов, план продаж и операционные пометки (теги/журнал) —
  // рабочие инструменты владельца кабинета, а не владельческие настройки:
  // селлер ведёт ими СВОЙ кабинет. Границу держит hasCabinetAccess в роутах.
  if (pathname === "/api/sku-order") return method === "GET" || method === "PUT";
  // Журнал РК: только чтение — вид размещения приходит от WB, размечать
  // руками нечего.
  if (pathname === "/api/wb/rk-journal") return method === "GET";
  // Задачи менеджера в журнале РК и комментарии к дневному CTR — рабочие
  // пометки владельца кабинета по своему же кабинету. Без них человек видит
  // экран, но не может на нём работать: ровно это и выглядело как «нет
  // возможности ставить задачи». Право на запись проверяет сам роут —
  // hasCabinetAccess плюс уровень в кабинете (cabinetRights).
  if (pathname === "/api/wb/rk-notes") return method === "GET" || method === "POST";
  if (pathname === "/api/wb/ctr-notes") return method === "GET" || method === "POST";
  // Команда своей организации: админ кабинета заводит сотрудников сам.
  // Роут держит границу жёстко — своя организация, свои кабинеты, роль
  // новому сотруднику всегда seller.
  if (pathname === "/api/wb/team") return method === "GET" || method === "POST";
  if (/^\/api\/rnp\/[^/]+\/(plan|operations)$/.test(pathname)) return method === "GET" || method === "POST";
  if (method !== "GET") return false;
  return SELLER_READ_API_EXACT.includes(pathname as (typeof SELLER_READ_API_EXACT)[number])
    || SELLER_READ_API_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

// Менеджер Ozon — сотрудник, который ведёт кабинеты Ozon и товародвижение по
// ним. Ему открыты ровно два модуля, и список составлен по тому, что эти
// модули действительно запрашивают: deny-by-default, как у селлера и оператора
// склада. Границу конкретного кабинета всё равно держит hasCabinetAccess рядом
// с данными — здесь отсекается сам контур.
const OZON_MANAGER_READ_API_EXACT = [
  "/api/cabinets",
  "/api/cabinet-groups",
  // Ставка налога и комиссия посредника нужны экрану юнит-экономики на чтение;
  // менять их может только director/finance — это проверяет сам роут.
  "/api/cabinet-settings/unit",
  "/api/operational-health",
] as const;

function isOzonManagerApiAllowed(pathname: string, method: string): boolean {
  // Модуль «Склад» целиком — тот же набор, что у оператора фулфилмента.
  if (isWarehouseApiAllowed(pathname, method)) return true;
  // Кокпит Ozon и его экраны: только чтение, записи в этом контуре нет.
  if (pathname.startsWith("/api/ozon/")) return method === "GET";
  // План продаж Ozon менеджер ведёт сам — иначе экран открывается, но не
  // сохраняет.
  if (pathname === "/api/sales-plan") return method === "GET" || method === "POST";
  if (method !== "GET") return false;
  return OZON_MANAGER_READ_API_EXACT.includes(pathname as (typeof OZON_MANAGER_READ_API_EXACT)[number]);
}

// Менеджер маркетплейсов ведёт кабинеты, а не финансы компании. Страницы
// «ОПиУ», «P&L» и «Репрайсер» ему закрыты ролью, но /api/* до этого пропускал
// любую живую сессию: из консоли браузера открывался /api/opiu — прибыль по
// всем юрлицам, — который вдобавок не проверяет роль у себя.
//
// Список узкий намеренно. Финансы (/api/finance), закупки и «Мой склад»
// сюда не входят: первые гейтятся ролью в самом роуте, вторые — рабочие
// вкладки поставок, которые менеджер открывает законно.
const MANAGER_DENIED_API = [
  "/api/opiu",
  "/api/repricer",
] as const;

function isManagerApiAllowed(pathname: string): boolean {
  return !MANAGER_DENIED_API.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const session = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);

  // ── API: явная авторизация на уровне приложения ──
  // Не полагаемся на Vercel Deployment Protection как на единственный контроль:
  // утечка preview-URL или мисконфиг протекшна не должны открывать данные/мутации.
  if (pathname.startsWith("/api/")) {
    // 1) явные публичные эндпоинты (медиа-прокси для внешних рендеров, вебхук Telegram)
    if (isPublicApi(pathname, req.method)) return NextResponse.next();
    // 2) залогиненный пользователь — кука fp_session уходит автоматически
    //    на same-origin fetch() и подзапросы <img>/<video src="/api/...">
    if (session) {
      if (session.role === "seller" && !isSellerApiAllowed(pathname, req.method)) {
        return NextResponse.json({ error: "Внешнему селлеру доступна только WB-аналитика" }, { status: 403 });
      }
      if (session.role === "warehouse" && !isWarehouseApiAllowed(pathname, req.method)) {
        return NextResponse.json({ error: "Оператору склада доступен только модуль склада" }, { status: 403 });
      }
      if (session.role === "ozon_manager" && !isOzonManagerApiAllowed(pathname, req.method)) {
        return NextResponse.json({ error: "Менеджеру Ozon доступны модули Ozon и Склад" }, { status: 403 });
      }
      if (session.role === "manager" && !isManagerApiAllowed(pathname)) {
        return NextResponse.json({ error: "Финансовый контур компании доступен директору и финотделу" }, { status: 403 });
      }
      return NextResponse.next();
    }
    // 3) машинные/cron-вызовы и внутренний фан-аут (route→route): Bearer CRON_SECRET
    const secret = process.env.CRON_SECRET;
    if (secret && req.headers.get("authorization") === `Bearer ${secret}`) {
      return NextResponse.next();
    }
    // 4) локальная разработка (не production) — не блокируем, как и прежний checkCronAuth dev-skip
    if (process.env.NODE_ENV !== "production") return NextResponse.next();
    // иначе — fail-closed
    return NextResponse.json({ error: "Не авторизовано" }, { status: 401 });
  }

  // ── Страницы: гейтим по сессии и роли ──
  if (!session) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("from", pathname);
    return NextResponse.redirect(url);
  }

  if (!canAccess(session.role, pathname)) {
    const url = req.nextUrl.clone();
    url.pathname = roleHome(session);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}
