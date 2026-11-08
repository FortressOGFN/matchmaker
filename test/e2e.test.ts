import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import WebSocket from 'ws';
import { silentLogger } from '../src/core/logger';
import { Nova } from '../src/nova';
import { NovaClient } from '../src/sdk';
import { FakeProbe, LOCAL, testConfig, wait } from './helpers';

const probe = new FakeProbe();
let nova: Nova;
let client: NovaClient;
let base: string;

before(async () => {
  nova = new Nova(testConfig({ port: 0, host: '127.0.0.1', probeIntervalMs: 250, tickIntervalMs: 100 }, { NOVA_SERVERS: '127.0.0.1:7777:playlist_defaultsolo' }), { logger: silentLogger, probe, localAddresses: LOCAL });
  const port = await nova.start();
  base = `http://127.0.0.1:${port}`;
  client = new NovaClient({ baseUrl: base, apiKey: 'test-key' });
});

after(async () => {
  await nova.stop();
});

function connect(ticket: { payload: string; signature: string; ticketType: string }) {
  const ws = new WebSocket(base.replace('http', 'ws'), { headers: { Authorization: `Epic-Signed ${ticket.ticketType} ${ticket.payload} ${ticket.signature}` } });
  const messages: any[] = [];
  ws.on('message', (data) => messages.push(JSON.parse(String(data))));
  return { ws, messages };
}

test('the API requires the key', async () => {
  const response = await fetch(`${base}/api/v1/servers`);
  assert.equal(response.status, 401);
  const health = await fetch(`${base}/health`);
  assert.equal(health.status, 200);
});

test('connections without a valid ticket are refused', async () => {
  const ws = new WebSocket(base.replace('http', 'ws'), { headers: { Authorization: 'Epic-Signed mms-player bad bad' } });
  const status = await new Promise<number>((resolve) => ws.on('unexpected-response', (_request, response) => resolve(response.statusCode || 0)));
  assert.equal(status, 401);
});

test('a player queues, waits for the server, then gets the session', async () => {
  const ticket = await client.createTicket('player-one', { bucketId: '4072250:0:NAE:playlist_defaultsolo', partyPlayerIds: 'player-one' });
  assert.equal(ticket.ticketType, 'mms-player');

  const { ws, messages } = connect(ticket);
  await wait(1000);
  assert.deepEqual(messages.map((m) => m.payload.state || m.name), ['Connecting', 'Waiting', 'Queued']);

  probe.open.add(7777);
  await wait(1000);
  const play = messages.find((m) => m.name === 'Play');
  assert.ok(play, 'expected a Play message once the server was up');

  const session = await client.getSession(play.payload.sessionId);
  assert.equal(session.port, 7777);
  const epic = await client.getEpicSession(play.payload.sessionId, '4072250');
  assert.equal(epic.serverAddress, '127.0.0.1');
  assert.equal(epic.buildUniqueId, '4072250');

  const status: any = await client.status();
  assert.equal(status.joinableServers, 1);
  ws.close();
});

test('game servers can register, heartbeat and close themselves', async () => {
  await client.registerServer({ ip: '10.1.1.1', port: 7777, playlist: 'playlist_defaultduo', maxPlayers: 50 });
  await client.heartbeat('10.1.1.1', 7777, { playerCount: 10 });
  await client.markStarted('10.1.1.1', 7777);
  const servers: any = await (await fetch(`${base}/api/v1/servers`, { headers: { 'X-Api-Key': 'test-key' } })).json();
  const registered = servers.servers.find((s: any) => s.id === '10.1.1.1:7777');
  assert.equal(registered.status, 'match in progress');
  assert.equal(registered.playerCount, 10);
  await client.unregister('10.1.1.1', 7777);
});
