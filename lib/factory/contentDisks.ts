// Реестр реального контента на Яндекс.Дисках (съёмки моделей с нашими товарами).
// Завод тянет отсюда настоящие фото/видео и предпочитает их кропу с карточки WB.
// Ключ = публичная ссылка на расшаренную папку.

export interface ContentDisk { id: string; key: string; label: string }

export const CONTENT_DISKS: ContentDisk[] = [
  { id: "norvia", key: "https://disk.yandex.ru/d/wrlUYpWVjgWBww", label: "NORVIA — куртки/ветровки (съёмка 15.01.26)" },
  { id: "design", key: "https://disk.yandex.ru/d/12-84kRP_PMbzg", label: "Дизайн — модель МАША (товары в руках)" },
];

export function diskById(id: string): ContentDisk | undefined {
  return CONTENT_DISKS.find((d) => d.id === id);
}

// Источник реального контента по ГРУППЕ/товару: каждая запись — где лежит съёмка.
// match — по названию/артикулу товара. paths — папки внутри диска (рекурсивно собираем фото).
export interface GroupSource { match: RegExp; disk: string; paths: string[]; note: string }

export const GROUP_SOURCES: GroupSource[] = [
  { match: /норви|norvia|куртк|ветровк|пухов|\bNV|\bHT/i, disk: "norvia", paths: ["/"], note: "Модель в куртках/ветровках NORVIA, студия" },
  { match: /сумк|cl[eé]rin|\bbag/i, disk: "design", paths: ["/МАША/Сумки"], note: "Модель с сумками" },
  { match: /бластер|во[дs]ный|узи|винтовк|water|пистолет|tim ?tin/i, disk: "design", paths: ["/МАША/Винтовка белая", "/МАША/Винтовка песочная", "/МАША/УЗИ зеленый", "/МАША/УЗИ черный"], note: "Модель с водными бластерами (УЗИ/Винтовка)" },
  { match: /крем|молочк|yoyo|санскрин|\bspf|солнцезащ/i, disk: "design", paths: ["/МАША/Крем-молочко YOYO"], note: "Модель с кремом YOYO" },
];

// Файлы-«мусор», которые не годятся как кадр для рендера (лого/обложки/служебные).
export const SKIP_FILE = /бренд|логотип|\blogo|\blого|cover|обложк|\.ds_store|screenshot|\bicon/i;

// Подобрать источник реального контента под товар (имя + артикул).
export function sourceFor(productName: string, article = ""): { disk: ContentDisk; paths: string[]; note: string } | null {
  const hay = `${productName} ${article}`;
  for (const s of GROUP_SOURCES) {
    if (s.match.test(hay)) {
      const d = diskById(s.disk);
      if (d) return { disk: d, paths: s.paths, note: s.note };
    }
  }
  return null;
}
