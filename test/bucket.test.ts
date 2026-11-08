import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseMatchmakingQuery } from '../src/core/bucket';

test('reads the classic four-part bucket id', () => {
  const parsed = parseMatchmakingQuery({ bucketId: '4072250:0:NAE:playlist_defaultsolo', partyPlayerIds: 'a,b' });
  assert.equal(parsed?.playlist, 'playlist_defaultsolo');
  assert.equal(parsed?.region, 'NAE');
  assert.equal(parsed?.buildId, '4072250');
  assert.deepEqual(parsed?.partyPlayerIds, ['a', 'b']);
});

test('reads newer bucket ids and link codes', () => {
  const parsed = parseMatchmakingQuery({
    bucketId: 'FN:Live:30776155:0:EU:playlist_showdownalt_solo:PC:public:1',
    'player.option.linkCode': 'playlist_showdownalt_solo',
    'player.option.customKey': 'scrims',
  });
  assert.equal(parsed?.playlist, 'playlist_showdownalt_solo');
  assert.equal(parsed?.region, 'EU');
  assert.equal(parsed?.buildId, '30776155');
  assert.equal(parsed?.customKey, 'scrims');
});

test('returns null without a playlist', () => {
  assert.equal(parseMatchmakingQuery({}), null);
});
