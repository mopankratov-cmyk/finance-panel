import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const products = [
  // ООО РИО — EASY SCHOOL
  { article: "ESC00111", wb_barcode: "2007275090000", brand: "EASY SCHOOL", entity: "ООО РИО", name: "Пенал для школы (серый)", cost_rub: 37.23, warehouse_expenses: 9.57 },
  { article: "ESC00112", wb_barcode: "2007275095005", brand: "EASY SCHOOL", entity: "ООО РИО", name: "Пенал для школы (голубой)", cost_rub: 37.23, warehouse_expenses: 9.57 },
  { article: "ESC00113", wb_barcode: "2007275111002", brand: "EASY SCHOOL", entity: "ООО РИО", name: "Пенал для школы (розовый)", cost_rub: 37.23, warehouse_expenses: 9.57 },
  { article: "ESC00114", wb_barcode: "2007275127003", brand: "EASY SCHOOL", entity: "ООО РИО", name: "Пенал для школы (лаванда)", cost_rub: 37.23, warehouse_expenses: 9.57 },
  { article: "ESC00120", wb_barcode: "2038167620517", brand: "EASY SCHOOL", entity: "ООО РИО", name: "Пенал для школы (изумрудный)", cost_rub: 37.23, warehouse_expenses: 9.57 },
  { article: "ESC00121", wb_barcode: "2038167623419", brand: "EASY SCHOOL", entity: "ООО РИО", name: "Пенал для школы (черный)", cost_rub: 34.88, warehouse_expenses: 9.57 },
  { article: "ESC00122", wb_barcode: "2038170837919", brand: "EASY SCHOOL", entity: "ООО РИО", name: "Пенал для школы (белый)", cost_rub: 37.23, warehouse_expenses: 9.57 },
  { article: "ESC00124", wb_barcode: "2043762327556", brand: "EASY SCHOOL", entity: "ООО РИО", name: "Пенал NEW не сетка (черный)", cost_rub: 33.64, warehouse_expenses: 9.57 },
  // ООО РИО — PLAY CLAY
  { article: "PLC01101", wb_barcode: "2041141166703", brand: "PLAY CLAY", entity: "ООО РИО", name: "Набор для лепки Космос", cost_rub: 645.00, warehouse_expenses: 9.58 },
  { article: "PLC01102", wb_barcode: "2041141222164", brand: "PLAY CLAY", entity: "ООО РИО", name: "Набор для лепки Динозавры", cost_rub: 645.00, warehouse_expenses: 9.58 },
  { article: "PLC01103", wb_barcode: "2041141223987", brand: "PLAY CLAY", entity: "ООО РИО", name: "Набор для лепки Кухня", cost_rub: 645.00, warehouse_expenses: 9.58 },
  { article: "PLC01201", wb_barcode: "2041141227435", brand: "PLAY CLAY", entity: "ООО РИО", name: "Мини-набор для лепки Десерты", cost_rub: 133.00, warehouse_expenses: 9.58 },
  { article: "PLC01202", wb_barcode: "2041141230879", brand: "PLAY CLAY", entity: "ООО РИО", name: "Мини-набор для лепки Мороженое", cost_rub: 133.00, warehouse_expenses: 9.58 },
  // ООО РИО — TIM TIN
  { article: "TT01101", wb_barcode: "2041244179266", brand: "TIM TIN", entity: "ООО РИО", name: "Собака-робот на 8 колесах", cost_rub: 1179.16, warehouse_expenses: 57.90 },
  { article: "TT01102", wb_barcode: "2041244179617", brand: "TIM TIN", entity: "ООО РИО", name: "Динозавр на 8 колесах", cost_rub: 1304.83, warehouse_expenses: 64.11 },
  { article: "TT01103", wb_barcode: "2041272371601", brand: "TIM TIN", entity: "ООО РИО", name: "Дрифт машина", cost_rub: 825.44, warehouse_expenses: 64.11 },
  { article: "TT02101", wb_barcode: "2041272303442", brand: "TIM TIN", entity: "ООО РИО", name: "Игровой автомат мишка-динозавр", cost_rub: 1410.21, warehouse_expenses: 186.86 },
  { article: "TT02201", wb_barcode: "2041272307983", brand: "TIM TIN", entity: "ООО РИО", name: "Игровой автомат мишка в космосе серый", cost_rub: 2641.30, warehouse_expenses: 186.86 },
  { article: "TT02202", wb_barcode: "2041272309550", brand: "TIM TIN", entity: "ООО РИО", name: "Игровой автомат мишка в космосе розовый", cost_rub: 2641.30, warehouse_expenses: 186.86 },
  { article: "TT02301", wb_barcode: "2041272311317", brand: "TIM TIN", entity: "ООО РИО", name: "Мини-игровой автомат мишка в космосе серый", cost_rub: 1027.33, warehouse_expenses: 70.38 },
  { article: "TT03101", wb_barcode: "2041300054520", brand: "TIM TIN", entity: "ООО РИО", name: "Робособака рыжая на солнечной батарее", cost_rub: 37.00, warehouse_expenses: 37.79 },
  { article: "TT03102", wb_barcode: "2041300056913", brand: "TIM TIN", entity: "ООО РИО", name: "Робособака серая на пульте управления", cost_rub: 37.00, warehouse_expenses: 37.79 },
  { article: "TT04101", wb_barcode: "2043305490075", brand: "TIM TIN", entity: "ООО РИО", name: "Водяной пистолет УЗИ (207мл) черный", cost_rub: 348.66, warehouse_expenses: 57.90 },
  { article: "TT04102", wb_barcode: "2043305490426", brand: "TIM TIN", entity: "ООО РИО", name: "Водяной пистолет УЗИ (210мл) зеленый", cost_rub: 324.42, warehouse_expenses: 57.90 },
  { article: "TT05101", wb_barcode: "2043305561102", brand: "TIM TIN", entity: "ООО РИО", name: "Водяная винтовка (M416) белая", cost_rub: 444.52, warehouse_expenses: 57.90 },
  { article: "TT05102", wb_barcode: "2043305561522", brand: "TIM TIN", entity: "ООО РИО", name: "Водяная винтовка (M416) беж", cost_rub: 444.52, warehouse_expenses: 57.90 },
  { article: "TT06101", wb_barcode: "2043305610237", brand: "TIM TIN", entity: "ООО РИО", name: "Водяной пистолет NEO (750мл) зеленый", cost_rub: 954.17, warehouse_expenses: 57.90 },
  { article: "TT06102", wb_barcode: "2043305616727", brand: "TIM TIN", entity: "ООО РИО", name: "Водяной пистолет NEO (750мл) голубой", cost_rub: 954.17, warehouse_expenses: 57.90 },
  { article: "TT06103", wb_barcode: "2043305635636", brand: "TIM TIN", entity: "ООО РИО", name: "Водяной пистолет NEO (750мл) белый", cost_rub: 954.17, warehouse_expenses: 57.90 },
  // ИП КУЧЕРЕНКО — CLERIN
  { article: "CLR00711", wb_barcode: "2038590855098", brand: "CLERIN", entity: "ИП КУЧЕРЕНКО", name: "Сумка мини 2 кросс-боди коричневая замша", cost_rub: 436.45, warehouse_expenses: 67.48 },
  { article: "CLR00712", wb_barcode: "2038590861402", brand: "CLERIN", entity: "ИП КУЧЕРЕНКО", name: "Сумка мини 2 кросс-боди серая замша", cost_rub: 436.45, warehouse_expenses: 67.48 },
  { article: "CLR00713", wb_barcode: "2038590869071", brand: "CLERIN", entity: "ИП КУЧЕРЕНКО", name: "Сумка мини 2 кросс-боди черная замша", cost_rub: 450.25, warehouse_expenses: 67.48 },
  { article: "CLR00714", wb_barcode: "2039724366268", brand: "CLERIN", entity: "ИП КУЧЕРЕНКО", name: "Сумка мини 2 кросс-боди белая замша", cost_rub: 436.45, warehouse_expenses: 67.48 },
  { article: "CLR00715", wb_barcode: "2048457076948", brand: "CLERIN", entity: "ИП КУЧЕРЕНКО", name: "Сумка мини 2 кросс-боди Шоколад", cost_rub: 450.25, warehouse_expenses: 67.48 },
  { article: "CLR00716", wb_barcode: "2048457089023", brand: "CLERIN", entity: "ИП КУЧЕРЕНКО", name: "Сумка мини 2 кросс-боди Капучино", cost_rub: 450.25, warehouse_expenses: 67.48 },
  { article: "CLR00911", wb_barcode: "2041233814796", brand: "CLERIN", entity: "ИП КУЧЕРЕНКО", name: "Сумка вельвет черная", cost_rub: 384.78, warehouse_expenses: 76.23 },
  { article: "CLR00912", wb_barcode: "2041233815175", brand: "CLERIN", entity: "ИП КУЧЕРЕНКО", name: "Сумка вельвет коричневая", cost_rub: 384.78, warehouse_expenses: 76.23 },
  { article: "CLR00913", wb_barcode: "2042629131770", brand: "CLERIN", entity: "ИП КУЧЕРЕНКО", name: "Сумка вельвет шоколадная", cost_rub: 384.78, warehouse_expenses: 76.23 },
  { article: "CLR01011", wb_barcode: "2041233894361", brand: "CLERIN", entity: "ИП КУЧЕРЕНКО", name: "Сумка офисная черная", cost_rub: 711.45, warehouse_expenses: 76.23 },
  { article: "CLR01012", wb_barcode: "2041233895740", brand: "CLERIN", entity: "ИП КУЧЕРЕНКО", name: "Сумка офисная коричневая", cost_rub: 711.45, warehouse_expenses: 76.23 },
  { article: "CLR001101", wb_barcode: "2048457018740", brand: "CLERIN", entity: "ИП КУЧЕРЕНКО", name: "Сумка трапеция на плечо черная", cost_rub: 415.45, warehouse_expenses: 67.48 },
  { article: "CLR001102", wb_barcode: "2048457049829", brand: "CLERIN", entity: "ИП КУЧЕРЕНКО", name: "Сумка трапеция на плечо шоколад", cost_rub: 415.45, warehouse_expenses: 67.48 },

  // ИП ПАНКРАТОВ — ANJO
  { article: "ANJ036501", wb_barcode: "2028879074623", brand: "ANJO", entity: "ИП ПАНКРАТОВ", name: "ANJO 365 sun cream SPF 50+", cost_rub: 121.0, warehouse_expenses: 15.5 },

  // ИП ПАНКРАТОВ — ENOUGH тональники
  { article: "EN00113",  wb_barcode: "2001280644005", brand: "ENOUGH", entity: "ИП ПАНКРАТОВ", name: "Тональный крем с коллагеном SPF15 тон 13", cost_rub: 230.3, warehouse_expenses: 15.5 },
  { article: "EN00121",  wb_barcode: "2001280651003", brand: "ENOUGH", entity: "ИП ПАНКРАТОВ", name: "Тональный крем с коллагеном SPF15 тон 21", cost_rub: 230.3, warehouse_expenses: 15.5 },
  { article: "EN000813", wb_barcode: "2003532000003", brand: "ENOUGH", entity: "ИП ПАНКРАТОВ", name: "ENOUGH Collagen 3 in 1 Foundation SPF15 #13", cost_rub: 243.5, warehouse_expenses: 15.5 },
  { article: "EN000821", wb_barcode: "2001164379061", brand: "ENOUGH", entity: "ИП ПАНКРАТОВ", name: "ENOUGH Collagen 3 in 1 Foundation SPF15 #21", cost_rub: 241.5, warehouse_expenses: 13.5 },
  { article: "EN000823", wb_barcode: "2011059142007", brand: "ENOUGH", entity: "ИП ПАНКРАТОВ", name: "ENOUGH Collagen 3 in 1 Foundation SPF15 #23", cost_rub: 241.5, warehouse_expenses: 13.5 },
  { article: "EN001013", wb_barcode: "2001280723007", brand: "ENOUGH", entity: "ИП ПАНКРАТОВ", name: "ENOUGH RICH GOLD DOUBLE WEAR FOUNDATION #13", cost_rub: 281.1, warehouse_expenses: 13.5 },
  { article: "EN001021", wb_barcode: "2001280727005", brand: "ENOUGH", entity: "ИП ПАНКРАТОВ", name: "ENOUGH RICH GOLD DOUBLE WEAR FOUNDATION #21", cost_rub: 281.1, warehouse_expenses: 13.5 },
  { article: "EN001613", wb_barcode: "2001280558005", brand: "ENOUGH", entity: "ИП ПАНКРАТОВ", name: "ENOUGH ULTRA X10 COVER UP COLLAGEN FOUNDATION #13", cost_rub: 281.1, warehouse_expenses: 13.5 },
  { article: "EN001621", wb_barcode: "2001280569001", brand: "ENOUGH", entity: "ИП ПАНКРАТОВ", name: "ENOUGH ULTRA X10 COVER UP COLLAGEN FOUNDATION #21", cost_rub: 281.1, warehouse_expenses: 13.5 },
  { article: "EN001623", wb_barcode: "2011064393005", brand: "ENOUGH", entity: "ИП ПАНКРАТОВ", name: "ENOUGH ULTRA X10 COVER UP COLLAGEN FOUNDATION #23", cost_rub: 281.1, warehouse_expenses: 13.5 },
  { article: "EN001713", wb_barcode: "2038757303226", brand: "ENOUGH", entity: "ИП ПАНКРАТОВ", name: "8 PEPTIDE FULL COVER PERFECT FOUNDATION #13", cost_rub: 281.1, warehouse_expenses: 13.5 },
  { article: "EN001721", wb_barcode: "2038757308689", brand: "ENOUGH", entity: "ИП ПАНКРАТОВ", name: "8 PEPTIDE FULL COVER PERFECT FOUNDATION #21", cost_rub: 281.1, warehouse_expenses: 13.5 },
  { article: "EN001801", wb_barcode: "2038757313096", brand: "ENOUGH", entity: "ИП ПАНКРАТОВ", name: "ENOUGH Корректор Collagen whitening cover tip concealer #01", cost_rub: 150.0, warehouse_expenses: 14.0 },
  { article: "EN001802", wb_barcode: "2038757321992", brand: "ENOUGH", entity: "ИП ПАНКРАТОВ", name: "ENOUGH Корректор Collagen whitening cover tip concealer #02", cost_rub: 148.0, warehouse_expenses: 12.0 },

  // ИП ПАНКРАТОВ — ENOUGH пудры
  { article: "EN000313", wb_barcode: "2001280618006", brand: "ENOUGH", entity: "ИП ПАНКРАТОВ", name: "ENOUGH Collagen Twoway Cake SPF50 PA++ #13", cost_rub: 371.4, warehouse_expenses: 14.8 },
  { article: "EN000321", wb_barcode: "2001164379078", brand: "ENOUGH", entity: "ИП ПАНКРАТОВ", name: "ENOUGH Collagen Twoway Cake SPF50 PA++ #21", cost_rub: 371.4, warehouse_expenses: 14.8 },
  { article: "EN002913", wb_barcode: "2001164379108", brand: "ENOUGH", entity: "ИП ПАНКРАТОВ", name: "ENOUGH Collagen whitening 3in1 twoway cake #13", cost_rub: 392.0, warehouse_expenses: 14.8 },
  { article: "EN002921", wb_barcode: "2001164379115", brand: "ENOUGH", entity: "ИП ПАНКРАТОВ", name: "ENOUGH Collagen whitening 3in1 twoway cake #21", cost_rub: 392.0, warehouse_expenses: 14.8 },

  // ИП ПАНКРАТОВ — ENOUGH BB кремы
  { article: "EN004669", wb_barcode: "2002680673008", brand: "ENOUGH", entity: "ИП ПАНКРАТОВ", name: "Collagen Moisture BB Cream SPF47+PA+++", cost_rub: 143.4, warehouse_expenses: 14.6 },
  { article: "EN005576", wb_barcode: "2001164379092", brand: "ENOUGH", entity: "ИП ПАНКРАТОВ", name: "Collagen 3 in 1 Whitening Moisture BB Cream", cost_rub: 169.8, warehouse_expenses: 14.6 },

  // ИП ПАНКРАТОВ — ENOUGH солнцезащитные
  { article: "EN001945", wb_barcode: "2001280777000", brand: "ENOUGH", entity: "ИП ПАНКРАТОВ", name: "ENOUGH Collagen Moisture Sun Cream SPF50+ PA+++", cost_rub: 173.2, warehouse_expenses: 15.5 },
  { article: "EN099952", wb_barcode: "2002680365002", brand: "ENOUGH", entity: "ИП ПАНКРАТОВ", name: "ENOUGH COLLAGEN 3 in 1 WHITENING MOISTURE SUN CREAM SPF50", cost_rub: 186.7, warehouse_expenses: 15.5 },

  // ИП ПАНКРАТОВ — ENOUGH кремы
  { article: "EN000431", wb_barcode: "2001280752007", brand: "ENOUGH", entity: "ИП ПАНКРАТОВ", name: "ENOUGH Collagen Moisture Essential Cream", cost_rub: 188.9, warehouse_expenses: 15.5 },
  { article: "EN000565", wb_barcode: "2001164379085", brand: "ENOUGH", entity: "ИП ПАНКРАТОВ", name: "ENOUGH Collagen Whitening Moisture Cream 3 in 1", cost_rub: 193.9, warehouse_expenses: 15.5 },
  { article: "EN002725", wb_barcode: "2001164379146", brand: "ENOUGH", entity: "ИП ПАНКРАТОВ", name: "ENOUGH Collagen hydro moisture cleansing massage cream", cost_rub: 301.9, warehouse_expenses: 22.3 },

  // ИП ПАНКРАТОВ — I'm Sorry for My Skin
  { article: "ISMS1011", wb_barcode: "2036863101620", brand: "I'm Sorry for My Skin", entity: "ИП ПАНКРАТОВ", name: "I'm Sorry for My Skin Age Capture Vitalizer Cream", cost_rub: 475.7, warehouse_expenses: 16.6 },
  { article: "ISMS1012", wb_barcode: "2036863109756", brand: "I'm Sorry for My Skin", entity: "ИП ПАНКРАТОВ", name: "I'm Sorry for My Skin Age Capture Hydrating Cream", cost_rub: 475.7, warehouse_expenses: 16.6 },
  { article: "ISMS1013", wb_barcode: "2037849481941", brand: "I'm Sorry for My Skin", entity: "ИП ПАНКРАТОВ", name: "I'm Sorry for My Skin Age Capture Firming Enriched Cream", cost_rub: 475.7, warehouse_expenses: 16.6 },
  { article: "ISMS1014", wb_barcode: "2037849489350", brand: "I'm Sorry for My Skin", entity: "ИП ПАНКРАТОВ", name: "I'm Sorry for My Skin Age Capture Skin Relief Cream", cost_rub: 475.7, warehouse_expenses: 16.6 },
  { article: "SRM1101",  wb_barcode: "2019203956005", brand: "I'm Sorry for My Skin", entity: "ИП ПАНКРАТОВ", name: "Набор Масок I'm Sorry Of My Skin (5 шт) — вариант 1", cost_rub: 387.3, warehouse_expenses: 18.1 },
  { article: "SRM1102",  wb_barcode: "2019203979004", brand: "I'm Sorry for My Skin", entity: "ИП ПАНКРАТОВ", name: "Набор Масок I'm Sorry Of My Skin (5 шт) — вариант 2", cost_rub: 387.3, warehouse_expenses: 18.1 },

  // ИП ПАНКРАТОВ — JIGOTT кремы
  { article: "JG0101", wb_barcode: "2019200449005", brand: "JIGOTT", entity: "ИП ПАНКРАТОВ", name: "JIGOTT BIRD'S NEST WRINKLE CREAM", cost_rub: 179.3, warehouse_expenses: 15.5 },
  { article: "JG0102", wb_barcode: "2019200457000", brand: "JIGOTT", entity: "ИП ПАНКРАТОВ", name: "JIGOTT SNAIL LIFTING CREAM", cost_rub: 179.3, warehouse_expenses: 15.5 },
  { article: "JG0103", wb_barcode: "2038757229236", brand: "JIGOTT", entity: "ИП ПАНКРАТОВ", name: "JIGOTT HORSE OIL MOISTURE CREAM", cost_rub: 179.3, warehouse_expenses: 15.5 },
  { article: "JG0104", wb_barcode: "2038757238498", brand: "JIGOTT", entity: "ИП ПАНКРАТОВ", name: "JIGOTT GOAT MILK BRIGHTENING CREAM", cost_rub: 179.3, warehouse_expenses: 15.5 },
  { article: "JG0105", wb_barcode: "2038757241962", brand: "JIGOTT", entity: "ИП ПАНКРАТОВ", name: "JIGOTT POMEGRANATE SHINING CREAM", cost_rub: 179.3, warehouse_expenses: 15.5 },
  { article: "JG0106", wb_barcode: "2038757246684", brand: "JIGOTT", entity: "ИП ПАНКРАТОВ", name: "JIGOTT ARGAN RICH CREAM", cost_rub: 179.3, warehouse_expenses: 15.5 },
  { article: "JG0107", wb_barcode: "2038757250407", brand: "JIGOTT", entity: "ИП ПАНКРАТОВ", name: "JIGOTT ALOE WATER BLUE CREAM", cost_rub: 179.3, warehouse_expenses: 15.5 },
  { article: "JG0301", wb_barcode: "2019201470008", brand: "JIGOTT", entity: "ИП ПАНКРАТОВ", name: "JIGOTT ROSE FLOWER ENERGIZING CREAM", cost_rub: 241.5, warehouse_expenses: 16.7 },
  { article: "JG0302", wb_barcode: "2019205567001", brand: "JIGOTT", entity: "ИП ПАНКРАТОВ", name: "JIGOTT EDELWEISS FLOWER HYDRATION CREAM", cost_rub: 241.5, warehouse_expenses: 16.7 },
  { article: "JG0401", wb_barcode: "2038757257277", brand: "JIGOTT", entity: "ИП ПАНКРАТОВ", name: "Jigott Hyaluronic Acid Water bomb Cream", cost_rub: 232.1, warehouse_expenses: 17.0 },
  { article: "JG0402", wb_barcode: "2038757262769", brand: "JIGOTT", entity: "ИП ПАНКРАТОВ", name: "Jigott Aloe Vera Water bomb Cream", cost_rub: 232.1, warehouse_expenses: 17.0 },

  // ИП ПАНКРАТОВ — JIGOTT маски
  { article: "JG0201", wb_barcode: "2019202574002", brand: "JIGOTT", entity: "ИП ПАНКРАТОВ", name: "JIGOTT REAL AMPOULE MASK (12 шт.)", cost_rub: 212.5, warehouse_expenses: 29.5 },
  { article: "JG0202", wb_barcode: "2038326800804", brand: "JIGOTT", entity: "ИП ПАНКРАТОВ", name: "JIGOTT REAL AMPOULE MASK (24 шт.)", cost_rub: 398.1, warehouse_expenses: 42.0 },

  // ИП ПАНКРАТОВ — JIGOTT тонеры
  { article: "JG0501", wb_barcode: "2038757268075", brand: "JIGOTT", entity: "ИП ПАНКРАТОВ", name: "Тонер для лица - Jigott Ultimate Real Collagen Toner", cost_rub: 218.9, warehouse_expenses: 20.0 },
  { article: "JG0502", wb_barcode: "2038757271143", brand: "JIGOTT", entity: "ИП ПАНКРАТОВ", name: "Тонер для лица - Jigott Daily Real Cica Toner", cost_rub: 218.9, warehouse_expenses: 20.0 },
  { article: "JG0503", wb_barcode: "2038757274350", brand: "JIGOTT", entity: "ИП ПАНКРАТОВ", name: "Тонер для лица - Jigott Moisture Real Aloe Vera Toner", cost_rub: 218.9, warehouse_expenses: 20.0 },

  // ИП ПАНКРАТОВ — JIGOTT сыворотки
  { article: "JG0701", wb_barcode: "2038757287069", brand: "JIGOTT", entity: "ИП ПАНКРАТОВ", name: "Сыворотка - Jigott Natural Retinol Perfect Serum", cost_rub: 224.3, warehouse_expenses: 15.5 },
  { article: "JG0702", wb_barcode: "2038757289865", brand: "JIGOTT", entity: "ИП ПАНКРАТОВ", name: "Сыворотка - Jigott Natural Carrot Perfect Serum", cost_rub: 220.3, warehouse_expenses: 15.5 },

  // ИП ПАНКРАТОВ — JIGOTT пенка
  { article: "JG1001", wb_barcode: "2038757297310", brand: "JIGOTT", entity: "ИП ПАНКРАТОВ", name: "Пенка - Jigott Vita Solution 12 Moisture Foam Cleansing", cost_rub: 175.7, warehouse_expenses: 20.0 },

  // ИП ПАНКРАТОВ — JIGOTT носочки
  { article: "JG0901", wb_barcode: "2038762111670", brand: "JIGOTT", entity: "ИП ПАНКРАТОВ", name: "Носочки для ног JIGOTT FOOT PACK 2 шт.", cost_rub: 198.9, warehouse_expenses: 15.5 },
  { article: "JG0902", wb_barcode: "2038762117443", brand: "JIGOTT", entity: "ИП ПАНКРАТОВ", name: "Носочки для ног JIGOTT FOOT PACK 3 шт.", cost_rub: 290.7, warehouse_expenses: 15.5 },

  // ИП ПАНКРАТОВ — TOO COOL FOR SCHOOL
  { article: "TCS000210", wb_barcode: "2001412042006", brand: "TOO COOL FOR SCHOOL", entity: "ИП ПАНКРАТОВ", name: "TOO COOL FOR SCHOOL Pumpkin Sleeping Pack Sample (10 шт)", cost_rub: 118.9, warehouse_expenses: 19.8 },
  { article: "TCS00111",  wb_barcode: "2001412027003", brand: "TOO COOL FOR SCHOOL", entity: "ИП ПАНКРАТОВ", name: "TOO COOL FOR SCHOOL Pumpkin Sleeping Pack 100 ml", cost_rub: 425.1, warehouse_expenses: 18.3 },
  { article: "TCS00245",  wb_barcode: "2001281056005", brand: "TOO COOL FOR SCHOOL", entity: "ИП ПАНКРАТОВ", name: "TOO COOL FOR SCHOOL Pumpkin Sleeping Pack 30 ml", cost_rub: 210.6, warehouse_expenses: 10.5 },

  // ИП ПАНКРАТОВ — YOYO
  { article: "YYS0101", wb_barcode: "2043109933761", brand: "YOYO", entity: "ИП ПАНКРАТОВ", name: "Солнцезащитный крем для лица YoYo SPF50", cost_rub: 146.4, warehouse_expenses: 12.0 },
  { article: "YYS0301", wb_barcode: "2043109966073", brand: "YOYO", entity: "ИП ПАНКРАТОВ", name: "Солнцезащитный гель для лица YOYO 50 spf", cost_rub: 184.7, warehouse_expenses: 12.0 },

  // ООО ГЛОБАЛКОС — BERGAMO
  { article: "BER0101", wb_barcode: "2038436580610", brand: "BERGAMO", entity: "ООО ГЛОБАЛКОС", name: "BERGAMO SNAIL ESSENTIAL INTENSIVE CREAM", cost_rub: 254.5, warehouse_expenses: 16.4 },
  { article: "BER0102", wb_barcode: "2039782645688", brand: "BERGAMO", entity: "ООО ГЛОБАЛКОС", name: "BERGAMO SYN-AKE ESSENTIAL INTENSIVE CREAM", cost_rub: 231.2, warehouse_expenses: 16.4 },
  { article: "BER0301", wb_barcode: "2038437832541", brand: "BERGAMO", entity: "ООО ГЛОБАЛКОС", name: "BERGAMO SYN-AKE ESSENTIAL INTENSIVE EYECREAM", cost_rub: 230.8, warehouse_expenses: 12.8 },
  { article: "BER0401", wb_barcode: "2039782674695", brand: "BERGAMO", entity: "ООО ГЛОБАЛКОС", name: "BERGAMO SYN-AKE ESSENTIAL INTENSIVE SKIN TONER", cost_rub: 263.5, warehouse_expenses: 17.3 },

  // ООО ГЛОБАЛКОС — EKEL
  { article: "EK0201", wb_barcode: "2038438703673", brand: "EKEL", entity: "ООО ГЛОБАЛКОС", name: "Тонер для лица - Ampoule Toner Collagen 150ml", cost_rub: 290.7, warehouse_expenses: 16.6 },

  // ООО ГЛОБАЛКОС — LEBELAGE
  { article: "LEB0101", wb_barcode: "2038429303882", brand: "LEBELAGE", entity: "ООО ГЛОБАЛКОС", name: "LEBELAGE Dr. COLLAGEN CURE CREAM 70ml", cost_rub: 225.2, warehouse_expenses: 16.6 },
  { article: "LEB0102", wb_barcode: "2039779157996", brand: "LEBELAGE", entity: "ООО ГЛОБАЛКОС", name: "LEBELAGE Dr. HYALURONIC CURE CREAM 70ml", cost_rub: 221.6, warehouse_expenses: 16.6 },
  { article: "LEB0201", wb_barcode: "2038430286549", brand: "LEBELAGE", entity: "ООО ГЛОБАЛКОС", name: "LEBELAGE Dr. VITAMIN C DERMA AMPOULE", cost_rub: 199.8, warehouse_expenses: 14.8 },
  { article: "LEB0301", wb_barcode: "2038430710303", brand: "LEBELAGE", entity: "ООО ГЛОБАЛКОС", name: "LEBELAGE Dr. HYALURONIC DERMA SKIN 210ml", cost_rub: 286.5, warehouse_expenses: 18.6 },
  { article: "LEB0401", wb_barcode: "2038432361053", brand: "LEBELAGE", entity: "ООО ГЛОБАЛКОС", name: "LEBELAGE Dr. HYALURONIC DERMA CREAM 50ml", cost_rub: 212.4, warehouse_expenses: 16.6 },
];

async function seed() {
  const { error } = await supabase
    .from("product_costs")
    .upsert(products, { onConflict: "article" });

  if (error) {
    console.error("Ошибка:", error);
  } else {
    console.log(`Загружено ${products.length} артикулов`);
  }
}

seed();
