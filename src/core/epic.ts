import { newUpperId } from './ids';
import { MatchSession } from '../queue/sessions';

export function epicSession(session: MatchSession, buildUniqueId?: string): Record<string, unknown> {
  const owner = newUpperId();
  return {
    id: session.sessionId,
    ownerId: owner,
    ownerName: `[DS]nova-${session.region.toLowerCase()}-${session.port}`,
    serverName: `[DS]nova-${session.region.toLowerCase()}-${session.port}`,
    serverAddress: session.ip,
    serverPort: session.port,
    maxPublicPlayers: 220,
    openPublicPlayers: 175,
    maxPrivatePlayers: 0,
    openPrivatePlayers: 0,
    attributes: {
      REGION_s: session.region,
      GAMEMODE_s: 'FORTATHENA',
      ALLOWBROADCASTING_b: true,
      SUBREGION_s: session.region,
      DCID_s: `NOVA-${session.region}-${session.port}`,
      tenant_s: 'Fortnite',
      MATCHMAKINGPOOL_s: 'Any',
      STORMSHIELDDEFENSETYPE_i: 0,
      HOTFIXVERSION_i: 0,
      PLAYLISTNAME_s: session.playlist,
      SESSIONKEY_s: newUpperId(),
      TENANT_s: 'Fortnite',
      BEACONPORT_i: 15009,
      SERVERADDRESS_s: session.ip,
    },
    publicPlayers: [],
    privatePlayers: [],
    totalPlayers: session.accountIds.length,
    allowJoinInProgress: false,
    shouldAdvertise: false,
    isDedicated: false,
    usesStats: false,
    allowInvites: false,
    usesPresence: false,
    allowJoinViaPresence: true,
    allowJoinViaPresenceFriendsOnly: false,
    buildUniqueId: buildUniqueId || session.buildId || '0',
    lastUpdated: new Date().toISOString(),
    started: false,
  };
}
