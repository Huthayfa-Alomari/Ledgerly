export type LocalDataLoadError = 'invalid-json' | 'storage-unavailable';
export function loadLocalData<T>(
  getStorage: () => Pick<Storage, 'getItem'>,
  key: string,
  fallback: T,
): { value: unknown | T; error: LocalDataLoadError | null };
export function persistLocalData(
  getStorage: () => Pick<Storage, 'setItem'>,
  key: string,
  value: unknown,
): string | null;
