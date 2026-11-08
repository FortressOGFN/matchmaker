import assert from 'node:assert/strict';
import { test } from 'node:test';
import { silentLogger } from '../src/core/logger';
import { ServerRegistry } from '../src/servers/registry';
import { FakeProbe, LOCAL, testConfig } from './helpers';

test('a local configured server is joinable only while its port is open', async () => {
  const probe = new FakeProbe();
  const config = testConfig({ readyDelaySeconds: 3 }, { NOVA_SERVERS: '127.0.0.1:7777:playlist_defaultsolo' });
  const registry = new ServerRegistry(config, silentLogger, probe, LOCAL);
  const server = registry.findByAddress('127.0.0.1', 7777)!;

  await registry.probeOnce(1000);
  assert.equal(registry.status(server, 1000).status, 'offline');

  probe.open.add(7777);
  await registry.probeOnce(2000);
  assert.equal(registry.status(server, 3000).status, 'starting');
  assert.equal(registry.isJoinable(server, 5000), true);

  registry.setClosed(server.id, true);
  assert.equal(registry.status(server, 5000).status, 'match in progress');

  probe.open.delete(7777);
  await registry.probeOnce(6000);
  assert.equal(server.closed, false);
  assert.equal(registry.isJoinable(server, 6000), false);
});

test('a remote configured server waits for a heartbeat', () => {
  const registry = new ServerRegistry(testConfig({}, { NOVA_SERVERS: '10.0.0.5:7777:playlist_defaultsolo' }), silentLogger, new FakeProbe(), LOCAL);
  const server = registry.findByAddress('10.0.0.5', 7777)!;
  assert.equal(registry.status(server, 1000).status, 'waiting for registration');
  registry.heartbeat(server.id, { ready: true }, 1000);
  assert.equal(registry.isJoinable(server, 2000), true);
});

test('registered servers expire without heartbeats', () => {
  const registry = new ServerRegistry(testConfig({ heartbeatTimeoutSeconds: 30 }), silentLogger, new FakeProbe(), LOCAL);
  registry.register({ ip: '10.0.0.9', port: 7777 }, 1000);
  assert.equal(registry.all().length, 1);
  registry.prune(1000 + 31000);
  assert.equal(registry.all().length, 0);
});

test('reservations use up free slots until players arrive', () => {
  const registry = new ServerRegistry(testConfig({ readyCheck: 'always' }, { NOVA_SERVERS: '127.0.0.1:7777:playlist_defaultsolo:NAE:4' }), silentLogger, new FakeProbe(), LOCAL);
  const server = registry.findByAddress('127.0.0.1', 7777)!;
  server.readyCheck = 'always';
  registry.reserve(server, 'a', 3, 1000);
  assert.equal(registry.freeSlots(server, 1000), 1);
  registry.heartbeat(server.id, { playerCount: 3 }, 1500);
  assert.equal(registry.reservedSlots(server, 1500), 0);
  assert.equal(registry.freeSlots(server, 1500), 1);
});
