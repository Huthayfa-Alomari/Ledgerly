export function persistLocalData(
  getStorage: () => Pick<Storage, 'setItem'>,
  key: string,
  value: unknown,
): string | null;
