import axios from './axios'; // HTTP client
import { nameToUUID } from './utils';
import type { ScrapedTag, ScrapedWorkMetadata } from './types';
import { parseSourceAgeRating } from './ageRating';

function langToCookie(language = 'ja-jp') {
  switch (language) {
    case 'zh-cn': return 'locale=zh-cn';
    case 'zh-tw': return 'locale=zh-tw';
    case 'ja': return 'locale=ja-jp';
    case 'ja-jp': return 'locale=ja-jp';
    default: return 'locale=ja-jp';
  }
}

type AsmrOneTag = ScrapedTag & { i18n?: Record<string, { name?: string }> };
type AsmrOneResponse = Omit<ScrapedWorkMetadata, 'tags'> & {
  tags?: AsmrOneTag[];
  age_category?: number | string;
  age_category_string?: string;
};

async function scrapeWorkMetadataFromAsmrOne(
  id: number,
  language = 'ja-jp',
  signal?: AbortSignal,
): Promise<ScrapedWorkMetadata> {
  const url = `https://api.asmr-200.com/api/workInfo/${id}`;
  const response = await axios.retryGet(url, {
    retry: {},
    headers: { "cookie": langToCookie(language) },
    signal,
  });
  const data = response.data as AsmrOneResponse;

  // Normalize voice-actor UUIDs because ASMROne may use different identifiers.
  const vas = Array.isArray(data.vas)
    ? data.vas.map((va) => ({ ...va, id: nameToUUID(va.name) }))
    : [];

  // Normalize tag names to requested language if available
  const tags = Array.isArray(data.tags) ? data.tags : [];
  const langKey = (language || 'ja-jp').toLowerCase();
  const normalizedTags = tags.map((t) => {
    let name = t.name;
    if (t.i18n && typeof t.i18n === 'object') {
      const entry = t.i18n[langKey] || t.i18n['ja-jp'] || t.i18n['zh-cn'] || t.i18n['en-us'];
      if (entry?.name) name = entry.name;
    }
    return { id: t.id, name };
  });

  const ageRating = parseSourceAgeRating(data.age_category_string)
    ?? parseSourceAgeRating(data.age_category)
    ?? (typeof data.nsfw === 'boolean' ? (data.nsfw ? 'r18' : 'sfw') : undefined);
  return { ...data, ageRating, nsfw: ageRating ? ageRating === 'r18' : data.nsfw, tags: normalizedTags, vas };
}

export {
  scrapeWorkMetadataFromAsmrOne,
};
