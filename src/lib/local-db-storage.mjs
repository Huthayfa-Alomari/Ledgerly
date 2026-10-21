export function loadLocalData(getStorage, key, fallback) {
  try {
    const raw = getStorage().getItem(key);
    if (raw === null) return { value: fallback, error: null };
    try {
      return { value: JSON.parse(raw), error: null };
    } catch {
      return { value: fallback, error: 'invalid-json' };
    }
  } catch {
    return { value: fallback, error: 'storage-unavailable' };
  }
}

export function persistLocalData(getStorage, key, value) {
  try {
    const serialized = JSON.stringify(value);
    getStorage().setItem(key, serialized);
    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return message.slice(0, 160) || 'Unknown storage error';
  }
}

/** Validate the top-level shape of a locally persisted database without throwing. */
export function localDataShapeIssue(value, arrayKeys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'invalid-root';
  if (!Array.isArray(arrayKeys) || arrayKeys.some(key => value[key] !== undefined && !Array.isArray(value[key]))) {
    return 'invalid-collections';
  }
  return null;
}
