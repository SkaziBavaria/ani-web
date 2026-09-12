'use strict';

const hianime = require('./hianime');
const anidb = require('./anidb');
const legacyPlayback = require('./anime-resolver');
const { normalizeEpisode, highestEpisode } = require('./episodes');

// Library identity is independent of the upstream identifier. Stored mappings
// take precedence over client hints, including for archived entries.
function providerIdentity(state, input) {
  const request = typeof input === 'string' ? { id: input } : input;
  if (!request?.id || typeof request.id !== 'string') throw Object.assign(new Error('Missing show id'), { status: 422 });
  const stored = state.shows?.[request.id];
  const show = stored || request;
  if (show.provider && !['hianime', 'anidb'].includes(show.provider)) throw Object.assign(new Error('Unsupported anime provider'), { status: 422 });
  if (show.hianimeId || show.provider === 'hianime') {
    return { id: request.id, provider: 'hianime', providerId: show.hianimeId || show.id };
  }
  return { id: request.id, provider: 'anidb', providerId: request.id };
}

function normalizeDetails(identity, details) {
  if (details.id !== identity.providerId) throw new Error('Anime provider returned the wrong identity');
  const rows = details.episodes || [];
  const episodes = [...new Set(rows.map((row) => normalizeEpisode(typeof row === 'object' ? row.number : row)).filter(Boolean))];
  return {
    ...details,
    id: identity.id,
    provider: identity.provider,
    ...(identity.provider === 'hianime' ? { hianimeId: identity.providerId } : {}),
    episodes,
    episodeTitles: { ...Object.fromEntries(rows.filter((row) => row && typeof row === 'object' && row.title).map((row) => [row.number, row.title])), ...details.episodeTitles },
    latestEpisode: highestEpisode(episodes) || details.latestEpisode || null,
  };
}

function bindCatalogToLibrary(state, results) {
  const byProviderId = new Map(Object.values(state.shows || {}).filter((show) => show.hianimeId).map((show) => [show.hianimeId, show]));
  return results.map((item) => {
    const existing = byProviderId.get(item.hianimeId);
    return existing ? { ...item, id: existing.id } : item;
  });
}

function createAnimeProvider(adapters = { hianime, anidb: { ...anidb, ...legacyPlayback } }) {
  const detailsCache = new Map();
  async function loadDetails(identity, mode, options) {
    const key = `${identity.provider}:${identity.providerId}:${mode}`;
    const cached = detailsCache.get(key);
    if (!options.force && cached && cached.expires > Date.now()) return structuredClone(await cached.value);
    const entry = {
      expires: Date.now() + 5 * 60_000,
      value: Promise.resolve().then(() => adapters[identity.provider].getShowDetails(identity.providerId, mode, options)),
    };
    detailsCache.delete(key);
    detailsCache.set(key, entry);
    while (detailsCache.size > 128) detailsCache.delete(detailsCache.keys().next().value);
    try { return structuredClone(await entry.value); } catch (error) {
      if (detailsCache.get(key) === entry) detailsCache.delete(key);
      throw error;
    }
  }
  const service = {
    search(query) {
      return query ? adapters.hianime.searchAnime(query) : adapters.hianime.browseAnime('/recently-updated');
    },
    popular(range) {
      return adapters.hianime.popularAnime(range);
    },
    async details(state, input, mode = 'sub', options = {}) {
      const identity = providerIdentity(state, input);
      const adapter = adapters[identity.provider];
      const value = identity.provider === 'anidb' && adapter.getCachedShowDetails
        ? await adapter.getCachedShowDetails(state, identity.providerId, mode, options)
        : await loadDetails(identity, mode, options);
      return normalizeDetails(identity, value);
    },
    async playback(state, input, options) {
      const identity = providerIdentity(state, input);
      return adapters[identity.provider].resolveEpisodePlayback({ ...options, showId: identity.providerId });
    },
    async summaries(state, ids, mode) {
      const unique = [...new Set(ids.map(String))].slice(0, 40);
      const summaries = new Map();
      for (let offset = 0; offset < unique.length; offset += 3) {
        await Promise.all(unique.slice(offset, offset + 3).map(async (id) => {
          try { summaries.set(id, await service.details(state, id, mode)); }
          catch { /* Keep known relation metadata when its provider is unavailable. */ }
        }));
      }
      return summaries;
    },
  };
  return service;
}

module.exports = { ...createAnimeProvider(), createAnimeProvider, providerIdentity, normalizeDetails, bindCatalogToLibrary };
