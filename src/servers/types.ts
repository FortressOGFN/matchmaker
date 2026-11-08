import { ReadyCheck } from '../core/config';

export type ServerSource = 'static' | 'registered';

export interface Reservation {
  slots: number;
  expiresAt: number;
}

export interface GameServer {
  id: string;
  ip: string;
  port: number;
  playlist: string;
  region: string;
  maxPlayers: number;
  playerCount: number;
  customKey?: string;
  source: ServerSource;
  readyCheck: ReadyCheck;
  local: boolean;
  reportedReady: boolean;
  lastHeartbeat: number;
  portOpen: boolean;
  portOpenSince: number;
  closed: boolean;
  createdAt: number;
  reservations: Map<string, Reservation>;
}

export interface RegisterServerInput {
  ip: string;
  port: number;
  playlist?: string;
  region?: string;
  maxPlayers?: number;
  playerCount?: number;
  customKey?: string;
  ready?: boolean;
}

export interface HeartbeatInput {
  playerCount?: number;
  ready?: boolean;
  playlist?: string;
  maxPlayers?: number;
}

export interface PublicServer {
  id: string;
  address: string;
  playlist: string;
  region: string;
  source: ServerSource;
  joinable: boolean;
  status: string;
  playerCount: number;
  reservedSlots: number;
  maxPlayers: number;
  customKey?: string;
}
