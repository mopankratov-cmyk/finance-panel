# Inferno styleguide — клон визуала infernoff.ru

Дизайн-система, снятая с **живых computed-стилей** infernoff.ru, для воспроизведения 1-в-1 в наших P0/P1 фичах.
Источник истины токенов — [`inferno-tokens.css`](inferno-tokens.css). Живой образец — [`inferno-styleguide.html`](inferno-styleguide.html).

Подключение в нашем Next 16 + Tailwind v4: `@import "../docs/design/inferno-tokens.css";` в `app/globals.css`
(или скопировать `:root`/`@theme`/утил-классы в свой слой). Шрифт — Inter.

## 1. Палитра (точные hex)

| Роль | hex | CSS-переменная |
|---|---|---|
| Фон страницы | `#F7F8FA` | `--bg-page` |
| Поверхность (карточка) | `#FFFFFF` | `--surface` |
| Подложка слабая | `#F9FAFB` | `--subtle` |
| Подложка thead/чип | `#F3F4F6` | `--subtle-2` |
| Граница | `#E5E7EB` | `--border` |
| Граница 2 | `#ECEEF2` | `--border-2` |
| Текст основной | `#111827` | `--text-primary` |
| Текст вторичный | `#374151` | `--text-secondary` |
| Текст приглушённый | `#9CA3AF` | `--text-muted` |
| Текст приглушённый 2 | `#6B7280` | `--text-muted-2` |
| Текст slate | `#5B6472` | `--text-slate` |
| **Акцент teal** (заголовки/значения) | `#0A8888` | `--c-teal` |
| **Violet** (нав-актив/действия) | `#7C3AED` | `--c-violet` |
| Violet-700 (hover/текст) | `#6D28D9` | `--c-violet-700` |
| Violet-surface (фон актив-чипа) | `#F4F1FE` | `--c-violet-surface` |
| **WB magenta** (логотип) | `#CB11AB` | `--c-wb` |
| Положительное (+) | `#16A34A` | `--c-pos` |
| Отрицательное (−) | `#DC2626` | `--c-neg` |
| Предупреждение | `#F59E0B` | `--c-warn` |
| Оранжевый | `#EA580C` | `--c-orange` |
| Зелёный сильный (heatmap ≥норма) | `#4ADE80` | `--c-green-strong` |
| Зелёный фон (пилюли) | `#DCFCE7` | `--bg-green` |
| Красный фон | `#FEE2E2` | `--bg-red` |
| Жёлтый фон (heatmap 80–99%) | `#FEF9C3` | `--bg-yellow` |

## 2. Типографика

Шрифт `--font-sans: Inter, -apple-system, system-ui, "Segoe UI", sans-serif`. Веса: **400** regular, **500** medium, **600** semibold, **800** только логотип.

| Роль | размер | вес | переменная |
|---|---|---|---|
| logo | 24px | 800 | `--weight-logo` |
| title экрана | 20px | 600 | `--fs-title` |
| body | 16px | 400 | `--fs-body` |
| nav | 14px | 500 | `--fs-nav` |
| control / число / чип | 12.8px | 500–600 | `--fs-control` |

Числа — `font-variant-numeric: tabular-nums`, выравнивание вправо.

## 3. Радиусы / границы

- `--radius-card: 10px` (карточки, актив-чип, логотип-плитка)
- `--radius-control: 8px` (кнопки, инпуты, иконки рейла)
- `--radius-pill: 6px` (пилюли, бейджи, ячейки heatmap)
- Границы всегда `1px solid var(--border)` (или `--border-2` для внутренних делений). Теней почти нет.

## 4. Рецепты компонентов

Все классы — из `inferno-tokens.css`.

**App shell — рейл + топбар**
```html
<aside class="rail">
  <span class="wb-logo" style="width:32px;height:32px;font-size:13px">WB</span>
  <a class="rail-icon is-active"><i class="ti ti-businessplan"></i></a>
  <a class="rail-icon"><i class="ti ti-activity"></i></a>
</aside>
```

**Заголовок экрана — kicker + title + chips**
```html
<div style="display:flex;align-items:center;gap:12px">
  <h1 style="font-size:var(--fs-title);font-weight:var(--weight-semibold)">Репрайсер</h1>
  <span class="chip-active">131 SKU · 16–22.06</span>
  <span class="status-ok">Режим планирования</span>
</div>
```

**Таблица — thead / section-row / pos-neg**
```html
<table>
  <thead class="table-head"><tr><th>Артикул</th><th>Цена</th><th>Δ</th><th>Маржа</th></tr></thead>
  <tbody>
    <tr class="table-section"><td colspan="4">Tim Tin · водные пистолеты</td></tr>
    <tr><td>Аквабластер Pro</td><td>1 290 ₽</td><td class="num-neg">−100</td><td class="num-pos">38%</td></tr>
  </tbody>
</table>
```

**Кнопки**
```html
<button class="btn-primary">Применить цены</button>
<button class="btn-secondary">Сухой прогон</button>
<button class="btn-success">Запустить крон</button>
```

**Чипы / пилюли**
```html
<span class="chip-active">Активный раздел</span>
<span class="status-ok">Режим планирования</span>
<span class="pill-ok">держится</span>
<span class="pill-warn">под наблюдением</span>
<span class="pill-bad">просела</span>
```

**Strategy-dot (3 варианта)**
```html
<span class="strategy-dot is-razgon"></span> Разгон GMROI
<span class="strategy-dot is-aut"></span> Скоро аут
<span class="strategy-dot is-margin"></span> Рост маржи
```

**Heatmap-ячейка (g / y / r)** — порог: `≥1.0 → .heat-g`, `0.8–0.99 → .heat-y`, `<0.8 → .heat-r`
```html
<div class="heat-g">112</div><div class="heat-y">88</div><div class="heat-r">62</div>
```

**Signal-badge (6 типов)** — нейтральная пилюля + цветная точка (карта из акцентов GT, единая во всех артефактах)
```html
<span class="signal-badge sig-content">Контент</span>   <!-- точка violet -->
<span class="signal-badge sig-comp">Конкуренты</span>   <!-- neg -->
<span class="signal-badge sig-ads">Реклама</span>       <!-- teal -->
<span class="signal-badge sig-stock">Остатки</span>     <!-- warn -->
<span class="signal-badge sig-drr">ДРР</span>           <!-- orange -->
<span class="signal-badge sig-margin">Маржа</span>      <!-- pos -->
```

## 5. Привязка к фичам (P0/P1)

| Фича | Компоненты дизайн-системы |
|---|---|
| **Репрайсер** (P0-1) | таблица + `strategy-dot` (3) + числа `num-pos/num-neg` (сетка цен по дням) + `btn-primary`/`btn-success` (прогон/применить) + крон-строка с live-точкой |
| **Решатель цены** (P0-2) | мини-таблица target-маржа (15/25/35%) + `num-pos/num-neg` для дельты + `heat-*` для подсветки отклонения |
| **Сигналы** (P0-3) | `signal-badge` (6 типов) в колонке РНП/воронки/seo + лента в agent |
| **Докидывание рекламы** (P1) | `chip-active` для окон (часы) + `status-ok`/`pill-warn` статус + `btn-success` запуск |
| **CTR-тест** (P1) | `pill-ok` «держится» / `pill-bad` «просела» + таблица результатов «3.65% → 4.44% +22%» |

## Замечания

- **Каноничная карта сигналов:** GT не задаёт per-type цвета бейджей, поэтому принято решение — нейтральная пилюля (`--subtle-2` / `--text-secondary`) + цветная точка из акцентов GT (violet/neg/teal/warn/orange/pos). Один и тот же набор в `inferno-tokens.css` и `inferno-styleguide.html`. Если захотим тонированные фоны — вводить как именованные токены, не «случайные» hex.
- **Контраст на цветных фонах:** текст heatmap-ячеек = `--text-primary` (#111827, читается на всех трёх фонах); зелёный текст пилюль = `--c-pos` (#16A34A). Никаких hex вне палитры GT.
- Тёмная тема (как `studio.html` у Юры) — отдельная задача; здесь только светлая.
