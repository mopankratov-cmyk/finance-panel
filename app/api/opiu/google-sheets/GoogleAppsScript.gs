/**
 * Синхронизация финансовой панели с СУЩЕСТВУЮЩИМИ шаблонами Google Таблиц.
 * Скрипт не создаёт упрощённые листы: он продолжает исходные ДДС и календарь,
 * копирует формулы/оформление предыдущей строки и защищает от дублей.
 */
function doPost(event) {
  var lock = null;
  try {
    var payload = JSON.parse((event && event.postData && event.postData.contents) || "{}");
    assertAuthorized(payload.secret);
    if (!payload.sheet || !Array.isArray(payload.rows) || payload.rows.length < 1) throw new Error("Нет строк для выгрузки");

    lock = LockService.getScriptLock();
    if (!lock.tryLock(30000)) throw new Error("Другая выгрузка ещё выполняется. Повторите попытку через минуту.");
    var book = SpreadsheetApp.openById(requiredProperty("FINANCE_SPREADSHEET_ID"));
    var result = payload.template === "loans"
      ? syncLoanRegister(book, payload.rows)
      : syncRegisterSheet(book, String(payload.sheet), payload.rows);
    SpreadsheetApp.flush();
    return jsonResponse({ ok: true, appended: result.appended, skipped: result.skipped, sheet: result.sheet, spreadsheetUrl: book.getUrl() });
  } catch (error) {
    return jsonResponse({ ok: false, error: String(error && error.message || error) });
  } finally {
    if (lock && lock.hasLock()) lock.releaseLock();
  }
}

function syncRegisterSheet(book, requestedName, rows) {
  var incomingHeader = rows[0].map(String);
  var sheet = findTargetSheet(book, requestedName);
  if (!sheet) throw new Error("В исходной книге не найден лист «" + requestedName + "». Лист не создан, чтобы не испортить структуру шаблона.");

  var headerInfo = findHeader(sheet, incomingHeader);
  if (!headerInfo) throw new Error("На листе «" + sheet.getName() + "» не найдена строка с нужными заголовками");
  var sheetHeader = headerInfo.values;
  var headerRow = headerInfo.row;
  var dataStart = headerRow + 1;
  var formulaColumns = formulaColumnsFor(sheet.getName());
  var keyNames = keyColumnsFor(sheet.getName());
  var incomingIndex = indexByName(incomingHeader);
  var sheetIndex = indexByName(sheetHeader);
  var lastDataRow = lastRowByKey(sheet, dataStart, sheetIndex[keyNames[0]] + 1);

  var known = {};
  if (lastDataRow >= dataStart) {
    var existing = sheet.getRange(dataStart, 1, lastDataRow - dataStart + 1, sheetHeader.length).getValues();
    existing.forEach(function(row, index) {
      var key = makeKey(row, sheetIndex, keyNames);
      if (key) known[key] = dataStart + index;
    });
  }

  var appended = 0;
  var skipped = 0;
  rows.slice(1).forEach(function(incoming) {
    var candidate = sheetHeader.map(function(name) {
      var index = incomingIndex[name];
      return index == null ? "" : coerceCellValue(name, incoming[index]);
    });
    var key = makeKey(candidate, sheetIndex, keyNames);
    if (!key) { skipped++; return; }
    if (known[key]) {
      // Повторная выгрузка также восстанавливает строку, если предыдущий запуск
      // оборвался после записи ключа, но до заполнения остальных колонок.
      writeRegisterRow(sheet, known[key], candidate, sheetHeader, sheetIndex, formulaColumns, keyNames);
      skipped++;
      return;
    }
    var targetRow = Math.max(dataStart, lastDataRow + 1);
    prepareTemplateRow(sheet, targetRow, dataStart, lastDataRow, sheetHeader.length);
    writeRegisterRow(sheet, targetRow, candidate, sheetHeader, sheetIndex, formulaColumns, keyNames);
    known[key] = targetRow;
    lastDataRow = targetRow;
    appended++;
  });
  formatRegister(sheet, headerRow, sheetHeader);
  return { appended: appended, skipped: skipped, sheet: sheet.getName() };
}

function writeRegisterRow(sheet, targetRow, candidate, sheetHeader, sheetIndex, formulaColumns, keyNames) {
  var keyColumnIndexes = keyNames.map(function(name) { return sheetIndex[name]; });
  var ordinaryColumns = [];
  var keyColumns = [];
  sheetHeader.forEach(function(name, columnIndex) {
    if (formulaColumns.indexOf(name) >= 0) return;
    if (keyColumnIndexes.indexOf(columnIndex) >= 0) keyColumns.push(columnIndex);
    else ordinaryColumns.push(columnIndex);
  });
  // Ключевые поля пишутся последними. Если выполнение оборвётся раньше,
  // повторный запуск переиспользует эту же незавершённую строку.
  ordinaryColumns.concat(keyColumns.slice().reverse()).forEach(function(columnIndex) {
    sheet.getRange(targetRow, columnIndex + 1).setValue(candidate[columnIndex]);
  });
  if (keyColumns.length) {
    sheet.getRange(targetRow, keyColumns[0] + 1).setNote("FINANCE_SYNC_COMPLETE");
  }
}

function findTargetSheet(book, requestedName) {
  var exact = book.getSheetByName(requestedName);
  if (exact) return exact;
  var aliases = {
    "План выбытий": ["План выбытий РИО", "План выбытий группы"],
    "ДДС месяц": ["ДДС_ месяц", "ДДС месяц"],
    "Учёт кредитов займов от сторонн": ["Учёт кредитов займов от сторонн", "Учет кредитов займов от сторонн"]
  };
  var names = aliases[requestedName] || [];
  for (var index = 0; index < names.length; index++) {
    var sheet = book.getSheetByName(names[index]);
    if (sheet) return sheet;
  }
  return null;
}

function findHeader(sheet, incomingHeader) {
  var scanRows = Math.min(12, Math.max(1, sheet.getLastRow()));
  var scanColumns = Math.max(incomingHeader.length, Math.min(40, sheet.getLastColumn()));
  var values = sheet.getRange(1, 1, scanRows, scanColumns).getDisplayValues();
  var required = incomingHeader.filter(function(name) { return name && formulaColumnsFor(sheet.getName()).indexOf(name) < 0; });
  for (var row = 0; row < values.length; row++) {
    var normalized = values[row].map(function(value) { return String(value).trim(); });
    var matches = required.filter(function(name) { return normalized.indexOf(name) >= 0; }).length;
    if (matches >= Math.min(4, required.length)) return { row: row + 1, values: normalized.slice(0, lastNamedColumn(normalized)) };
  }
  return null;
}

function prepareTemplateRow(sheet, targetRow, dataStart, lastDataRow, width) {
  var sourceRow = lastDataRow >= dataStart ? lastDataRow : dataStart;
  if (targetRow > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), targetRow - sheet.getMaxRows());
  if (sourceRow <= sheet.getMaxRows() && sourceRow !== targetRow) {
    sheet.getRange(sourceRow, 1, 1, width).copyTo(sheet.getRange(targetRow, 1, 1, width), SpreadsheetApp.CopyPasteType.PASTE_NORMAL, false);
    sheet.setRowHeight(targetRow, sheet.getRowHeight(sourceRow));
  }
}

function coerceCellValue(headerName, value) {
  if (value == null || value === "") return "";
  if (/дата/i.test(String(headerName)) && typeof value === "string") {
    var match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12);
    var ru = value.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})/);
    if (ru) return new Date(Number(ru[3]), Number(ru[2]) - 1, Number(ru[1]), 12);
  }
  return safeSpreadsheetValue(value);
}

function safeSpreadsheetValue(value) {
  if (typeof value !== "string") return value;
  return /^[=+\-@\t\r]/.test(value) ? "'" + value : value;
}

function formulaColumnsFor(sheetName) {
  if (/ДДС.*месяц/i.test(sheetName)) return ["Месяц", "Мсц (цифрой)", "Платеж/поступл", "Вид д-ти"];
  if (sheetName === "Плановый Реестр поступлений") return ["Год план", "Месяц план", "Номер недели план"];
  if (sheetName.indexOf("План выбытий") === 0) return ["Номер недели", "Начало недели", "Конец недели", "Год план", "Месяц план"];
  if (sheetName === "Факт ДДС") return ["Год", "Месяц", "День недели", "Платеж/поступл"];
  return [];
}

function keyColumnsFor(sheetName) {
  if (/ДДС.*месяц/i.test(sheetName)) return ["Дата", "Сумма", "Кошелек", "Контрагент", "Назначение платежа"];
  if (sheetName === "Плановый Реестр поступлений") return ["Дата планируемого получения", "Сумма план", "Контрагент", "Статья поступлений"];
  if (sheetName.indexOf("План выбытий") === 0) return ["Дата планируемой оплаты", "Сумма план", "Статья", "Контрагент", "Комментарий"];
  if (sheetName === "Факт ДДС") return ["Дата", "Сумма", "Контрагент", "Назначение платежа", "Статья"];
  return [];
}

function syncLoanRegister(book, rows) {
  var sheet = findTargetSheet(book, "Учёт кредитов займов от сторонн");
  if (!sheet) throw new Error("Не найден исходный лист учёта кредитов и займов");
  var header = rows[0].map(String);
  var index = indexByName(header);
  var grouped = {};
  rows.slice(1).forEach(function(row) {
    var key = [row[index["Компания"]], row[index["Кредитор"]], row[index["Договор"]]].join("|");
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(row);
  });
  var appended = 0;
  var skipped = 0;
  Object.keys(grouped).forEach(function(key) {
    var parts = key.split("|");
    var creditor = parts[1] || "Кредит без названия";
    var contract = parts[2] || "";
    if (loanBlockExists(sheet, creditor, contract)) { skipped += grouped[key].length; return; }
    var templateStart = findLoanTemplateBlock(sheet);
    if (!templateStart) throw new Error("На листе кредитов не найден оформленный блок-шаблон из 9 строк");
    var start = Math.max(9, sheet.getLastRow() + 2);
    if (start + 8 > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), start + 8 - sheet.getMaxRows());
    copyLoanTemplateBlock(sheet, templateStart, start);
    var first = grouped[key].slice().sort(function(a, b) { return String(a[index["Дата платежа"]]).localeCompare(String(b[index["Дата платежа"]])); })[0];
    sheet.getRange(start, 1, 9, 2).setValues([
      ["Дата получения", creditor],
      [String(first[index["Дата платежа"]] || ""), "Остаток на начало"],
      [parts[0] || "", "Выплата тела кредита"],
      [contract, "Остаток на конец"],
      ["", ""],
      ["", "Начислено процентов"],
      ["", "Задолженность прошлого месяца"],
      ["", "Выплачено процентов"],
      ["", "Осталось выплатить %"]
    ]);
    var monthMap = loanMonthColumns(sheet);
    var schedule = grouped[key];
    var byMonth = {};
    schedule.forEach(function(row) {
      var month = String(row[index["Дата платежа"]] || "").slice(0, 7);
      if (!byMonth[month]) byMonth[month] = { principal: 0, interest: 0, paidInterest: 0 };
      byMonth[month].principal += Number(row[index["Тело"]]) || 0;
      byMonth[month].interest += Number(row[index["Проценты"]]) || 0;
      if (String(row[index["Статус"]]) === "Оплачено") byMonth[month].paidInterest += Number(row[index["Проценты"]]) || 0;
    });
    var firstBalance = (Number(first[index["Остаток тела"]]) || 0) + (Number(first[index["Тело"]]) || 0);
    var balance = firstBalance;
    Object.keys(monthMap).sort().forEach(function(month) {
      var column = monthMap[month];
      var item = byMonth[month] || { principal: 0, interest: 0, paidInterest: 0 };
      sheet.getRange(start + 1, column).setValue(balance);
      sheet.getRange(start + 2, column).setValue(item.principal ? -item.principal : 0);
      balance = Math.max(0, balance - item.principal);
      sheet.getRange(start + 3, column).setFormulaR1C1("=R[-2]C+R[-1]C");
      sheet.getRange(start + 5, column).setValue(item.interest);
      sheet.getRange(start + 7, column).setValue(item.paidInterest ? -item.paidInterest : 0);
      sheet.getRange(start + 8, column).setFormulaR1C1("=R[-3]C+R[-2]C+R[-1]C");
    });
    extendLoanSummary(sheet, start);
    appended += grouped[key].length;
  });
  return { appended: appended, skipped: skipped, sheet: sheet.getName() };
}

function loanBlockExists(sheet, creditor, contract) {
  var matches = sheet.createTextFinder(creditor).matchEntireCell(true).findAll();
  for (var index = 0; index < matches.length; index++) {
    var start = matches[index].getRow();
    if (!contract || String(sheet.getRange(start + 3, 1).getDisplayValue()).trim() === contract) return true;
  }
  return false;
}

function findLoanTemplateBlock(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 17) return 0;
  var labels = sheet.getRange(9, 2, lastRow - 8, 1).getDisplayValues();
  for (var index = 0; index <= labels.length - 9; index++) {
    if (/остаток на начало/i.test(labels[index + 1][0]) &&
        /выплата тела/i.test(labels[index + 2][0]) &&
        /остаток на конец/i.test(labels[index + 3][0]) &&
        /начислено процентов/i.test(labels[index + 5][0]) &&
        /выплачено процентов/i.test(labels[index + 7][0])) return index + 9;
  }
  return 0;
}

function copyLoanTemplateBlock(sheet, sourceStart, targetStart) {
  var width = sheet.getLastColumn();
  sheet.getRange(sourceStart, 1, 9, width).copyTo(
    sheet.getRange(targetStart, 1, 9, width),
    SpreadsheetApp.CopyPasteType.PASTE_NORMAL,
    false
  );
  for (var offset = 0; offset < 9; offset++) {
    sheet.setRowHeight(targetStart + offset, sheet.getRowHeight(sourceStart + offset));
  }
  if (width >= 3) {
    [1, 2, 5, 7].forEach(function(offset) {
      sheet.getRange(targetStart + offset, 3, 1, width - 2).clearContent();
    });
  }
}

function extendLoanSummary(sheet, blockStart) {
  var rowPairs = [[2, blockStart + 5], [3, blockStart + 7], [4, blockStart + 2], [5, blockStart + 8], [6, blockStart + 3]];
  for (var column = 3; column <= sheet.getLastColumn(); column++) {
    rowPairs.forEach(function(pair) {
      var summary = sheet.getRange(pair[0], column);
      var formula = summary.getFormula();
      if (!formula) return;
      var reference = sheet.getRange(pair[1], column).getA1Notation();
      if (formula.indexOf(reference) < 0) summary.setFormula(formula + "+" + reference);
    });
  }
}

function loanMonthColumns(sheet) {
  var result = {};
  var lastColumn = sheet.getLastColumn();
  if (lastColumn < 3) return result;
  var years = sheet.getRange(7, 3, 1, lastColumn - 2).getDisplayValues()[0];
  var months = sheet.getRange(8, 3, 1, lastColumn - 2).getDisplayValues()[0];
  var currentYear = "";
  for (var index = 0; index < months.length; index++) {
    if (/^\d{4}$/.test(String(years[index]).trim())) currentYear = String(years[index]).trim();
    var month = Number(months[index]);
    if (currentYear && month >= 1 && month <= 12) result[currentYear + "-" + String(month).padStart(2, "0")] = index + 3;
  }
  return result;
}

function lastRowByKey(sheet, dataStart, keyColumn) {
  if (!keyColumn || sheet.getLastRow() < dataStart) return dataStart - 1;
  var values = sheet.getRange(dataStart, keyColumn, sheet.getLastRow() - dataStart + 1, 1).getDisplayValues();
  for (var index = values.length - 1; index >= 0; index--) if (String(values[index][0]).trim()) return dataStart + index;
  return dataStart - 1;
}

function makeKey(row, indexes, names) {
  return names.map(function(name) {
    var index = indexes[name];
    return index == null ? "" : normalizeKeyPart(row[index], name);
  }).join("|");
}

function indexByName(header) {
  var result = {};
  header.forEach(function(name, index) { if (name) result[String(name).trim()] = index; });
  return result;
}

function lastNamedColumn(header) {
  for (var index = header.length - 1; index >= 0; index--) if (header[index]) return index + 1;
  return header.length;
}

function normalizeKeyPart(value, headerName) {
  if (value instanceof Date) return Utilities.formatDate(value, Session.getScriptTimeZone(), "yyyy-MM-dd");
  if (/дата/i.test(String(headerName))) {
    var text = String(value == null ? "" : value).trim();
    var iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return iso[1] + "-" + iso[2] + "-" + iso[3];
    var ru = text.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})/);
    if (ru) return ru[3] + "-" + String(ru[2]).padStart(2, "0") + "-" + String(ru[1]).padStart(2, "0");
  }
  return String(value == null ? "" : value).toLowerCase().replace(/\s+/g, " ").trim();
}

function formatRegister(sheet, headerRow, header) {
  // Оформление, закрепления и ширины уже заданы исходным шаблоном.
  // Здесь их намеренно не меняем.
}

function requiredProperty(name) {
  var value = PropertiesService.getScriptProperties().getProperty(name);
  if (!value) throw new Error("Не задано свойство " + name);
  return value;
}

function assertAuthorized(secret) {
  if (secret !== requiredProperty("FINANCE_SYNC_SECRET")) throw new Error("Unauthorized");
}

function jsonResponse(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}
