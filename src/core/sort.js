import { isVideoFileLike } from './media.js';

const NATURAL_COLLATOR = new Intl.Collator(undefined, { numeric: true });

export function compareByNameAsc(a, b) {
  return NATURAL_COLLATOR.compare(a.name, b.name);
}

export function compareByNameDesc(a, b) {
  return NATURAL_COLLATOR.compare(b.name, a.name);
}

export function compareMediaAware(a, b, sortMode = 'name-asc', isVideo = isVideoFileLike) {
  const aIsVideo = isVideo(a);
  const bIsVideo = isVideo(b);
  if (aIsVideo && !bIsVideo) return -1;
  if (!aIsVideo && bIsVideo) return 1;
  if (sortMode === 'name-asc') return compareByNameAsc(a, b);
  return compareByNameDesc(a, b);
}
