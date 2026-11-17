import { Router, type Request, type Response } from 'express';
import {
  searchWorks, searchWorkFacets, listCircleSummaries, listCollections, getCollection,
  createCollection, updateCollection, deleteCollection, setCollectionWorkMembership,
  searchCollectionWorks, type DbCollectionType, type DbCollectionMatch, type DbCollectionContentFilter,
} from './db';
import type { AgeRating } from '../types/shared';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, withPaginationMetadata, toStringParam, toArrayParam, getErrorMessage } from './requestUtils';

const router = Router();

function parseAgeRatingsQuery(input: unknown): { ratings?: AgeRating[]; error?: string } {
  if (input === undefined) return {};
  const values = toArrayParam(input);
  if (values.length === 1 && values[0] === 'none') return { ratings: [] };
  if (values.length === 0 || values.some(value => value !== 'sfw' && value !== 'r15' && value !== 'r18')) {
    return { error: 'ageRating must contain only "sfw", "r15", or "r18", or be "none"' };
  }
  return { ratings: (['sfw', 'r15', 'r18'] as AgeRating[]).filter(rating => values.includes(rating)) };
}

function parseWorkFilters(query: Request['query']): { value?: Parameters<typeof searchWorkFacets>[0]; error?: string } {
  const selectedRatings = parseAgeRatingsQuery(query.ageRating);
  if (selectedRatings.error) return { error: selectedRatings.error };
  return {
    value: {
      q: toStringParam(query.q),
      nsfw: toStringParam(query.nsfw),
      ageRatings: selectedRatings.ratings,
      circles: toArrayParam(query.circle),
      tags: toArrayParam(query.tag),
      vas: toArrayParam(query.va),
    },
  };
}

// List works (supports pagination + filtering)
router.get('/api/works', async (req, res) => {
  try {
    const page = toStringParam(req.query?.page);
    const pageSize = toStringParam(req.query?.pageSize);
    const filters = parseWorkFilters(req.query);
    if (filters.error) return res.status(400).json({ error: filters.error });
    const sort = toStringParam(req.query?.sort);
    const pageNumber = (() => {
      const n = parseInt(page ?? '', 10);
      if (Number.isFinite(n) && n >= 1) return n;
      return 1;
    })();
    const perPage = (() => {
      const n = parseInt(pageSize ?? '', 10);
      if (Number.isFinite(n) && n >= 1) return Math.min(n, MAX_PAGE_SIZE);
      return DEFAULT_PAGE_SIZE;
    })();
    const searchOptions: Parameters<typeof searchWorks>[0] = { ...filters.value, page: pageNumber, pageSize: perPage, sort };
    const result = await searchWorks(searchOptions);
    res.json(withPaginationMetadata(result));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: getErrorMessage(e) || 'Failed to list works' });
  }
});

router.get('/api/works/facets', async (req, res) => {
  try {
    const filters = parseWorkFilters(req.query);
    if (filters.error) return res.status(400).json({ error: filters.error });
    const facets = await searchWorkFacets(filters.value);
    res.json(facets);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: getErrorMessage(e) || 'Failed to list work facets' });
  }
});

type CollectionPayload = {
  name: string;
  type: DbCollectionType;
  match: DbCollectionMatch;
  ageRatings: AgeRating[];
  tags: string[];
};

function normalizeCollectionPayloadTags(input: unknown): string[] | null {
  if (!Array.isArray(input)) return null;
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const value of input) {
    if (typeof value !== 'string') return null;
    const name = value.trim();
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    if (name.length > 80) return null;
    seen.add(key);
    tags.push(name);
  }
  return tags;
}

function validateCollectionPayload(
  input: unknown,
  existing?: { name: string; type: DbCollectionType; match: DbCollectionMatch; contentFilter: DbCollectionContentFilter | 'custom'; ageRatings: AgeRating[]; tags: string[] }
): { value?: CollectionPayload; error?: string } {
  const payload = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  const rawName = payload.name === undefined ? existing?.name : payload.name;
  if (typeof rawName !== 'string' || !rawName.trim()) return { error: 'Collection name is required' };
  const name = rawName.trim();
  if (name.length > 100) return { error: 'Collection name must be 100 characters or fewer' };

  const rawType = payload.type === undefined ? existing?.type ?? 'manual' : payload.type;
  if (rawType !== 'manual' && rawType !== 'smart') return { error: 'Collection type must be manual or smart' };
  const type: DbCollectionType = rawType;

  const rawMatch = payload.match === undefined ? existing?.match ?? 'and' : payload.match;
  if (rawMatch !== 'and' && rawMatch !== 'or') return { error: 'Collection match must be "and" or "or"' };
  const match: DbCollectionMatch = rawMatch;

  let ageRatings: AgeRating[];
  if (payload.ageRatings !== undefined) {
    if (!Array.isArray(payload.ageRatings) || payload.ageRatings.some(value => value !== 'sfw' && value !== 'r15' && value !== 'r18')) {
      return { error: 'Collection ageRatings must be an array of "sfw", "r15", and/or "r18"' };
    }
    ageRatings = (['sfw', 'r15', 'r18'] as AgeRating[]).filter(rating => (payload.ageRatings as AgeRating[]).includes(rating));
  } else if (payload.contentFilter !== undefined) {
    const filter = payload.contentFilter;
    if (filter !== 'sfw' && filter !== 'r15' && filter !== 'r18' && filter !== 'all' && filter !== 'nsfw') {
      return { error: 'Collection contentFilter must be "sfw", "r15", "r18", or "all"' };
    }
    ageRatings = filter === 'all' ? ['sfw', 'r15', 'r18'] : [filter === 'nsfw' ? 'r18' : filter];
  } else {
    ageRatings = existing?.ageRatings ?? ['sfw', 'r15', 'r18'];
  }

  const rawTags = payload.tags === undefined ? existing?.tags ?? [] : payload.tags;
  const tags = normalizeCollectionPayloadTags(rawTags);
  if (tags === null) return { error: 'Collection tags must be an array of tag names up to 80 characters each' };
  if (tags.length > 50) return { error: 'Smart collections support up to 50 tags' };
  if (type === 'smart' && tags.length === 0) return { error: 'Smart collections require at least one tag' };

  return {
    value: {
      name,
      type,
      match,
      ageRatings: type === 'smart' ? ageRatings : ['sfw', 'r15', 'r18'],
      tags: type === 'smart' ? tags : [],
    },
  };
}

function sendCollectionMutationError(res: Response, error: unknown, fallback: string) {
  const message = getErrorMessage(error) || fallback;
  if (message.includes('UNIQUE constraint failed')) {
    return res.status(409).json({ error: 'A collection with that name already exists' });
  }
  console.error(error);
  return res.status(500).json({ error: fallback });
}

router.get('/api/collections', async (req, res) => {
  try {
    const workId = toStringParam(req.query?.workId);
    const collections = await listCollections(req.user!.id, workId);
    res.json(collections);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to list collections' });
  }
});

router.post('/api/collections', async (req, res) => {
  const validated = validateCollectionPayload(req.body);
  if (!validated.value) return res.status(400).json({ error: validated.error });
  try {
    const collection = await createCollection(req.user!.id, validated.value);
    res.status(201).json(collection);
  } catch (error) {
    return sendCollectionMutationError(res, error, 'Failed to create collection');
  }
});

router.get('/api/collections/:id/works', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(toStringParam(req.query?.page) || '1', 10) || 1);
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(toStringParam(req.query?.pageSize) || String(DEFAULT_PAGE_SIZE), 10) || DEFAULT_PAGE_SIZE));
    const sort = toStringParam(req.query?.sort);
    const result = await searchCollectionWorks(req.user!.id, req.params.id, { page, pageSize, sort });
    if (!result) return res.status(404).json({ error: 'Collection not found' });
    res.json(withPaginationMetadata(result));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to list collection works' });
  }
});

router.put('/api/collections/:id/works/:workId', async (req, res) => {
  if (typeof req.body?.included !== 'boolean') {
    return res.status(400).json({ error: 'included must be a boolean' });
  }
  try {
    const collection = await setCollectionWorkMembership(
      req.user!.id,
      req.params.id,
      req.params.workId,
      req.body.included
    );
    if (!collection) return res.status(404).json({ error: 'Collection not found' });
    res.json(collection);
  } catch (error) {
    const message = getErrorMessage(error);
    if (message === 'Work not found') return res.status(404).json({ error: message });
    if (message.includes('Smart collection membership')) return res.status(400).json({ error: message });
    console.error(error);
    res.status(500).json({ error: 'Failed to update collection membership' });
  }
});

router.get('/api/collections/:id', async (req, res) => {
  try {
    const collection = await getCollection(req.user!.id, req.params.id);
    if (!collection) return res.status(404).json({ error: 'Collection not found' });
    res.json(collection);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to get collection' });
  }
});

router.put('/api/collections/:id', async (req, res) => {
  const existing = await getCollection(req.user!.id, req.params.id);
  if (!existing) return res.status(404).json({ error: 'Collection not found' });
  const validated = validateCollectionPayload(req.body, existing);
  if (!validated.value) return res.status(400).json({ error: validated.error });
  try {
    const collection = await updateCollection(req.user!.id, req.params.id, validated.value);
    res.json(collection);
  } catch (error) {
    return sendCollectionMutationError(res, error, 'Failed to update collection');
  }
});

router.delete('/api/collections/:id', async (req, res) => {
  try {
    const deleted = await deleteCollection(req.user!.id, req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Collection not found' });
    res.json({ ok: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to delete collection' });
  }
});

// List circles with summary data (optimized for Circles page)
router.get('/api/circles', async (req, res) => {
  try {
    const nsfw = toStringParam(req.query?.nsfw);
    const selectedRatings = parseAgeRatingsQuery(req.query?.ageRating);
    if (selectedRatings.error) return res.status(400).json({ error: selectedRatings.error });
    const sort = toStringParam(req.query?.sort);
    const circles = await listCircleSummaries({ nsfw, ageRatings: selectedRatings.ratings, sort });
    res.json(circles);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: getErrorMessage(e) || 'Failed to list circles' });
  }
});

export default router;
