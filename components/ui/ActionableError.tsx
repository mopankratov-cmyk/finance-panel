import { AlertTriangle, RefreshCw } from "lucide-react";

type ErrorTone = "rose" | "amber";

interface ActionableErrorCopy {
  title: string;
  detail: string;
  action?: string;
}

function normalizeErrorMessage(message: string) {
  return message.replace(/\s+/g, " ").trim();
}

function technicalHint(message: string) {
  const normalized = normalizeErrorMessage(message);
  if (!normalized) return "";
  if (/^<!doctype html|<html\b|vercel security check/i.test(normalized)) return "";
  return normalized.length > 180 ? `${normalized.slice(0, 180)}…` : normalized;
}

export function humanizeApiError(message: string | null | undefined, label = "Данные"): ActionableErrorCopy {
  const normalized = normalizeErrorMessage(message || "");
  const lower = normalized.toLocaleLowerCase("ru-RU");

  if (/access token withdrawn|unauthorized|wb 401|http 401|401\b|токен/i.test(normalized)) {
    const isWildberries = /(^|[^a-z])wb([^a-z]|$)|wildberries|вайлдбер/i.test(normalized) || /(^|[^a-z])wb([^a-z]|$)|wildberries|вайлдбер/i.test(label);
    const provider = isWildberries ? "Wildberries" : /ozon|озон/i.test(`${normalized} ${label}`) ? "Ozon" : "API";
    return {
      title: isWildberries ? "Токен WB не работает" : "Токен API не работает",
      detail: `${provider} вернул 401: токен отозван, устарел или не имеет нужного доступа.`,
      action: "Обновите токен кабинета в настройках и запустите синхронизацию ещё раз.",
    };
  }

  // 403 — это «не положено», а не «сломалось». Совет проверить интеграцию и
  // свежесть синхронизации отправляет человека чинить исправное: он будет
  // дёргать токен и пересобирать данные, пока настоящая причина — роль или
  // чужой кабинет. Ровно так выглядел отказ у внешнего селлера на вкладке
  // «Конкуренты»: экран сказал «WB не загрузились», хотя сервер ответил
  // «этой роли сюда нельзя».
  if (/\b403\b|forbidden|нет доступа|доступна только|доступен только|доступны модул|доступен модул/i.test(normalized)) {
    return {
      title: "Отказано по правам, а не по поломке",
      detail: normalized || "Сервер отказал по правам доступа.",
      action: "Данные на месте, не хватает прав. Проверьте, тот ли кабинет выбран, и попросите владельца панели открыть этот раздел вашей роли.",
    };
  }

  // 429 — это «слишком часто», а не «сломалось». Совет проверять интеграцию тут
  // вреден: он отправляет человека чинить исправное.
  if (/\b429\b|rate limit|too many requests|слишком много запросов/i.test(normalized)) {
    const provider = /ozon|озон/i.test(`${normalized} ${label}`)
      ? "Ozon"
      : /(^|[^a-z])wb([^a-z]|$)|wildberries|вайлдбер/i.test(`${normalized} ${label}`) ? "Wildberries" : "Маркетплейс";
    return {
      title: `${provider} ограничил частоту запросов`,
      detail: `Обращений подряд оказалось больше, чем разрешено, и ${provider} ответил отказом.`,
      action: "Подождите минуту и повторите. Токен и настройки интеграции здесь ни при чём.",
    };
  }

  if (/vercel security check|deployment protection/i.test(normalized)) {
    return {
      title: "Vercel отдал страницу защиты вместо данных",
      detail: "Запрос попал не в JSON API, а в защитную HTML-страницу платформы.",
      action: "Обновите вкладку. Если повторяется на проде — проверьте protection/cron/proxy для API-роутов.",
    };
  }

  if (/не json|html-страниц|html вместо json|unexpected token|^<!doctype html|<html\b/i.test(normalized)) {
    return {
      title: "API вернул HTML вместо JSON",
      detail: "Обычно это редирект, защита платформы или устаревшая вкладка после деплоя.",
      action: "Обновите страницу и повторите запрос; если не помогло — проверьте API-роут и домен продакшена.",
    };
  }

  if (/timeout|timed out|не завершился|65 секунд|aborted/i.test(lower)) {
    return {
      title: "Источник не успел ответить",
      detail: "Расчёт или внешний API занял слишком много времени.",
      action: "Повторите запрос. Если повторяется — нужно смотреть свежесть синхронизации и размер периода.",
    };
  }

  if (/failed to fetch|network|fetch failed|сеть/i.test(lower)) {
    return {
      title: "Не удалось обратиться к API",
      detail: "Браузер не получил ответ от сервера или запрос был оборван.",
      action: "Проверьте соединение, обновите страницу и повторите действие.",
    };
  }

  return {
    title: `${label} не загрузились`,
    detail: normalized || "Сервер вернул ошибку без подробностей.",
    action: "Повторите запрос. Если ошибка повторяется — нужно проверить интеграцию и свежесть синхронизации.",
  };
}

export function ActionableError({
  message,
  title,
  label = "Данные",
  onRetry,
  retryLabel = "Повторить",
  compact = false,
  tone = "rose",
  className = "",
}: {
  message: string | null | undefined;
  title?: string;
  label?: string;
  onRetry?: () => void;
  retryLabel?: string;
  compact?: boolean;
  tone?: ErrorTone;
  className?: string;
}) {
  const copy = humanizeApiError(message, label);
  const hint = technicalHint(message || "");
  const styles = tone === "amber"
    ? {
        outer: "border-amber-200 bg-amber-50 text-amber-950",
        icon: "text-amber-600",
        button: "border-amber-200 bg-white text-amber-800 hover:bg-amber-100",
        hint: "text-amber-800/70",
      }
    : {
        outer: "border-rose-200 bg-rose-50 text-rose-950",
        icon: "text-rose-600",
        button: "border-rose-200 bg-white text-rose-700 hover:bg-rose-100",
        hint: "text-rose-800/70",
      };

  return (
    <div role="alert" className={`rounded-xl border ${styles.outer} ${compact ? "px-3 py-2 text-xs" : "px-4 py-3 text-sm"} ${className}`}>
      <div className="flex items-start gap-2">
        <AlertTriangle className={`mt-0.5 h-4 w-4 shrink-0 ${styles.icon}`} />
        <div className="min-w-0 flex-1">
          <div className="font-semibold">{title || copy.title}</div>
          <div className={`${compact ? "mt-0.5 text-[11px]" : "mt-1 text-xs"} leading-5 opacity-80`}>{copy.detail}</div>
          {copy.action ? <div className={`${compact ? "mt-1 text-[11px]" : "mt-1 text-xs"} font-medium leading-5`}>{copy.action}</div> : null}
          {hint && hint !== copy.detail ? <div className={`mt-1 truncate text-[10px] ${styles.hint}`} title={hint}>Технически: {hint}</div> : null}
        </div>
        {onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className={`inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-lg border px-3 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ${styles.button}`}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            {retryLabel}
          </button>
        ) : null}
      </div>
    </div>
  );
}
