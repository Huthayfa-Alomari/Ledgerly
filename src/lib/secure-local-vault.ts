import { deserializeJodVaultPayload, serializeJodVaultPayload } from './jod-vault-format.mjs';
type VaultRecord = {
  id: 'workspace';
  version: 1;
  salt: number[];
  iv: number[];
  ciphertext: ArrayBuffer;
  updatedAt: string;
};

const DATABASE_NAME = 'ledgerly-secure-local-vault-v1';
const STORE_NAME = 'encrypted-records';
const RECORD_ID = 'workspace';
const PBKDF2_ITERATIONS = 310_000;
const encoder = new TextEncoder();
const decoder = new TextDecoder();
let writeQueue: Promise<unknown> = Promise.resolve();

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('التخزين المشفّر غير متاح في هذه البيئة. استخدم متصفحًا حديثًا أو نسخة Ledgerly لسطح المكتب.'));
      return;
    }
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('تعذر فتح مخزن Ledgerly المشفّر.'));
    request.onblocked = () => reject(new Error('أغلق نوافذ Ledgerly الأخرى ثم أعد المحاولة.'));
  });
}

async function readRecord(): Promise<VaultRecord | null> {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const request = database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(RECORD_ID);
      request.onsuccess = () => resolve((request.result as VaultRecord | undefined) ?? null);
      request.onerror = () => reject(new Error('تعذر قراءة سجل المخزن المشفّر.'));
    });
  } finally {
    database.close();
  }
}

async function storeRecord(record: VaultRecord): Promise<void> {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).put(record);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(new Error('تعذر حفظ بيانات المخزن المشفّر.'));
      transaction.onabort = () => reject(new Error('أُلغيت عملية حفظ المخزن المشفّر.'));
    });
  } finally {
    database.close();
  }
}

function toOwnedArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

function requireCrypto(): SubtleCrypto {
  if (typeof crypto === 'undefined' || !crypto.subtle || typeof crypto.getRandomValues !== 'function') {
    throw new Error('التشفير غير متاح في هذه البيئة. افتح Ledgerly عبر HTTPS أو نسخة سطح المكتب المدعومة.');
  }
  return crypto.subtle;
}

async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const subtle = requireCrypto();
  const baseKey = await subtle.importKey('raw', toOwnedArrayBuffer(encoder.encode(passphrase)), 'PBKDF2', false, ['deriveKey']);
  return subtle.deriveKey(
    { name: 'PBKDF2', salt: toOwnedArrayBuffer(salt), iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

function makeRandomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

async function encryptValue(passphrase: string, value: unknown, salt?: Uint8Array): Promise<VaultRecord> {
  const resolvedSalt = salt ?? makeRandomBytes(16);
  const iv = makeRandomBytes(12);
  const key = await deriveKey(passphrase, resolvedSalt);
  const ciphertext = await requireCrypto().encrypt(
    { name: 'AES-GCM', iv: toOwnedArrayBuffer(iv) },
    key,
    toOwnedArrayBuffer(encoder.encode(JSON.stringify(serializeJodVaultPayload(value)))),
  );
  return {
    id: RECORD_ID,
    version: 1,
    salt: Array.from(resolvedSalt),
    iv: Array.from(iv),
    ciphertext,
    updatedAt: new Date().toISOString(),
  };
}

async function decryptRecord(passphrase: string, record: VaultRecord): Promise<unknown> {
  try {
    const key = await deriveKey(passphrase, new Uint8Array(record.salt));
    const plaintext = await requireCrypto().decrypt(
      { name: 'AES-GCM', iv: toOwnedArrayBuffer(new Uint8Array(record.iv)) },
      key,
      record.ciphertext,
    );
    return deserializeJodVaultPayload(JSON.parse(decoder.decode(plaintext)) as unknown);
  } catch {
    throw new Error('تعذر فتح المخزن. كلمة المرور غير صحيحة أو أن النسخة المشفّرة تالفة؛ لم نُعد تهيئة البيانات.');
  }
}

function shapeIssue(value: unknown, arrayKeys: string[]): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'جذر البيانات ليس كائنًا صالحًا.';
  const record = value as Record<string, unknown>;
  if (arrayKeys.some(key => record[key] !== undefined && !Array.isArray(record[key]))) {
    return 'إحدى مجموعات البيانات ليست قائمة صالحة.';
  }
  return null;
}

export async function hasEncryptedLocalVault(): Promise<boolean> {
  return Boolean(await readRecord());
}

/**
 * Opens an existing encrypted vault or encrypts the legacy plaintext workspace once.
 * AES-GCM authenticates the ciphertext; the passphrase is never persisted.
 */
export async function unlockOrInitializeLocalVault<T>(
  passphrase: string,
  legacyRaw: string | null,
  fallback: T,
  arrayKeys: string[],
): Promise<{ value: T; wasNew: boolean; migratedLegacy: boolean }> {
  if (passphrase.length < 12) throw new Error('كلمة مرور المخزن المحلي يجب أن تكون 12 حرفًا على الأقل. احتفظ بها في مكان آمن؛ لا توجد آلية استرجاع إذا فُقدت.');
  requireCrypto();
  const existing = await readRecord();
  if (existing) {
    const value = await decryptRecord(passphrase, existing);
    const issue = shapeIssue(value, arrayKeys);
    if (issue) throw new Error('المخزن المشفّر لا يحتوي بنية بيانات متوافقة: ' + issue);
    return { value: value as T, wasNew: false, migratedLegacy: false };
  }

  let initial: unknown = fallback;
  let migratedLegacy = false;
  if (legacyRaw !== null) {
    try {
      initial = JSON.parse(legacyRaw) as unknown;
    } catch {
      throw new Error('وجدنا بيانات قديمة غير قابلة لقراءة JSON. لم نمسحها. نزّل نسخة خام منها قبل إعادة التهيئة.');
    }
    const issue = shapeIssue(initial, arrayKeys);
    if (issue) throw new Error('وجدنا بيانات قديمة ببنية غير سليمة. لم نمسحها أو نستبدلها: ' + issue);
    migratedLegacy = true;
  }

  const record = await encryptValue(passphrase, initial);
  await storeRecord(record);
  const verified = await readRecord();
  if (!verified) throw new Error('تعذر التحقق من حفظ المخزن المشفّر.');
  const roundTrip = await decryptRecord(passphrase, verified);
  if (JSON.stringify(roundTrip) !== JSON.stringify(initial)) {
    throw new Error('لم تتطابق البيانات بعد اختبار التشفير والاستعادة؛ لم تُحذف النسخة القديمة.');
  }
  return { value: initial as T, wasNew: legacyRaw === null, migratedLegacy };
}

/** Serializes writes to prevent a slower older encryption operation overwriting a newer save. */
export function persistEncryptedLocalVault(passphrase: string, value: unknown): Promise<string | null> {
  const operation = writeQueue.then(async () => {
    try {
      const current = await readRecord();
      if (!current) return 'المخزن المشفّر غير مهيأ؛ افتحه بكلمة المرور أولًا.';
      const next = await encryptValue(passphrase, value, new Uint8Array(current.salt));
      await storeRecord(next);
      return null;
    } catch (error) {
      return error instanceof Error ? error.message.slice(0, 220) : 'تعذر حفظ المخزن المشفّر.';
    }
  });
  writeQueue = operation.catch(() => undefined);
  return operation;
}

export async function encryptedVaultBackup(passphrase: string): Promise<Blob> {
  const record = await readRecord();
  if (!record) throw new Error('لا يوجد مخزن مشفّر لتصديره.');
  // Verify the password before allowing a backup to be exported.
  await decryptRecord(passphrase, record);
  const bytes = new Uint8Array(record.ciphertext);
  const binary = Array.from(bytes, byte => String.fromCharCode(byte)).join('');
  const backup = {
    format: 'ledgerly-encrypted-vault-v1',
    version: 1,
    salt: record.salt,
    iv: record.iv,
    ciphertextBase64: btoa(binary),
    updatedAt: record.updatedAt,
  };
  return new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json;charset=utf-8' });
}

export async function restoreEncryptedVaultBackup(passphrase: string, fileText: string, arrayKeys: string[] = []): Promise<unknown> {
  let payload: Record<string, unknown>;
  try { payload = JSON.parse(fileText) as Record<string, unknown>; }
  catch { throw new Error('ملف النسخة المشفّرة ليس JSON صالحًا.'); }
  if (payload.format !== 'ledgerly-encrypted-vault-v1' || payload.version !== 1 ||
      !Array.isArray(payload.salt) || !Array.isArray(payload.iv) || typeof payload.ciphertextBase64 !== 'string') {
    throw new Error('صيغة النسخة الاحتياطية المشفّرة غير معروفة.');
  }
  let binary: string;
  try { binary = atob(payload.ciphertextBase64); }
  catch { throw new Error('بيانات التشفير في النسخة الاحتياطية غير صالحة.'); }
  const ciphertext = Uint8Array.from(binary, char => char.charCodeAt(0)).buffer;
  const record: VaultRecord = {
    id: RECORD_ID,
    version: 1,
    salt: payload.salt as number[],
    iv: payload.iv as number[],
    ciphertext,
    updatedAt: typeof payload.updatedAt === 'string' ? payload.updatedAt : new Date().toISOString(),
  };
  const value = await decryptRecord(passphrase, record);
  const issue = shapeIssue(value, arrayKeys);
  if (issue) throw new Error('النسخة الاحتياطية لا تحتوي بنية مساحة عمل صالحة: ' + issue);
  await storeRecord(record);
  return value;
}

export async function migrateLegacyEvidenceIfNeeded(passphrase: string): Promise<number> {
  const { migrateLocalEvidenceFiles } = await import('./local-evidence-files');
  return migrateLocalEvidenceFiles(passphrase);
}
