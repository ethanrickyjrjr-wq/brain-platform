/**
 * Sticky confirmed-value helpers (Phase F). A confirmed value is keyed to the
 * EXACT (itemId, filedValue) pair: when the user edits the number, the new value
 * no longer matches, so suppression lifts and the item re-evaluates.
 * Pure — no I/O. Operates on any object carrying an optional confirmed_values bag.
 */
export type ConfirmedValues = Record<string, string>;

export function confirmKey(itemId: string, filedValue: string): string {
  return `${itemId} ${filedValue}`;
}

export function isConfirmed(
  cv: ConfirmedValues | undefined,
  itemId: string,
  filedValue: string,
): boolean {
  return cv?.[itemId] === filedValue;
}

export function withConfirmed<T extends { confirmed_values?: ConfirmedValues }>(
  uiState: T,
  itemId: string,
  filedValue: string,
): T {
  return {
    ...uiState,
    confirmed_values: { ...(uiState.confirmed_values ?? {}), [itemId]: filedValue },
  };
}

export function withoutConfirmed<T extends { confirmed_values?: ConfirmedValues }>(
  uiState: T,
  itemId: string,
): T {
  const next = { ...(uiState.confirmed_values ?? {}) };
  delete next[itemId];
  return { ...uiState, confirmed_values: next };
}
