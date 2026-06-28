import { NextResponse } from "next/server";

export const dynamic = "force-static";

const html = String.raw`<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
  <title>Reels Brain Demo</title>
  <style>
    :root{
      --bg:#09111f;
      --bg-soft:#101a2d;
      --panel:#f7f8fb;
      --card:#ffffff;
      --line:#dbe1ea;
      --ink:#101828;
      --muted:#5f6c80;
      --cyan:#0ea5e9;
      --cyan-soft:#dff6ff;
      --emerald:#059669;
      --emerald-soft:#def7ec;
      --amber:#b45309;
      --amber-soft:#fff1d6;
      --violet:#5b4bff;
      --violet-soft:#ece9ff;
      --rose:#e11d48;
      --rose-soft:#ffe4ea;
      --shadow:0 28px 80px rgba(6, 17, 38, .12);
    }
    *{box-sizing:border-box}
    body{
      margin:0;
      font-family:ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background:
        radial-gradient(circle at top right, rgba(14,165,233,.18), transparent 30%),
        radial-gradient(circle at left 20%, rgba(91,75,255,.18), transparent 28%),
        linear-gradient(180deg, #06101d 0%, #0b1324 28%, #eef2f8 28%, #eef2f8 100%);
      color:var(--ink);
    }
    a{color:inherit}
    .wrap{max-width:1240px;margin:0 auto;padding:32px 20px 56px}
    .hero{
      position:relative;
      overflow:hidden;
      border:1px solid rgba(255,255,255,.1);
      border-radius:32px;
      background:linear-gradient(135deg, rgba(10,16,32,.96), rgba(14,24,46,.9));
      color:#fff;
      padding:30px;
      box-shadow:var(--shadow);
    }
    .hero:before,.hero:after{
      content:"";
      position:absolute;
      border-radius:999px;
      filter:blur(22px);
      opacity:.55;
    }
    .hero:before{width:240px;height:240px;right:-60px;top:-90px;background:rgba(14,165,233,.32)}
    .hero:after{width:180px;height:180px;left:26%;bottom:-100px;background:rgba(250,204,21,.25)}
    .eyebrow{
      display:inline-flex;
      align-items:center;
      gap:8px;
      padding:8px 12px;
      border-radius:999px;
      background:rgba(255,255,255,.08);
      border:1px solid rgba(255,255,255,.12);
      font-size:12px;
      font-weight:700;
      text-transform:uppercase;
      letter-spacing:.14em;
      color:#c4ecff;
    }
    .grid-hero{
      position:relative;
      display:grid;
      gap:20px;
      grid-template-columns:minmax(0, 1.35fr) minmax(280px, .65fr);
      align-items:end;
      z-index:1;
    }
    h1{
      margin:14px 0 10px;
      font-size:clamp(34px, 4.6vw, 58px);
      line-height:.96;
      letter-spacing:-.04em;
      max-width:840px;
    }
    .lead{
      margin:0;
      max-width:760px;
      color:#d7deeb;
      font-size:15px;
      line-height:1.65;
    }
    .hero-notice{
      margin-top:18px;
      display:inline-flex;
      gap:10px;
      align-items:flex-start;
      padding:12px 14px;
      border-radius:18px;
      background:rgba(14,165,233,.14);
      border:1px solid rgba(125,211,252,.2);
      color:#d8f6ff;
      font-size:13px;
      line-height:1.55;
      max-width:740px;
    }
    .hero-actions{
      margin-top:18px;
      display:flex;
      flex-wrap:wrap;
      gap:10px;
    }
    .btn{
      display:inline-flex;
      align-items:center;
      justify-content:center;
      min-height:44px;
      padding:0 16px;
      border-radius:14px;
      font-size:14px;
      font-weight:700;
      text-decoration:none;
      border:1px solid transparent;
    }
    .btn.primary{background:#fff;color:#08101f}
    .btn.ghost{background:rgba(255,255,255,.08);color:#fff;border-color:rgba(255,255,255,.12)}
    .metric-grid{
      display:grid;
      gap:10px;
      grid-template-columns:repeat(2, minmax(0, 1fr));
    }
    .metric{
      border-radius:22px;
      padding:18px 16px;
      background:rgba(255,255,255,.09);
      border:1px solid rgba(255,255,255,.12);
      backdrop-filter:blur(10px);
    }
    .metric .v{
      font-size:30px;
      font-weight:900;
      line-height:1;
      letter-spacing:-.04em;
    }
    .metric .k{
      margin-top:8px;
      font-size:11px;
      font-weight:700;
      text-transform:uppercase;
      letter-spacing:.12em;
      color:#a9b4c8;
    }
    .metric .s{
      margin-top:8px;
      font-size:12px;
      color:#d8e0ef;
      line-height:1.45;
    }
    .surface{
      margin-top:22px;
      display:grid;
      gap:18px;
    }
    .two-col{
      display:grid;
      gap:18px;
      grid-template-columns:minmax(0, .95fr) minmax(0, 1.05fr);
    }
    .three-col{
      display:grid;
      gap:18px;
      grid-template-columns:repeat(3, minmax(0, 1fr));
    }
    .card{
      background:var(--card);
      border:1px solid var(--line);
      border-radius:28px;
      padding:22px;
      box-shadow:0 10px 34px rgba(16,24,40,.05);
    }
    .card.soft{background:var(--panel)}
    .cap{
      font-size:11px;
      font-weight:800;
      text-transform:uppercase;
      letter-spacing:.18em;
      color:#7a879c;
    }
    .title{
      margin:8px 0 0;
      font-size:29px;
      line-height:1.04;
      letter-spacing:-.04em;
    }
    .muted{
      color:var(--muted);
      font-size:14px;
      line-height:1.6;
    }
    .stack{display:grid;gap:12px}
    .badge-row{display:flex;flex-wrap:wrap;gap:8px}
    .badge{
      display:inline-flex;
      align-items:center;
      gap:6px;
      padding:7px 10px;
      border-radius:999px;
      border:1px solid var(--line);
      background:#fff;
      color:#445166;
      font-size:12px;
      font-weight:700;
    }
    .badge.ok{border-color:#b6ebd4;background:var(--emerald-soft);color:var(--emerald)}
    .badge.warn{border-color:#f6d28d;background:var(--amber-soft);color:var(--amber)}
    .badge.demo{border-color:#bfdbfe;background:#eaf2ff;color:#1d4ed8}
    .provider-list,.module-list,.video-list,.memory-list,.roadmap-list,.run-list{
      display:grid;
      gap:10px;
    }
    .provider,.module,.video,.memory,.roadmap,.run{
      border:1px solid var(--line);
      border-radius:20px;
      background:#fff;
      padding:14px 15px;
    }
    .provider{
      display:flex;
      gap:14px;
      align-items:flex-start;
      justify-content:space-between;
    }
    .provider .name,.module .name,.memory .name,.roadmap .name,.run .name{
      font-size:15px;
      font-weight:800;
      color:#111b2a;
    }
    .sub{
      margin-top:4px;
      color:var(--muted);
      font-size:13px;
      line-height:1.5;
    }
    .mono{
      font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size:12px;
    }
    .pill{
      display:inline-flex;
      align-items:center;
      padding:6px 10px;
      border-radius:999px;
      font-size:11px;
      font-weight:800;
      text-transform:uppercase;
      letter-spacing:.09em;
      white-space:nowrap;
    }
    .pill.ok{background:var(--emerald-soft);color:var(--emerald)}
    .pill.warn{background:var(--amber-soft);color:var(--amber)}
    .pill.violet{background:var(--violet-soft);color:var(--violet)}
    .pill.rose{background:var(--rose-soft);color:var(--rose)}
    .inline-stats{
      margin-top:10px;
      display:flex;
      flex-wrap:wrap;
      gap:8px;
    }
    .inline-stats span{
      padding:6px 9px;
      border-radius:999px;
      background:#f5f7fb;
      color:#4f5b70;
      font-size:12px;
      font-weight:700;
    }
    .pipeline{
      display:grid;
      gap:12px;
      grid-template-columns:repeat(4, minmax(0, 1fr));
    }
    .step{
      min-height:132px;
      border-radius:24px;
      padding:18px 16px;
      background:#fff;
      border:1px solid var(--line);
      position:relative;
      overflow:hidden;
    }
    .step:before{
      content:"";
      position:absolute;
      inset:auto -28px -28px auto;
      width:92px;
      height:92px;
      border-radius:999px;
      background:linear-gradient(135deg, rgba(91,75,255,.12), rgba(14,165,233,.12));
    }
    .step .n{
      width:32px;
      height:32px;
      border-radius:11px;
      display:flex;
      align-items:center;
      justify-content:center;
      font-weight:900;
      color:#fff;
      background:linear-gradient(135deg, #5b4bff, #0ea5e9);
      box-shadow:0 10px 22px rgba(14,165,233,.18);
    }
    .step h3{
      margin:12px 0 6px;
      font-size:17px;
      line-height:1.18;
      letter-spacing:-.02em;
    }
    .step p{
      margin:0;
      color:var(--muted);
      font-size:13px;
      line-height:1.55;
    }
    .kpi-grid{
      margin-top:14px;
      display:grid;
      gap:10px;
      grid-template-columns:repeat(4, minmax(0, 1fr));
    }
    .kpi{
      background:#fff;
      border:1px solid var(--line);
      border-radius:20px;
      padding:16px 14px;
    }
    .kpi .label{
      font-size:11px;
      font-weight:800;
      text-transform:uppercase;
      letter-spacing:.14em;
      color:#7a879c;
    }
    .kpi .value{
      margin-top:8px;
      font-size:27px;
      font-weight:900;
      line-height:1;
      letter-spacing:-.04em;
    }
    .table{
      overflow:auto;
      border:1px solid var(--line);
      border-radius:22px;
      background:#fff;
    }
    table{
      width:100%;
      border-collapse:collapse;
      min-width:760px;
      font-size:14px;
    }
    th,td{
      padding:14px 16px;
      border-bottom:1px solid var(--line);
      text-align:left;
      vertical-align:top;
    }
    th{
      background:#f7f9fc;
      color:#6d7b8e;
      font-size:11px;
      font-weight:800;
      text-transform:uppercase;
      letter-spacing:.16em;
    }
    tbody tr:last-child td{border-bottom:none}
    .score{
      display:inline-flex;
      align-items:center;
      padding:6px 9px;
      border-radius:999px;
      font-size:12px;
      font-weight:800;
    }
    .score.good{background:var(--emerald-soft);color:var(--emerald)}
    .score.mid{background:var(--amber-soft);color:var(--amber)}
    .score.low{background:#eef2f7;color:#607086}
    .video .top,.memory .top,.roadmap .top,.run .top{
      display:flex;
      gap:12px;
      justify-content:space-between;
      align-items:flex-start;
    }
    .video .hook{
      margin-top:8px;
      font-size:15px;
      font-weight:800;
      color:#142033;
      line-height:1.35;
    }
    .video .meta{
      margin-top:10px;
      display:flex;
      flex-wrap:wrap;
      gap:8px;
      color:#4e5a6d;
      font-size:12px;
      font-weight:700;
    }
    .timeline{
      display:grid;
      gap:12px;
    }
    .roadmap{
      display:grid;
      gap:8px;
      background:linear-gradient(180deg, #fff, #f9fbff);
    }
    .roadmap .eta{
      font-size:13px;
      font-weight:800;
      color:#1d4ed8;
    }
    .foot{
      margin-top:18px;
      color:#778399;
      font-size:12px;
      line-height:1.55;
    }
    @media (max-width:1120px){
      .grid-hero,.two-col,.three-col,.pipeline,.kpi-grid{grid-template-columns:1fr}
      .metric-grid{grid-template-columns:repeat(2, minmax(0, 1fr))}
    }
    @media (max-width:720px){
      .wrap{padding:18px 14px 40px}
      .hero{padding:20px}
      .card{padding:18px}
      .metric-grid{grid-template-columns:1fr}
      h1{font-size:34px}
    }
  </style>
</head>
<body>
  <div class="wrap">
    <section class="hero">
      <div class="grid-hero">
        <div>
          <div class="eyebrow">Self-learning Reels Intelligence Brain</div>
          <h1>Публичная демо-витрина Reels Brain без логина и без live-записей</h1>
          <p class="lead">
            Это отдельный безопасный вход для просмотра всей архитектуры: от scraper-слоя и bake-off
            до pattern memory, генератора, критика и self-learning loop. Данные на странице демонстрационные,
            чтобы можно было показать концепт без отключения глобальной авторизации.
          </p>
          <div class="hero-notice">
            <strong>Demo mode:</strong> никаких мутаций, никаких POST в боевые маршруты, только публичный read-only обзор
            пайплайна, модулей, провайдеров, вех и целевой формы операторского пульта.
          </div>
          <div class="hero-actions">
            <a class="btn primary" href="/agent/reels-brain">Открыть live-консоль</a>
            <a class="btn ghost" href="/share/content-factory-vision.html">Открыть vision-страницу</a>
          </div>
        </div>
        <div class="metric-grid">
          <div class="metric">
            <div class="v">10k</div>
            <div class="k">Цель корпуса</div>
            <div class="s">Reels / TikTok / Shorts для нормальной насмотренности и первых pattern-срезов.</div>
          </div>
          <div class="metric">
            <div class="v">8</div>
            <div class="k">Ключевых модулей</div>
            <div class="s">От поискового intake до обновления мозговой памяти паттернов.</div>
          </div>
          <div class="metric">
            <div class="v">3</div>
            <div class="k">Главных вехи</div>
            <div class="s">Сбор корпуса, разбор/память и цикл generation + critic + feedback.</div>
          </div>
          <div class="metric">
            <div class="v">18-26d</div>
            <div class="k">Оценка</div>
            <div class="s">При последовательной сборке без глубокого переезда общей auth-инфры.</div>
          </div>
        </div>
      </div>
    </section>

    <div class="surface">
      <section class="card">
        <div class="cap">Pipeline</div>
        <h2 class="title">Все модули от scraper до самообучения</h2>
        <p class="muted">
          Цепочка собрана так, чтобы сначала решить intake и качество входных данных, потом построить memory,
          и только после этого замыкать loop на генерацию и улучшение.
        </p>
        <div class="pipeline" style="margin-top:18px">
          <div class="step"><div class="n">1</div><h3>Поиск вирусных роликов</h3><p>Scraper providers, ручной seed, seed-list, platform-specific поисковые запросы.</p></div>
          <div class="step"><div class="n">2</div><h3>Фильтр вирусности</h3><p>Views, рост, hook density, валидность URL, релевантность к нише и чистка мусора.</p></div>
          <div class="step"><div class="n">3</div><h3>Raw corpus / DB</h3><p>Видео, caption, meta, sound, followers, source provider, query lineage и score.</p></div>
          <div class="step"><div class="n">4</div><h3>Reels Intelligence Agent</h3><p>Разбор hook, structure, CTA, sound-layer, format, pace и retention mechanics.</p></div>
          <div class="step"><div class="n">5</div><h3>Pattern Memory</h3><p>Сжатые паттерны по hook-type, structure-type, retention-mechanism и strength score.</p></div>
          <div class="step"><div class="n">6</div><h3>Контент-генератор</h3><p>Использует brain как вход: идеи, сценарии, форматы, variation-пулы и подачи под нишу.</p></div>
          <div class="step"><div class="n">7</div><h3>Критик и улучшение</h3><p>Качество сценария, clarity, tension, first seconds, format-fit и rewrite path до публикации.</p></div>
          <div class="step"><div class="n">8</div><h3>Self-learning update</h3><p>Возврат в память: что реально залетает, что даёт досмотр, что надо усиливать или выкидывать.</p></div>
        </div>
      </section>

      <div class="two-col">
        <section class="card">
          <div class="cap">Source Map</div>
          <h2 class="title">Кто скрапит и чем закрываем платформы</h2>
          <p class="muted">Ниже не “один серебряный скрапер”, а стек с резервированием по платформам и качеству выдачи.</p>
          <div class="provider-list" style="margin-top:18px">
            <div class="provider">
              <div>
                <div class="name">Apify stack</div>
                <div class="sub">Быстрый старт для TikTok / Instagram / YouTube. Хорош для массовых прогонов, bake-off и ручной подмены акторов.</div>
                <div class="inline-stats"><span>TikTok</span><span>Instagram</span><span>YouTube</span></div>
              </div>
              <span class="pill ok">Configured</span>
            </div>
            <div class="provider">
              <div>
                <div class="name">YouTube Data API</div>
                <div class="sub">Чистый API-слой для Shorts и metadata enrichment: быстрее, стабильнее, но уже только для YouTube.</div>
                <div class="inline-stats"><span>API quota</span><span>search + stats</span></div>
              </div>
              <span class="pill ok">Configured</span>
            </div>
            <div class="provider">
              <div>
                <div class="name">Bright Data</div>
                <div class="sub">Провайдер под более глубокий social scraping, когда нужен запас по coverage и антибот-устойчивости.</div>
                <div class="inline-stats"><span>TikTok</span><span>Instagram</span><span>YouTube</span></div>
              </div>
              <span class="pill warn">Key added</span>
            </div>
            <div class="provider">
              <div>
                <div class="name">EnsembleData</div>
                <div class="sub">Дополнительный источник для social graph и comparison against Apify / Bright, чтобы не зависеть от одного поставщика.</div>
                <div class="inline-stats"><span>TikTok</span><span>Instagram</span><span>YouTube</span></div>
              </div>
              <span class="pill warn">Key added</span>
            </div>
            <div class="provider">
              <div>
                <div class="name">Virlo + manual seed</div>
                <div class="sub">Точечный viral intake, референсы вручную и curated URL-листы, когда нужен ручной контекст, а не только массовый поисковый сбор.</div>
                <div class="inline-stats"><span>seed lists</span><span>human-picked</span></div>
              </div>
              <span class="pill violet">Hybrid</span>
            </div>
          </div>
        </section>

        <section class="card soft">
          <div class="cap">Operator Console</div>
          <h2 class="title">Что уже видно в live-пульте</h2>
          <p class="muted">Это демо-карта экранов, которые оператор видит в защищённой консоли Reels Brain.</p>
          <div class="module-list" style="margin-top:18px">
            <div class="module">
              <div class="name">Provider health</div>
              <div class="sub">Env health, availability и выбор провайдеров перед запуском сравнений.</div>
            </div>
            <div class="module">
              <div class="name">Bake-off runner</div>
              <div class="sub">Сравнение качества выдачи по одинаковым queries: found, valid, relevant, avg score.</div>
            </div>
            <div class="module">
              <div class="name">Source-run + manual seed</div>
              <div class="sub">Отдельный intake через активный scraper source и ручной залив URL/JSON в corpus.</div>
            </div>
            <div class="module">
              <div class="name">Corpus monitor</div>
              <div class="sub">Просмотр того, что реально лежит в viral corpus: platform mix, raw/analyzed, score distribution.</div>
            </div>
            <div class="module">
              <div class="name">Analyze + patterns/build + loop</div>
              <div class="sub">Первый слой самообучения: enrich raw corpus, строим memory и тестируем stitched loop.</div>
            </div>
          </div>
          <div class="badge-row" style="margin-top:16px">
            <span class="badge ok">safe by default</span>
            <span class="badge warn">persist only on explicit action</span>
            <span class="badge demo">this page is public demo only</span>
          </div>
        </section>
      </div>

      <section class="card">
        <div class="cap">Bake-off Snapshot</div>
        <h2 class="title">Демо-результат сравнения провайдеров</h2>
        <p class="muted">Синтетический срез того, как должен читаться bake-off для ниши <span class="mono">toys</span>.</p>
        <div class="kpi-grid">
          <div class="kpi"><div class="label">Queries</div><div class="value">3</div></div>
          <div class="kpi"><div class="label">Providers</div><div class="value">6</div></div>
          <div class="kpi"><div class="label">Found</div><div class="value">486</div></div>
          <div class="kpi"><div class="label">Relevant</div><div class="value">174</div></div>
        </div>
        <div class="table" style="margin-top:16px">
          <table>
            <thead>
              <tr>
                <th>Provider</th>
                <th>Found</th>
                <th>Valid</th>
                <th>Relevant</th>
                <th>Avg score</th>
                <th>Signals</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><strong>Apify TikTok</strong><div class="sub">лучший старт по speed/coverage</div></td>
                <td>124</td>
                <td>92 · 74%</td>
                <td>49 · 40%</td>
                <td><span class="score good">41.8</span></td>
                <td>followers 78 · sound 65</td>
              </tr>
              <tr>
                <td><strong>YouTube API</strong><div class="sub">чистая metadata-структура</div></td>
                <td>86</td>
                <td>76 · 88%</td>
                <td>38 · 44%</td>
                <td><span class="score good">39.6</span></td>
                <td>followers 0 · sound 54</td>
              </tr>
              <tr>
                <td><strong>Bright TikTok</strong><div class="sub">reserve when coverage matters</div></td>
                <td>98</td>
                <td>64 · 65%</td>
                <td>32 · 33%</td>
                <td><span class="score mid">31.2</span></td>
                <td>followers 58 · sound 49</td>
              </tr>
              <tr>
                <td><strong>Ensemble Instagram</strong><div class="sub">good as contrast source</div></td>
                <td>70</td>
                <td>48 · 69%</td>
                <td>18 · 26%</td>
                <td><span class="score low">22.4</span></td>
                <td>followers 43 · sound 22</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <div class="two-col">
        <section class="card">
          <div class="cap">Corpus Monitor</div>
          <h2 class="title">Что лежит в viral corpus</h2>
          <p class="muted">Read model для оператора: видно платформу, score, raw/analyzed status и опорный hook.</p>
          <div class="badge-row" style="margin-top:16px">
            <span class="badge">platform mix: TikTok 52%</span>
            <span class="badge">YouTube 31%</span>
            <span class="badge">Instagram 17%</span>
            <span class="badge ok">analyzed: 3 820</span>
          </div>
          <div class="video-list" style="margin-top:16px">
            <div class="video">
              <div class="top">
                <div>
                  <span class="pill ok">tiktok</span>
                  <div class="hook">"Смотри, как этот бластер сбивает башню из стаканов за 2 секунды"</div>
                </div>
                <span class="score good">score 48</span>
              </div>
              <div class="meta"><span>views 1.8M</span><span>likes 126k</span><span>followers 402k</span><span>sound: trend remix</span></div>
            </div>
            <div class="video">
              <div class="top">
                <div>
                  <span class="pill violet">shorts</span>
                  <div class="hook">"3 ошибки, из-за которых детский водяной пистолет течёт уже в первый день"</div>
                </div>
                <span class="score mid">score 34</span>
              </div>
              <div class="meta"><span>views 612k</span><span>likes 28k</span><span>format: explainer</span><span>status: analyzed</span></div>
            </div>
            <div class="video">
              <div class="top">
                <div>
                  <span class="pill rose">instagram</span>
                  <div class="hook">"Ребёнок выбирает между 3 игрушками, а родители угадывают победителя"</div>
                </div>
                <span class="score low">score 21</span>
              </div>
              <div class="meta"><span>views 148k</span><span>likes 4.2k</span><span>status: raw</span><span>reason: weak opening</span></div>
            </div>
          </div>
        </section>

        <section class="card soft">
          <div class="cap">Pattern Memory</div>
          <h2 class="title">Как выглядит сжатая память паттернов</h2>
          <p class="muted">Не храним только “лучшие ролики”, а сжимаем повторяющиеся механики, чтобы дальше кормить ими генерацию.</p>
          <div class="memory-list" style="margin-top:16px">
            <div class="memory">
              <div class="top">
                <div>
                  <div class="name">problem -> demo payoff</div>
                  <div class="sub">retention: curiosity + visual proof</div>
                </div>
                <span class="score good">46</span>
              </div>
              <div class="inline-stats"><span>freq 132</span><span>hooks: "не делай так"</span><span>format: before/after</span></div>
            </div>
            <div class="memory">
              <div class="top">
                <div>
                  <div class="name">countdown -> surprise reveal</div>
                  <div class="sub">retention: anticipation</div>
                </div>
                <span class="score mid">33</span>
              </div>
              <div class="inline-stats"><span>freq 88</span><span>hooks: "угадай"</span><span>format: challenge</span></div>
            </div>
            <div class="memory">
              <div class="top">
                <div>
                  <div class="name">myth busting -> authority close</div>
                  <div class="sub">retention: contradiction</div>
                </div>
                <span class="score mid">29</span>
              </div>
              <div class="inline-stats"><span>freq 61</span><span>hooks: "все делают это неправильно"</span><span>format: explainer</span></div>
            </div>
          </div>
        </section>
      </div>

      <section class="card">
        <div class="cap">Execution Plan</div>
        <h2 class="title">3 вехи, пайплайн задач и сроки</h2>
        <p class="muted">Оценка дана для аккуратной сборки без перелома общей auth/infra части. Это тот сценарий, который можно делать отдельно, а потом бесшовно залить в продукт.</p>
        <div class="three-col" style="margin-top:18px">
          <div class="roadmap">
            <div class="top">
              <div>
                <div class="name">Веха 1. Intake и corpus</div>
                <div class="eta">7-10 дней</div>
              </div>
              <span class="pill ok">foundation</span>
            </div>
            <div class="roadmap-list">
              <div class="sub">Подключить TikTok / Instagram / YouTube providers и manual seed.</div>
              <div class="sub">Собрать bake-off и quality scorecard по провайдерам.</div>
              <div class="sub">Нормализовать raw rows и разогнать корпус до первых 2-3k, затем до 10k.</div>
            </div>
          </div>
          <div class="roadmap">
            <div class="top">
              <div>
                <div class="name">Веха 2. Analyze и Pattern Brain</div>
                <div class="eta">5-7 дней</div>
              </div>
              <span class="pill violet">brain</span>
            </div>
            <div class="roadmap-list">
              <div class="sub">Построить parsing hooks, structure, format, CTA, sound, pace.</div>
              <div class="sub">Собрать compressed pattern memory и strength ranking.</div>
              <div class="sub">Добавить corpus monitor и metrics для analyzed/raw split.</div>
            </div>
          </div>
          <div class="roadmap">
            <div class="top">
              <div>
                <div class="name">Веха 3. Generator, Critic, Loop</div>
                <div class="eta">6-9 дней</div>
              </div>
              <span class="pill rose">learning loop</span>
            </div>
            <div class="roadmap-list">
              <div class="sub">Подать memory в content generator и сценарные вариации.</div>
              <div class="sub">Замкнуть critic/rewrite и feedback storage.</div>
              <div class="sub">Запустить self-learning loop и decision surface для оператора.</div>
            </div>
          </div>
        </div>
      </section>

      <section class="card soft">
        <div class="cap">Loop Demo</div>
        <h2 class="title">Как должен читаться self-learning orchestrator</h2>
        <div class="run-list" style="margin-top:16px">
          <div class="run">
            <div class="top">
              <div>
                <div class="name">1. source-run</div>
                <div class="sub">Берём 20 новых роликов по 3 queries из top-performing provider mix.</div>
              </div>
              <span class="pill ok">ok</span>
            </div>
          </div>
          <div class="run">
            <div class="top">
              <div>
                <div class="name">2. analyze</div>
                <div class="sub">Из 20 роликов 8 идут в fast-pass analysis для пополнения pattern memory.</div>
              </div>
              <span class="pill ok">ok</span>
            </div>
          </div>
          <div class="run">
            <div class="top">
              <div>
                <div class="name">3. patterns/build</div>
                <div class="sub">Обновляем ranking по hook families и выкидываем слабые повторы.</div>
              </div>
              <span class="pill violet">persist</span>
            </div>
          </div>
          <div class="run">
            <div class="top">
              <div>
                <div class="name">4. generator + critic</div>
                <div class="sub">Новые сценарии и улучшения получают input уже не из intuition, а из corpus-derived memory.</div>
              </div>
              <span class="pill rose">next</span>
            </div>
          </div>
        </div>
        <p class="foot">
          URL этой демо-витрины можно отдавать без логина: <span class="mono">/inferno/vendor/reels-brain-demo</span>.
          Live-операции по-прежнему остаются внутри защищённой консоли <span class="mono">/agent/reels-brain</span>.
        </p>
      </section>
    </div>
  </div>
</body>
</html>`;

export async function GET() {
  return new NextResponse(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=0, must-revalidate",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}
