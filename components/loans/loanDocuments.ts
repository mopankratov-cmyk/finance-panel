const DB_NAME = "finance-panel-loan-documents";
const STORE_NAME = "documents";
const API_PATH = "/api/opiu/loan-documents";

interface StoredLoanDocument {
  loanId: string;
  name: string;
  type: string;
  blob: Blob;
  savedAt: string;
}

function openDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: "loanId" });
      }
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

async function saveLocalLoanDocument(loanId: string, file: File) {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put({
      loanId,
      name: file.name,
      type: file.type || "application/octet-stream",
      blob: file,
      savedAt: new Date().toISOString(),
    } satisfies StoredLoanDocument);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  db.close();
}

async function openLocalLoanDocument(loanId: string) {
  const db = await openDb();
  const document = await new Promise<StoredLoanDocument | undefined>((resolve, reject) => {
    const request = db.transaction(STORE_NAME).objectStore(STORE_NAME).get(loanId);
    request.onsuccess = () => resolve(request.result as StoredLoanDocument | undefined);
    request.onerror = () => reject(request.error);
  });
  db.close();
  if (!document) return false;
  const url = URL.createObjectURL(document.blob);
  window.open(url, "_blank", "noopener,noreferrer");
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return true;
}

async function deleteLocalLoanDocument(loanId: string) {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).delete(loanId);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  db.close();
}

async function apiError(response: Response, fallback: string) {
  const body = await response.json().catch(() => null) as { error?: string } | null;
  return new Error(body?.error || fallback);
}

export async function saveLoanDocument(loanId: string, file: File, companyId?: string) {
  const form = new FormData();
  form.set("loanId", loanId);
  form.set("documentKind", "contract");
  if (companyId) form.set("companyId", companyId);
  form.set("file", file);
  try {
    const response = await fetch(API_PATH, { method: "POST", body: form });
    if (!response.ok) throw await apiError(response, "Не удалось сохранить исходный файл");
  } catch (error) {
    if (process.env.NODE_ENV !== "development") throw error;
    await saveLocalLoanDocument(loanId, file);
    console.warn("Серверное хранилище недоступно, документ сохранён только локально для разработки", error);
  }
}

export async function openLoanDocument(loanId: string) {
  try {
    const response = await fetch(`${API_PATH}?loanId=${encodeURIComponent(loanId)}`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (response.status === 404) {
      return process.env.NODE_ENV === "development" ? openLocalLoanDocument(loanId) : false;
    }
    if (!response.ok) throw await apiError(response, "Не удалось открыть исходный файл");
    const body = await response.json() as { url?: string };
    if (!body.url) throw new Error("Сервер не вернул ссылку на документ");
    window.open(body.url, "_blank", "noopener,noreferrer");
    return true;
  } catch (error) {
    if (process.env.NODE_ENV !== "development") throw error;
    return openLocalLoanDocument(loanId);
  }
}

export async function deleteLoanDocument(loanId: string) {
  try {
    const response = await fetch(API_PATH, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ loanId }),
    });
    if (!response.ok) throw await apiError(response, "Не удалось удалить исходный файл");
  } catch (error) {
    if (process.env.NODE_ENV !== "development") throw error;
    await deleteLocalLoanDocument(loanId);
    console.warn("Серверное хранилище недоступно, локальная копия удалена только в development", error);
  }
}
