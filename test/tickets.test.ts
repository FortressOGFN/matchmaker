import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseAuthorization, signTicket, verifyTicket } from '../src/core/tickets';

test('a signed ticket verifies and carries its claims', () => {
  const ticket = signTicket('secret', { accountId: 'abc', playlist: 'DefaultSolo', region: 'eu', partyPlayerIds: ['abc', 'def'] });
  const result = verifyTicket('secret', ticket.payload, ticket.signature);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.claims.playlist, 'playlist_defaultsolo');
  assert.equal(result.claims.region, 'EU');
  assert.deepEqual(result.claims.partyPlayerIds, ['abc', 'def']);
});

test('a tampered ticket is rejected', () => {
  const ticket = signTicket('secret', { accountId: 'abc', playlist: 'playlist_defaultsolo' });
  const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(ticket.payload, 'base64url').toString()), accountId: 'someone-else' })).toString('base64url');
  assert.deepEqual(verifyTicket('secret', forged, ticket.signature), { ok: false, reason: 'bad signature' });
  assert.deepEqual(verifyTicket('other-secret', ticket.payload, ticket.signature), { ok: false, reason: 'bad signature' });
});

test('an expired ticket is rejected', () => {
  const ticket = signTicket('secret', { accountId: 'abc', playlist: 'playlist_defaultsolo' }, 10, 1000);
  assert.deepEqual(verifyTicket('secret', ticket.payload, ticket.signature, 1000 + 11000), { ok: false, reason: 'expired ticket' });
});

test('the Epic-Signed authorization header is parsed', () => {
  assert.deepEqual(parseAuthorization('Epic-Signed mms-player abc def'), { ticketType: 'mms-player', payload: 'abc', signature: 'def' });
  assert.equal(parseAuthorization('Bearer token'), null);
  assert.equal(parseAuthorization(undefined), null);
});
