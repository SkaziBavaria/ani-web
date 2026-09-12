'use strict';

const animeProvider = require('./anime-provider');

function rankRecommendations(shows, candidates) {
  const weights = new Map();
  for (const show of shows) {
    for (const genre of show.genres || []) weights.set(genre, (weights.get(genre) || 0) + 2 + (show.lastWatched ? 1 : 0));
  }
  return candidates.map((show) => {
    const matching = (show.genres || []).filter((genre) => weights.has(genre)).sort((a, b) => weights.get(b) - weights.get(a));
    return {
      ...show,
      recommendationScore: matching.reduce((score, genre) => score + weights.get(genre), 0) + (Number(show.score) || 0) / 10,
      recommendationReason: matching.slice(0, 2).join(' + ') || 'Popular with anime viewers',
    };
  }).sort((a, b) => b.recommendationScore - a.recommendationScore);
}

async function recommendedAnime(state, mode = 'sub', provider = animeProvider) {
  const shows = Object.values(state.shows || {}).filter((show) => show.tracked !== false);
  const trackedIds = new Set(shows.map((show) => show.id));
  const candidates = animeProvider.bindCatalogToLibrary(state, await provider.popular('0'))
    .filter((show) => !trackedIds.has(show.id)).slice(0, 12);
  const details = [];
  for (let offset = 0; offset < candidates.length; offset += 3) {
    details.push(...await Promise.all(candidates.slice(offset, offset + 3).map(async (show) => {
      try { return { ...show, ...await provider.details(state, show, mode) }; }
      catch { return show; }
    })));
  }
  return rankRecommendations(shows, details);
}

module.exports = { recommendedAnime, rankRecommendations };
