import { normalizePlaylist, normalizeRegion } from './playlists';

const REGIONS = new Set(['NAE', 'NAW', 'NAC', 'NA', 'EU', 'OCE', 'BR', 'ASIA', 'ME']);

export interface ParsedMatchmakingQuery {
  playlist: string;
  region: string;
  buildId: string;
  partyPlayerIds: string[];
  customKey?: string;
  platform?: string;
}

function first(value: unknown): string {
  if (Array.isArray(value)) return first(value[0]);
  return typeof value === 'string' ? value : '';
}

export function parseMatchmakingQuery(query: Record<string, unknown>, fallbackRegion = 'NAE'): ParsedMatchmakingQuery | null {
  const parts = first(query.bucketId).split(':').map((part) => part.trim()).filter(Boolean);
  const linkCode = first(query['player.option.linkCode']) || first(query['player.option.link']);

  const fromLink = /^playlist_/i.test(linkCode) ? linkCode : '';
  const fromBucket = parts.find((part) => /^playlist_/i.test(part)) || (parts.length === 4 ? parts[3] : '');
  const playlist = normalizePlaylist(fromLink || fromBucket || linkCode);
  if (!playlist) return null;

  const region = parts.find((part) => REGIONS.has(part.toUpperCase())) || first(query['player.option.region']) || fallbackRegion;
  const buildId = parts.find((part) => /^\d{5,}$/.test(part)) || parts[0] || '0';
  const partyPlayerIds = first(query.partyPlayerIds).split(',').map((id) => id.trim()).filter(Boolean);

  const parsed: ParsedMatchmakingQuery = {
    playlist,
    region: normalizeRegion(region, fallbackRegion),
    buildId,
    partyPlayerIds,
  };
  const customKey = first(query['player.option.customKey']);
  if (customKey) parsed.customKey = customKey;
  const platform = first(query['player.platform']);
  if (platform) parsed.platform = platform;
  return parsed;
}
