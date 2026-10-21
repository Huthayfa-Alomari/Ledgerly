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
