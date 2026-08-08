/** Remove policy keys only. Display preferences and meta progression are intentionally untouched. */
export function clearStoredPolicyModels(storage: Pick<Storage, 'removeItem'>, keys: readonly string[]): void {
  for (const key of new Set(keys)) storage.removeItem(key);
}
