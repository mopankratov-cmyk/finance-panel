# Автоматический импорт банковских выписок из Gmail

Письма читает Google Apps Script внутри Gmail. Панель не получает доступ к
почтовому ящику: скрипт передаёт только вложения `.xlsx` и `.pdf` в два
защищённых API-этапа панели. Результат попадает в очередь «На проверке»;
неизвестные компания, счёт или статья не проводятся автоматически.

## 1. Что настраивает владелец

1. В Gmail создать ярлыки:
   - `ДДС/Входящие`;
   - `ДДС/Обработано`;
   - `ДДС/Ошибка`.
2. Настроить в банках отправку выписок на этот Gmail. Для первых проверок
   письмам назначать `ДДС/Входящие` вручную; после проверки можно создать
   Gmail-фильтр по адресам отправителей банков.
3. Создать случайный секрет длиной не менее 32 символов.
4. В Vercel добавить `DDS_EMAIL_IMPORT_SECRET` с этим значением для Production.
5. После новой production-выкладки открыть
   [Google Apps Script](https://script.google.com/), создать проект
   `Импорт выписок ДДС` и вставить код из следующего раздела.

Секрет хранится только в Vercel и Script Properties. Его нельзя вставлять в
исходный код, письмо, название ярлыка или репозиторий.

## 2. Код Google Apps Script

```javascript
const PANEL_URL = 'https://finance-panel-two.vercel.app';
const INBOX_LABEL = 'ДДС/Входящие';
const DONE_LABEL = 'ДДС/Обработано';
const ERROR_LABEL = 'ДДС/Ошибка';
const MAX_FILE_BYTES = 20 * 1024 * 1024;

function importBankStatements() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;

  try {
    const secret = requiredProperty_('DDS_EMAIL_IMPORT_SECRET');
    const trustedSenders = requiredProperty_('TRUSTED_BANK_SENDERS')
      .split(',')
      .map(value => value.trim().toLowerCase())
      .filter(Boolean);
    const inbox = requiredLabel_(INBOX_LABEL);
    const done = getOrCreateLabel_(DONE_LABEL);
    const failed = getOrCreateLabel_(ERROR_LABEL);
    const threads = inbox.getThreads(0, 50);

    threads.forEach(thread => {
      const wasFailed = thread.getLabels().some(label => label.getName() === ERROR_LABEL);
      try {
        const messages = thread.getMessages();
        const supported = [];

        messages.forEach(message => {
          const attachments = message
            .getAttachments({ includeInlineImages: false, includeAttachments: true })
            .filter(attachment => /\.(xlsx|pdf)$/i.test(attachment.getName()));
          if (!attachments.length) return;
          const sender = senderAddress_(message.getFrom());
          if (!trustedSenders.includes(sender)) {
            throw new Error(`Отправитель не входит в список банков: ${sender || message.getFrom()}`);
          }
          attachments.forEach(attachment => {
              const name = attachment.getName();
              if (attachment.getBytes().length > MAX_FILE_BYTES) {
                throw new Error(`Файл больше 20 МБ: ${name}`);
              }
              supported.push(attachment);
            });
        });

        if (!supported.length) throw new Error('В письме нет выписки XLSX или PDF');
        supported.forEach(attachment => importAttachment_(attachment, secret));

        thread.addLabel(done);
        thread.removeLabel(inbox);
        thread.removeLabel(failed);
      } catch (error) {
        thread.addLabel(failed);
        if (!wasFailed) notifyError_(thread, error);
      }
    });
  } finally {
    lock.releaseLock();
  }
}

function importAttachment_(attachment, secret) {
  const parseResponse = UrlFetchApp.fetch(`${PANEL_URL}/api/opiu/bank-statement`, {
    method: 'post',
    headers: { Authorization: `Bearer ${secret}` },
    payload: { file: attachment.copyBlob().setName(attachment.getName()) },
    muteHttpExceptions: true,
  });
  const parsed = jsonResponse_(parseResponse, `Не удалось распознать ${attachment.getName()}`);

  const queueResponse = UrlFetchApp.fetch(`${PANEL_URL}/api/opiu/bank-review`, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: `Bearer ${secret}` },
    payload: JSON.stringify({
      action: 'batch',
      statement: parsed.statement,
      suggestions: parsed.suggestions,
      sourceFileName: attachment.getName(),
    }),
    muteHttpExceptions: true,
  });
  jsonResponse_(queueResponse, `Не удалось добавить ${attachment.getName()} в очередь`);
}

function jsonResponse_(response, prefix) {
  const code = response.getResponseCode();
  const text = response.getContentText();
  let body = null;
  try { body = JSON.parse(text); } catch (_) {}
  if (code < 200 || code >= 300) {
    throw new Error(`${prefix}: ${body && body.error ? body.error : `HTTP ${code}`}`);
  }
  return body || {};
}

function senderAddress_(from) {
  const bracket = String(from || '').match(/<([^>]+)>/);
  return (bracket ? bracket[1] : String(from || '')).trim().toLowerCase();
}

function requiredProperty_(name) {
  const value = PropertiesService.getScriptProperties().getProperty(name);
  if (!value) throw new Error(`Не задано свойство скрипта ${name}`);
  return value;
}

function requiredLabel_(name) {
  const label = GmailApp.getUserLabelByName(name);
  if (!label) throw new Error(`Создайте ярлык Gmail ${name}`);
  return label;
}

function getOrCreateLabel_(name) {
  return GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name);
}

function notifyError_(thread, error) {
  const recipient = PropertiesService.getScriptProperties().getProperty('ERROR_EMAIL');
  if (!recipient) return;
  const subject = thread.getFirstMessageSubject() || 'Письмо без темы';
  MailApp.sendEmail({
    to: recipient,
    subject: `Ошибка импорта выписки: ${subject}`,
    body: String(error && error.message ? error.message : error),
  });
}

function installTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(trigger => trigger.getHandlerFunction() === 'importBankStatements')
    .forEach(trigger => ScriptApp.deleteTrigger(trigger));
  ScriptApp.newTrigger('importBankStatements').timeBased().everyMinutes(5).create();
}
```

## 3. Свойства и первый запуск

В Apps Script открыть **Настройки проекта → Свойства скрипта** и создать:

| Свойство | Значение |
|---|---|
| `DDS_EMAIL_IMPORT_SECRET` | То же значение, что в Vercel |
| `TRUSTED_BANK_SENDERS` | Адреса банков через запятую |
| `ERROR_EMAIL` | Адрес для сообщений об ошибках; необязательно |

Затем:

1. Выбрать функцию `importBankStatements` и нажать **Выполнить**.
2. Разрешить скрипту читать Gmail, обращаться к внешнему API и, если указан
   `ERROR_EMAIL`, отправлять уведомления.
3. Проверить одну выписку вручную.
4. Выбрать `installTrigger` и выполнить один раз. После этого импорт запускается
   каждые пять минут.

## 4. Защита от дублей и ошибок

- Повтор того же файла отсекается по SHA-256 файла и id строки.
- Перекрывающиеся выписки сверяются по расчётному счёту, дате, сумме, номеру
  документа, счёту/ИНН и имени контрагента.
- Неизвестный расчётный счёт остаётся в очереди «На проверке» до присвоения
  компании и названия кошелька.
- Письмо получает `ДДС/Обработано` только после успешной записи всех подходящих
  вложений.
- При частичном сбое письмо будет обработано повторно. Уже принятые строки не
  продублируются, а ошибочные останутся с ярлыком `ДДС/Ошибка`.
- Отправитель обязан совпасть с одним из `TRUSTED_BANK_SENDERS`; одного похожего
  названия отправителя недостаточно.

## 5. Проверка перед постоянным включением

1. Отправить одну известную выписку и вручную назначить письму
   `ДДС/Входящие`.
2. Сверить число строк и суммы с файлом, проверить банк и кошелёк.
3. Вернуть письму входящий ярлык и убрать обработанный: новых строк быть не
   должно.
4. Отправить выписку с пересекающимся периодом: добавиться должны только новые
   операции.
5. Отправить выписку нового счёта: строки должны остаться «На проверке» до
   присвоения названия кошельку.
6. Создать Gmail-фильтры только для проверенных адресов банков.
