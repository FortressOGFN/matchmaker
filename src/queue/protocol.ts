export interface MmsMessage {
  name: 'StatusUpdate' | 'Play';
  payload: Record<string, unknown>;
}

export const Messages = {
  connecting(): MmsMessage {
    return { name: 'StatusUpdate', payload: { state: 'Connecting' } };
  },
  waiting(totalPlayers: number): MmsMessage {
    return { name: 'StatusUpdate', payload: { totalPlayers, connectedPlayers: totalPlayers, state: 'Waiting' } };
  },
  queued(ticketId: string, queuedPlayers: number, estimatedWaitSec: number): MmsMessage {
    return { name: 'StatusUpdate', payload: { ticketId, queuedPlayers, estimatedWaitSec, status: {}, state: 'Queued' } };
  },
  sessionAssignment(matchId: string): MmsMessage {
    return { name: 'StatusUpdate', payload: { matchId, state: 'SessionAssignment' } };
  },
  play(matchId: string, sessionId: string, joinDelaySec: number): MmsMessage {
    return { name: 'Play', payload: { matchId, sessionId, joinDelaySec } };
  },
};
