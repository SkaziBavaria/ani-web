'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  providerForUrl, recordProviderFailure, recordProviderSuccess, providerHealth, visibleProviderHealth,
  resetProviderHealth, publicProviderFailure,
} = require('../../lib/provider-health');

test.afterEach(resetProviderHealth);

test('wrapped resolver failures preserve structured metadata', () => {
  const cause = new Error('HTTP 503');
  recordProviderFailure('comick', cause);
  assert.equal(publicProviderFailure(new Error('Resolver failed', { cause })), cause.publicFailure);
  const cyclic = new Error('unknown');
  cyclic.cause = cyclic;
  assert.equal(publicProviderFailure(cyclic), null);
});

test('public failures carry provider scope and safe status without curl details', () => {
  for (const [provider, mediaMode] of [['anidb', 'anime'], ['comick', 'manga']]) {
    const error = new Error('curl: (22) The requested URL returned error: 503 https://example.test/?token=secret');
    recordProviderFailure(provider, error);
    assert.equal(error.publicFailure.provider, provider);
    assert.equal(error.publicFailure.mediaMode, mediaMode);
    assert.equal(error.publicFailure.upstreamStatus, 503);
    assert.equal(error.publicFailure.code, 'UPSTREAM_HTTP');
    assert.doesNotMatch(JSON.stringify(error.publicFailure), /curl|secret|token|example/);
  }
});

test('transport and response failures have distinct machine-readable codes', () => {
  for (const [message, code] of [['Connection timed out', 'UPSTREAM_TIMEOUT'], ['Could not resolve host', 'UPSTREAM_DNS'], ['SSL certificate failed', 'UPSTREAM_TLS'], ['invalid JSON', 'UPSTREAM_RESPONSE'], ['connection refused', 'UPSTREAM_CONNECTION']]) {
    const error = new Error(message);
    recordProviderFailure('anidb', error);
    assert.equal(error.publicFailure.code, code);
    assert.equal(error.publicFailure.upstreamStatus, null);
  }
});

test('provider health classifies upstreams without exposing request URLs', () => {
  assert.equal(providerForUrl('https://anidb.app/anime/example?token=secret'), 'anidb');
  assert.equal(providerForUrl('https://api.comick.dev/v1.0/search'), 'comick');
  recordProviderFailure('anidb', new Error('upstream curl failed: HTTP 503 https://secret.example/path'));
  recordProviderFailure('hianime', new Error('Connection or response error'));
  assert.equal(visibleProviderHealth().anidb, undefined);
  assert.equal(visibleProviderHealth().hianime.ok, false);
  const health = providerHealth().anidb;
  assert.equal(health.status, 503);
  assert.doesNotMatch(JSON.stringify(health), /secret\.example|token/);
  recordProviderSuccess('anidb');
  assert.equal(providerHealth().anidb.ok, true);
  assert.equal(visibleProviderHealth().anidb, undefined);
});
