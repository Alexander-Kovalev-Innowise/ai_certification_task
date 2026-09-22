// api-designer-spec.md §0.9. Keyset/cursor pagination on (createdAt, id) —
// never OFFSET, per arch §3.3 / NFR-002.

export interface PaginatedResponseDto<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface KeysetCursor {
  createdAt: string; // ISO 8601
  id: string;
}

export function encodeCursor(cursor: KeysetCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string): KeysetCursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw new Error('Invalid pagination cursor');
  }

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof (parsed as Record<string, unknown>).createdAt !== 'string' ||
    typeof (parsed as Record<string, unknown>).id !== 'string'
  ) {
    throw new Error('Invalid pagination cursor');
  }

  return parsed as KeysetCursor;
}

/**
 * Builds a PaginatedResponseDto from a query result fetched with `limit + 1`
 * rows (the standard keyset-pagination trick to determine `hasMore` without
 * a separate COUNT query).
 */
export function buildPaginatedResponse<T>(
  itemsFetchedWithExtraRow: T[],
  limit: number,
  getCursorFields: (item: T) => KeysetCursor,
): PaginatedResponseDto<T> {
  const hasMore = itemsFetchedWithExtraRow.length > limit;
  const items = hasMore ? itemsFetchedWithExtraRow.slice(0, limit) : itemsFetchedWithExtraRow;
  const last = items[items.length - 1];
  const nextCursor = hasMore && last ? encodeCursor(getCursorFields(last)) : null;

  return { items, nextCursor, hasMore };
}
