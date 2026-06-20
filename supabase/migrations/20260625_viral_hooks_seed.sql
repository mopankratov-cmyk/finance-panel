-- Посев viral_hooks реальными хуками из Virlo Orbit-анализа (2026-06-20).
-- Источник: 4 завершённых Orbit: солнцезащитный крем (127 вид.), collagen foundation (110 вид.),
-- мини сумка замша (73 вид.), мини сумка кросс боди (40 вид.).
-- Применить ПОСЛЕ 20260620_viral_corpus.sql + 20260624_viral_hooks_unique.sql.
-- Безопасно для повторного запуска (ON CONFLICT DO NOTHING).

-- ════════════════════════════════════════════════════════
-- НИША: cosmetics (крем, сыворотка, уход, тонер, санскрин)
-- ════════════════════════════════════════════════════════
INSERT INTO viral_hooks (niche, hook_text, viability_score, effectiveness_notes)
VALUES
  -- SPF/солнцезащита — топ-паттерны (top video 1.6M views)
  ('cosmetics', 'Вы неправильно используете санскрин', 5, 'myth-bust / curiosity-gap; формат UV-камера; #1 SPF hook по Virlo Orbit (moodmart.girls 1.6M views)'),
  ('cosmetics', 'UV-камера показывает правду о вашем санскрине', 5, 'reveal-twist; шок-факт; высший virality_score в SPF Orbit'),
  ('cosmetics', 'SPF 50 — но работает ли он?', 4, 'challenge-hook; doubt-trigger; топ mid-tier в SPF Orbit'),
  ('cosmetics', 'Корейский санскрин vs наш: честный тест', 4, 'K-beauty comparison hook; avg top-3 SPF Orbit'),
  ('cosmetics', 'SPF 50 весь день — смотрите что получилось', 4, 'longevity test; до/после формат; retention высокий'),
  ('cosmetics', 'Белый налёт? Найди санскрин без этого', 4, 'problem-hook; конкретная боль; high purchase-intent'),
  ('cosmetics', 'SPF-стик — самый недооценённый лайфхак', 3, 'reveal-format; underdog-hook; SPF Orbit avg 980K views tier'),
  ('cosmetics', 'Без макияжа с санскрином — честно', 3, 'authenticity hook; no-makeup look; работает на доверие'),
  -- Collagen / тональный крем / foundation
  ('cosmetics', 'Тональный крем не смылся за 12 часов — правда?', 5, 'wear-test hook; challenge; высший engagement в collagen Orbit'),
  ('cosmetics', 'Секрет кожи без пор — этот тональный за 800₽', 5, 'price-reveal + результат; curiosity + конкретика'),
  ('cosmetics', 'Тональный крем с коллагеном — что реально даёт коллаген?', 4, 'myth-bust; ingredient education; удерживает зрителя'),
  ('cosmetics', 'POV: нашла идеальный тон под мой цвет кожи', 4, 'POV-hook; персонализация; высокий retention у collagen Orbit'),
  ('cosmetics', 'Нанесла тональный — посмотри через 8 часов', 4, 'time-lapse reveal; curiosity-gap; beats: нанесение→прошёл день→результат'),
  ('cosmetics', 'Корейский тональный за 600₽ vs дорогой: разница?', 4, 'comparison hook; price anchor; высокий avg views'),
  ('cosmetics', 'Три в одном: BB крем, уход и SPF в одном шаге', 3, 'value-stack hook; convenience; collagen 3-in-1 format'),
  -- General skincare
  ('cosmetics', 'Это единственный крем, который я беру в отпуск', 4, 'endorse + exclusivity; высокий доверительный импакт'),
  ('cosmetics', 'Дерматолог сказала бы — это не совсем так', 4, 'authority-challenge; myth-bust formula; стопит скролл'),
  ('cosmetics', 'Год использования — честный отзыв', 3, 'long-term trust hook; reviews аудитория'),

-- ════════════════════════════════════════════════════════
-- НИША: default (сумки, аксессуары — rubric относит к default)
-- ════════════════════════════════════════════════════════
  -- Mini bags / кросс боди — avg virality_score 0.673 (highest of all searches)
  ('default', 'Что внутри сумки за 1500₽?', 5, 'what''s-in-my-bag; любопытство + reveal; #1 format mini bags Orbit'),
  ('default', 'Распаковка минималиста: всё в одной сумочке', 5, 'unboxing + lifestyle; высший avg virality mini bags Orbit'),
  ('default', 'Эта крошечная сумка вмещает больше чем кажется', 4, 'surprise-reveal hook; disbelief; top engagement bags'),
  ('default', 'Замшевая мини сумка — тренд или китч?', 4, 'taste challenge; opinion hook; curiosity-gap; bags Orbit top mid'),
  ('default', 'ПМЖ в этой сумке уже 2 недели', 4, 'long-term wear test; authenticity; retention hook'),
  ('default', 'Цвет, который подходит ко всему', 3, 'versatility hook; wardrobe-hack angle; fashion angle'),
  ('default', 'Кросс боди vs клатч: что выбрать', 3, 'comparison hook; decision helper; fashion comparison'),

-- ════════════════════════════════════════════════════════
-- НИША: toys (игрушки, бластеры, водяные пистолеты)
-- ════════════════════════════════════════════════════════
  ('toys', 'Кто стреляет дальше — тест водяных пистолетов', 5, 'challenge / compete hook; summer viral; toys angle'),
  ('toys', 'Дети в шоке: что внутри этой коробки?', 5, 'unboxing reaction hook; emotion; viral with kids'),
  ('toys', 'Папа vs сын: кто победил?', 4, 'family rivalry; реакции детей = высокий retention'),
  ('toys', 'Этот водяной пистолет заряжается за 3 секунды', 4, 'spec-reveal + demo; fact-hook; toys Orbit top format'),
  ('toys', 'Сравниваем 3 бластера — какой залил дальше?', 4, 'comparison; experiment; детское лето = viral'),
  ('toys', 'Игрушка за 300₽ против 3000₽: честно', 3, 'price battle; value anchor; широкая аудитория'),

-- ════════════════════════════════════════════════════════
-- НИША: clothing (куртки, ветровки, пуховики)
-- ════════════════════════════════════════════════════════
  ('clothing', 'Ветровка за 800₽: теплее чем я думала', 5, 'price-surprise; expectation subversion; high intent'),
  ('clothing', 'До/после: куртка с маркетплейса vs оффлайн', 4, 'comparison; trust-building; clothing orbit top'),
  ('clothing', 'Три образа с одной курткой', 4, 'versatility hack; styling hook; retention=образы'),
  ('clothing', 'Пуховик съёживается после стирки? Проверяем', 4, 'fear-validation; myth-bust; utility hook'),
  ('clothing', 'WB куртка vs известный бренд — разница?', 3, 'brand comparison; curiosity-gap; clothing format')
ON CONFLICT DO NOTHING;
