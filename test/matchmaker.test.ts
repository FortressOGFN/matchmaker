import assert from 'node:assert/strict';
import { test } from 'node:test';
import { silentLogger } from '../src/core/logger';
import { buildClaims } from '../src/core/tickets';
import { Matchmaker } from '../src/queue/matchmaker';
import { SessionStore } from '../src/queue/sessions';
import { ServerRegistry } from '../src/servers/registry';
import { FakeProbe, FakeSocket, LOCAL, testConfig, wait } from './helpers';

function setup(servers: string, overrides = {}) {
  const probe = new FakeProbe();
  const config = testConfig(overrides, { NOVA_SERVERS: servers });
  const registry = new ServerRegistry(config, silentLogger, probe, LOCAL);
  const sessions = new SessionStore(60 * 60 * 1000);
  const matchmaker = new Matchmaker(config, registry, sessions, silentLogger);
  return { probe, registry, sessions, matchmaker };
}

test('players wait in the queue until the game server is up', async () => {
  const { probe, registry, sessions, matchmaker } = setup('127.0.0.1:7777:playlist_defaultsolo');
  const socket = new FakeSocket();
  const entry = matchmaker.enqueue(buildClaims({ accountId: 'p1', playlist: 'playlist_defaultsolo' }, 300), socket)!;

  await registry.probeOnce();
  assert.equal(matchmaker.tick(), 0);
  assert.equal(entry.state, 'queued');

  probe.open.add(7777);
  await registry.probeOnce();
  assert.equal(matchmaker.tick(), 1);
  await wait(10);

  assert.deepEqual(socket.states(), ['Queued', 'SessionAssignment', 'Play']);
  const session = sessions.get(entry.sessionId)!;
  assert.equal(session.ip, '127.0.0.1');
  assert.equal(session.port, 7777);
  assert.equal(sessions.forAccount('p1')?.sessionId, entry.sessionId);
  matchmaker.stop();
});

test('strict playlists keep players waiting for the right mode', async () => {
  const { probe, registry, matchmaker } = setup('127.0.0.1:7777:playlist_defaultsolo');
  probe.open.add(7777);
  await registry.probeOnce();
  const entry = matchmaker.enqueue(buildClaims({ accountId: 'p1', playlist: 'playlist_defaultduo' }, 300), new FakeSocket())!;
  matchmaker.tick();
  assert.equal(entry.state, 'queued');
  matchmaker.stop();
});

test('non-strict playlists fall back to any open server', async () => {
  const { probe, registry, matchmaker } = setup('127.0.0.1:7777:playlist_defaultsolo', { strictPlaylist: false });
  probe.open.add(7777);
  await registry.probeOnce();
  const entry = matchmaker.enqueue(buildClaims({ accountId: 'p1', playlist: 'playlist_defaultduo' }, 300), new FakeSocket())!;
  matchmaker.tick();
  assert.equal(entry.state, 'assigned');
  matchmaker.stop();
});

test('parties need enough free slots', async () => {
  const { probe, registry, matchmaker } = setup('127.0.0.1:7777:playlist_defaultsquad:NAE:3');
  probe.open.add(7777);
  await registry.probeOnce();
  const party = matchmaker.enqueue(buildClaims({ accountId: 'a', playlist: 'playlist_defaultsquad', partyPlayerIds: ['b', 'c', 'd'] }, 300), new FakeSocket())!;
  matchmaker.tick();
  assert.equal(party.state, 'queued');
  const duo = matchmaker.enqueue(buildClaims({ accountId: 'e', playlist: 'playlist_defaultsquad', partyPlayerIds: ['f'] }, 300), new FakeSocket())!;
  matchmaker.tick();
  assert.equal(duo.state, 'assigned');
  matchmaker.stop();
});

test('custom keys only match servers with the same key', async () => {
  const { registry, matchmaker } = setup('');
  registry.register({ ip: '10.0.0.2', port: 7777, playlist: 'playlist_defaultsolo' });
  const scrim = matchmaker.enqueue(buildClaims({ accountId: 'p1', playlist: 'playlist_defaultsolo', customKey: 'scrims' }, 300), new FakeSocket())!;
  matchmaker.tick();
  assert.equal(scrim.state, 'queued');
  registry.register({ ip: '10.0.0.3', port: 7777, playlist: 'playlist_defaultsolo', customKey: 'scrims' });
  matchmaker.tick();
  assert.equal(scrim.state, 'assigned');
  matchmaker.stop();
});

test('a started match stops new assignments', async () => {
  const { probe, registry, matchmaker } = setup('127.0.0.1:7777:playlist_defaultsolo');
  probe.open.add(7777);
  await registry.probeOnce();
  registry.setClosed('127.0.0.1:7777', true);
  const entry = matchmaker.enqueue(buildClaims({ accountId: 'p1', playlist: 'playlist_defaultsolo' }, 300), new FakeSocket())!;
  matchmaker.tick();
  assert.equal(entry.state, 'queued');
  matchmaker.stop();
});

test('a second request from the same account replaces the first', () => {
  const { matchmaker } = setup('');
  const first = new FakeSocket();
  matchmaker.enqueue(buildClaims({ accountId: 'p1', playlist: 'playlist_defaultsolo' }, 300), first);
  matchmaker.enqueue(buildClaims({ accountId: 'p1', playlist: 'playlist_defaultsolo' }, 300), new FakeSocket());
  assert.equal(first.closed?.code, 4000);
  assert.equal(matchmaker.queued().length, 1);
  matchmaker.stop();
});
