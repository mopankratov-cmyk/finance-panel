/**
 * Ключ — собственное свойство объекта. Оператор `in` видит и унаследованные: «constructor», «toString», «__proto__» проходили бы
 * проверку «известная причина / вид / статус», ложились в базу и ломали сводку (у функции нет .toLowerCase()).
 */
export const hasOwnKey = (object: object, key: string): boolean => Object.prototype.hasOwnProperty.call(object, key);
