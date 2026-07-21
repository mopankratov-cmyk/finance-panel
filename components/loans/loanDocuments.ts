const DB_NAME = "finance-panel-loan-documents";
const STORE_NAME = "documents";

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

export async function saveLoanDocument(loanId: string, file: File) {
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

export async function openLoanDocument(loanId: string) {
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
