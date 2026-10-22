export type LocalEvidenceFileMetadata = {
  id: string;
  fileName: string;
  fileType: string;
  fileSize: number;
};

type EncryptedStoredEvidenceFile = LocalEvidenceFileMetadata & {
  encrypted: true;
  salt: number[];
  iv: number[];
  ciphertext: ArrayBuffer;
  storedAt: string;
};
type LegacyStoredEvidenceFile = LocalEvidenceFileMetadata & {
  blob: Blob;
  storedAt: string;
  encrypted?: false;
};
type StoredEvidenceFile = EncryptedStoredEvidenceFile | LegacyStoredEvidenceFile;

const DATABASE_NAME = 'ledgerly-local-evidence-vault-v1';
const STORE_NAME = 'evidence-files';
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const PBKDF2_ITERATIONS = 310_000;
const encoder = new TextEncoder();

function openVault(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('التخزين المحلي للمرفقات غير متاح في هذه البيئة.'));
      return;
    }
    const request = indexedDB.open(DATABASE_NAME, 2);
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

function requireSubtle(): SubtleCrypto {
  if (typeof crypto === 'undefined' || !crypto.subtle || typeof crypto.getRandomValues !== 'function') {
    throw new Error('تشفير المرفقات غير متاح في هذه البيئة.');
  }
  return crypto.subtle;
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  if (passphrase.length < 12) throw new Error('كلمة مرور المخزن المحلي يجب ألا تقل عن 12 حرفًا.');
  const subtle = requireSubtle();
  const passwordKey = await subtle.importKey('raw', encoder.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    passwordKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function encryptBlob(passphrase: string, blob: Blob): Promise<{ salt: number[]; iv: number[]; ciphertext: ArrayBuffer }> {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = await deriveKey(passphrase, salt);
  const ciphertext = await requireSubtle().encrypt({ name: 'AES-GCM', iv }, key, await blob.arrayBuffer());
  return { salt: Array.from(salt), iv: Array.from(iv), ciphertext };
}

async function decryptBlob(passphrase: string, row: EncryptedStoredEvidenceFile): Promise<Blob> {
  try {
    const key = await deriveKey(passphrase, new Uint8Array(row.salt));
    const bytes = await requireSubtle().decrypt({ name: 'AES-GCM', iv: new Uint8Array(row.iv) }, key, row.ciphertext);
    return new Blob([bytes], { type: row.fileType || 'application/octet-stream' });
  } catch {
    throw new Error('تعذر فك تشفير المرفق. تحقق من كلمة مرور المخزن المحلي وسلامة الملف.');
  }
}

function createId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : 'evidence-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

async function getStoredRows(): Promise<StoredEvidenceFile[]> {
  const database = await openVault();
  try {
    return await new Promise((resolve, reject) => {
      const request = database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll();
      request.onsuccess = () => resolve((request.result as StoredEvidenceFile[]) || []);
      request.onerror = () => reject(new Error('تعذر فهرسة المرفقات المحلية.'));
    });
  } finally { database.close(); }
}

async function storeRow(row: StoredEvidenceFile): Promise<void> {
  const database = await openVault();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).put(row);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(new Error('تعذر حفظ المرفق المشفّر؛ قد تكون مساحة التخزين ممتلئة.'));
      transaction.onabort = () => reject(new Error('أُلغيت عملية حفظ المرفق المشفّر.'));
    });
  } finally { database.close(); }
}

async function encryptLegacyRow(row: LegacyStoredEvidenceFile, passphrase: string): Promise<EncryptedStoredEvidenceFile> {
  const encrypted = await encryptBlob(passphrase, row.blob);
  return {
    id: row.id, fileName: row.fileName, fileType: row.fileType, fileSize: row.fileSize,
    encrypted: true, ...encrypted, storedAt: row.storedAt || new Date().toISOString(),
  };
}

/** Store every new evidence attachment as AES-GCM ciphertext in IndexedDB. */
export async function saveLocalEvidenceFile(file: File, passphrase: string): Promise<LocalEvidenceFileMetadata> {
  if (!file || typeof file.size !== 'number' || typeof file.name !== 'string') {
    throw new Error('اختر ملفًا صالحًا للإرفاق.');
  }
  if (file.size <= 0) throw new Error('الملف فارغ.');
  if (file.size > MAX_FILE_BYTES) throw new Error('حجم المرفق يتجاوز الحد المحلي البالغ 25 ميغابايت.');
  if (passphrase.length < 12) throw new Error('افتح المخزن المشفّر بكلمة مرور صالحة قبل إرفاق الأدلة.');

  const metadata: LocalEvidenceFileMetadata = {
    id: createId(), fileName: file.name, fileType: file.type || 'application/octet-stream', fileSize: file.size,
  };
  const encrypted = await encryptBlob(passphrase, file);
  await storeRow({ ...metadata, encrypted: true, ...encrypted, storedAt: new Date().toISOString() });
  return metadata;
}

export async function getLocalEvidenceFile(id: string, passphrase: string): Promise<(LocalEvidenceFileMetadata & { blob: Blob }) | null> {
  const rows = await getStoredRows();
  const row = rows.find(item => item.id === id);
  if (!row) return null;

  let blob: Blob;
  if ('encrypted' in row && row.encrypted === true) {
    blob = await decryptBlob(passphrase, row);
  } else {
    blob = row.blob;
    // Migrate old plaintext records on first authenticated read.
    const encrypted = await encryptLegacyRow(row as LegacyStoredEvidenceFile, passphrase);
    await storeRow(encrypted);
  }
  return { id: row.id, fileName: row.fileName, fileType: row.fileType, fileSize: row.fileSize, blob };
}

/** One-time migration for attachments created before the encrypted-vault release. */
export async function migrateLocalEvidenceFiles(passphrase: string): Promise<number> {
  const rows = await getStoredRows();
  let migrated = 0;
  for (const row of rows) {
    if ('encrypted' in row && row.encrypted === true) continue;
    await storeRow(await encryptLegacyRow(row as LegacyStoredEvidenceFile, passphrase));
    migrated += 1;
  }
  return migrated;
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
  } finally { database.close(); }
}
