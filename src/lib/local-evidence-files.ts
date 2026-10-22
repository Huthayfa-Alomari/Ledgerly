export type LocalEvidenceFileMetadata = {
  id: string;
  fileName: string;
  fileType: string;
  fileSize: number;
};

type StoredEvidenceFile = LocalEvidenceFileMetadata & {
  blob: Blob;
  storedAt: string;
};

const DATABASE_NAME = 'ledgerly-local-evidence-vault-v1';
const STORE_NAME = 'evidence-files';
const MAX_FILE_BYTES = 25 * 1024 * 1024;

function openVault(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('التخزين المحلي للمرفقات غير متاح في هذا المتصفح.'));
      return;
    }

    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('تعذر فتح مخزن المرفقات المحلي.'));
    request.onblocked = () => reject(new Error('أغلق علامات Ledgerly الأخرى ثم أعد المحاولة.'));
  });
}

function createId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `evidence-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function saveLocalEvidenceFile(file: File): Promise<LocalEvidenceFileMetadata> {
  if (!file || typeof file.size !== 'number' || typeof file.name !== 'string') {
    throw new Error('اختر ملفًا صالحًا للإرفاق.');
  }
  if (file.size <= 0) throw new Error('الملف فارغ.');
  if (file.size > MAX_FILE_BYTES) throw new Error('حجم المرفق يتجاوز الحد المحلي البالغ 25 ميغابايت.');

  const metadata: LocalEvidenceFileMetadata = {
    id: createId(),
    fileName: file.name,
    fileType: file.type || 'application/octet-stream',
    fileSize: file.size,
  };
  const database = await openVault();

  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).put({
        ...metadata,
        blob: file,
        storedAt: new Date().toISOString(),
      } satisfies StoredEvidenceFile);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(new Error('تعذر حفظ الملف؛ قد تكون مساحة المتصفح ممتلئة.'));
      transaction.onabort = () => reject(new Error('أُلغيت عملية حفظ الملف؛ تحقق من مساحة التخزين.'));
    });
  } finally {
    database.close();
  }

  return metadata;
}

export async function getLocalEvidenceFile(id: string): Promise<(LocalEvidenceFileMetadata & { blob: Blob }) | null> {
  const database = await openVault();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readonly');
      const request = transaction.objectStore(STORE_NAME).get(id);
      request.onsuccess = () => {
        const value = request.result as StoredEvidenceFile | undefined;
        resolve(value ? { id: value.id, fileName: value.fileName, fileType: value.fileType, fileSize: value.fileSize, blob: value.blob } : null);
      };
      request.onerror = () => reject(new Error('تعذر قراءة المرفق من مخزن المتصفح.'));
    });
  } finally {
    database.close();
  }
}

export async function deleteLocalEvidenceFile(id: string): Promise<void> {
  const database = await openVault();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).delete(id);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(new Error('تعذر حذف الملف من مخزن المرفقات.'));
      transaction.onabort = () => reject(new Error('أُلغيت عملية حذف المرفق.'));
    });
  } finally {
    database.close();
  }
}
