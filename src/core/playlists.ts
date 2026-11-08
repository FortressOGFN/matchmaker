export function normalizePlaylist(value: string | undefined | null): string {
  const trimmed = String(value || '').trim().toLowerCase();
  if (!trimmed) return '';
  return trimmed.startsWith('playlist_') ? trimmed : `playlist_${trimmed}`;
}

export function samePlaylist(left: string | undefined | null, right: string | undefined | null): boolean {
  const a = normalizePlaylist(left);
  const b = normalizePlaylist(right);
  return a !== '' && a === b;
}

export function normalizeRegion(value: string | undefined | null, fallback = 'NAE'): string {
  const trimmed = String(value || '').trim().toUpperCase();
  return trimmed || fallback;
}
