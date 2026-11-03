/**
 * Edge cache for public share snapshots. Purging is best effort: the Cache
 * API is per location, so other locations may serve a removed share until max-age.
 */
export const SHARE_MAX_AGE_SECONDS = 300;

const cacheKey = (origin: string, slug: string) => new Request(`${origin}/s/${slug}`);

export async function readCachedShare(origin: string, slug: string): Promise<Response | undefined> {
  return caches.default.match(cacheKey(origin, slug));
}

export async function storeCachedShare(origin: string, slug: string, res: Response): Promise<void> {
  await caches.default.put(cacheKey(origin, slug), res.clone());
}

export async function purgeCachedShare(origin: string, slug: string): Promise<void> {
  await caches.default.delete(cacheKey(origin, slug));
}
