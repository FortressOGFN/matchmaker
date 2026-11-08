import { NovaClient } from 'nova-matchmaker/sdk';

const nova = new NovaClient({ baseUrl: 'http://127.0.0.1:8080', apiKey: process.env.NOVA_API_KEY });
const ip = '127.0.0.1';
const port = 7777;

async function main() {
  const { heartbeatIntervalSeconds } = await nova.registerServer({ ip, port, playlist: 'playlist_defaultsolo', region: 'NAE', maxPlayers: 100 });
  setInterval(() => void nova.heartbeat(ip, port, { playerCount: currentPlayerCount() }), heartbeatIntervalSeconds * 1000);
}

function currentPlayerCount(): number {
  return 0;
}

export async function onBusLaunched() {
  await nova.markStarted(ip, port);
}

void main();
