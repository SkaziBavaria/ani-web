'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { recommendedAnime } = require('../../lib/anime-recommendations');

test('recommendations exclude archived tracked mappings and tolerate detail failures', async () => {
  const state = { shows: { legacy: { id: 'legacy', hianimeId: 'mapped', archived: true, genres: ['Action'] } } };
  const requested = [];
  const provider = {
    popular: async () => [{ id: 'mapped', hianimeId: 'mapped' }, { id: 'new' }, { id: 'failed' }],
    details: async (_, show) => {
      requested.push(show.id);
      if (show.id === 'failed') throw new Error('Unavailable');
      return { ...show, genres: ['Action'] };
    },
  };
  const result = await recommendedAnime(state, 'sub', provider);
  assert.deepEqual(requested, ['new', 'failed']);
  assert.equal(result[0].id, 'new');
  assert.equal(result[0].recommendationReason, 'Action');
  assert.equal(result.length, 2);
});
