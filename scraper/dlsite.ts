import { parse, type HTMLElement } from 'node-html-parser'; // HTML parser

import axios, { isScraperRequestCancelled } from './axios'; // HTTP client
import { nameToUUID, hasLetter } from './utils';
import { scrapeWorkMetadataFromHVDB } from './hvdb';
import { formatID } from '../filesystem/utils';
import type { ScrapedWorkMetadata } from './types';
import { parseSourceAgeRating } from './ageRating';

type SupportedLanguage = 'ja-jp' | 'zh-tw' | 'zh-cn';
type JsonObject = Record<string, unknown>;
const DLSITE_BASE_URL = 'https://www.dlsite.com';

interface LanguageStrings {
  cookie: string;
  ageRatings: string;
  genre: string;
  va: string;
  release: string;
  series: string;
}

const languageMap: Record<SupportedLanguage, LanguageStrings> = {
  'ja-jp': {
    cookie: 'locale=ja-jp',
    ageRatings: '年齢指定',
    genre: 'ジャンル',
    va: '声優',
    release: '販売日',
    series: 'シリーズ名'
  },
  'zh-tw': {
    cookie: 'locale=zh-tw',
    ageRatings: '年齡指定',
    genre: '分類',
    va: '聲優',
    release: '販賣日',
    series: '系列名'
  },
  'zh-cn': {
    cookie: 'locale=zh-cn',
    ageRatings: '年齢指定',
    genre: '分類',
    va: '聲優',
    release: '販賣日',
    series: '系列名'
  }
};

const titlePattern = / \[.+\] \| DLsite$/;

function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function numericRecordValue(value: unknown): Record<string, number> | null {
  if (!isJsonObject(value)) return null;
  const entries = Object.entries(value)
    .map(([key, entry]) => [key, numberValue(entry)] as const)
    .filter((entry): entry is readonly [string, number] => entry[1] !== undefined);
  return Object.fromEntries(entries);
}

function normalizeDlsiteImageUrl(value: unknown, baseUrl: string = DLSITE_BASE_URL): string | null {
  if (typeof value !== 'string') return null;
  const raw = value.trim().replace(/&amp;/g, '&');
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith('//')) return `https:${raw}`;
  if (raw.startsWith('/')) {
    try {
      return new URL(raw, baseUrl).toString();
    } catch {
      return null;
    }
  }
  return null;
}

function collectImageCandidateFromJson(data: JsonObject, baseUrl: string): string | undefined {
  const preferredKeys = [
    'work_image_main',
    'work_image',
    'work_image_l',
    'work_image_large',
    'work_image_m',
    'work_image_s',
    'work_image_thumb',
    'image_main',
    'main_image_url',
    'cover_url',
    'jacket_url',
    'image',
  ];
  const seen = new Set<string>();
  const candidates: string[] = [];
  const push = (input: unknown) => {
    const url = normalizeDlsiteImageUrl(input, baseUrl);
    if (url && !seen.has(url)) {
      seen.add(url);
      candidates.push(url);
    }
  };

  for (const key of preferredKeys) {
    push(data[key]);
  }
  for (const [key, val] of Object.entries(data)) {
    if (!/(cover|jacket|image|img)/i.test(key)) continue;
    if (typeof val === 'string') {
      push(val);
      continue;
    }
    if (Array.isArray(val)) {
      val.forEach((entry) => {
        if (typeof entry === 'string') push(entry);
      });
    }
  }

  return candidates[0];
}

function collectImageCandidateFromHtml(root: HTMLElement, html: string, pageUrl: string): string | undefined {
  const seen = new Set<string>();
  const candidates: string[] = [];
  const push = (input: unknown) => {
    const url = normalizeDlsiteImageUrl(input, pageUrl);
    if (url && !seen.has(url)) {
      seen.add(url);
      candidates.push(url);
    }
  };

  push(root.querySelector('meta[property="og:image"]')?.getAttribute('content'));
  push(root.querySelector('meta[property="og:image:secure_url"]')?.getAttribute('content'));
  push(root.querySelector('meta[name="twitter:image"]')?.getAttribute('content'));
  push(root.querySelector('meta[name="twitter:image:src"]')?.getAttribute('content'));
  push(root.querySelector('meta[itemprop="image"]')?.getAttribute('content'));
  push(root.querySelector('link[rel="image_src"]')?.getAttribute('href'));

  // Fallback for pages where main cover is only present in <img> tags.
  root.querySelectorAll('img').forEach((el) => {
    const src = el.getAttribute('src') || el.getAttribute('data-src');
    const srcset = el.getAttribute('srcset');
    if (src && /(img_main|cover|jacket|work_image)/i.test(src)) push(src);
    if (srcset) {
      const first = srcset.split(',')[0]?.trim().split(/\s+/)[0];
      if (first && /(img_main|cover|jacket|work_image)/i.test(first)) push(first);
    }
  });

  const inlineImageMatches = html.match(/https?:\/\/[^"'\\\s<>]+(?:img_main|cover|jacket|work_image)[^"'\\\s<>]*/ig) || [];
  inlineImageMatches.forEach((v) => {
    push(v);
  });

  return candidates[0];
}

function resolveLanguage(language?: string): LanguageStrings {
  if (language && (language as SupportedLanguage) in languageMap) {
    return languageMap[language as SupportedLanguage];
  }
  return languageMap['ja-jp'];
}

async function hydrateVoiceActors(
  work: ScrapedWorkMetadata,
  id: number,
  signal?: AbortSignal,
): Promise<ScrapedWorkMetadata> {
  if (work.vas.length) return work;
  let metadata: ScrapedWorkMetadata;
  try {
    metadata = await scrapeWorkMetadataFromHVDB(id, signal);
  } catch (error) {
    if (signal?.aborted || isScraperRequestCancelled(error)) throw error;
    console.warn(`[RJ${formatID(id)}] HVDB voice-actor enrichment failed; keeping DLsite metadata.`);
    return work;
  }
  if (metadata.vas.length <= 1) {
    work.vas = metadata.vas;
    return work;
  }

  metadata.vas.forEach((va) => {
    if (!hasLetter(va.name)) {
      work.vas.push(va);
    }
  });
  return work;
}

/**
 * Scrapes static work metadata from public DLsite page HTML.
 * @param {number} id Work id.
 * @param {String} language Tag language: 'ja-jp', 'zh-tw', or 'zh-cn'. Defaults to 'ja-jp'.
 */
const scrapeStaticWorkMetadataFromDLsite = async (
  id: number,
  language?: string,
  signal?: AbortSignal,
): Promise<ScrapedWorkMetadata> => {
  const lang = resolveLanguage(language);
  const rjcode = formatID(id);
  const url = `https://www.dlsite.com/maniax/work/=/product_id/RJ${rjcode}.html`;

  const response = await axios.retryGet<string>(url, {
    retry: {},
    headers: { cookie: lang.cookie }, // Locale request header
    signal,
  });
  const data = response.data as string;

  // Parse the response.
  const root = parse(data);

  const work: ScrapedWorkMetadata = { id, tags: [], vas: [] };

  // Title
  const ogTitle = root.querySelector('meta[property="og:title"]')?.getAttribute('content');
  const fallbackTitle = root.querySelector(`a[href="${url}"] span`)?.textContent;
  const title = ogTitle || fallbackTitle;
  if (title) {
    work.title = title.replace(titlePattern, '');
  }
  const coverUrl = collectImageCandidateFromHtml(root, data, url);
  if (coverUrl) {
    work.cover_url = coverUrl;
  }

  // Circle
  const circleElement = root.querySelector('span.maker_name > a');
  const circleUrl = circleElement?.getAttribute('href');
  const circleName = circleElement?.textContent;
  if (circleUrl && circleName) {
    const circleMatch = /(\d{5,})/.exec(circleUrl);
    work.circle = {
      id: circleMatch ? parseInt(circleMatch[1], 10) : undefined,
      name: circleName
    };
  } else {
    work.circle = {};
  }

  // DLsite may omit tbody; node-html-parser does not insert it like a browser.
  const rows = root.querySelectorAll('#work_outline > tr, #work_outline > tbody > tr');
  const getCell = (label: string) => rows
    .find((row) => row.querySelector('th')?.textContent === label)
    ?.querySelector('td');

  const ratingText = (getCell(lang.ageRatings)?.textContent || '').trim();
  if (/R\s*-?18|18禁|成人向け/i.test(ratingText)) work.ageRating = 'r18';
  else if (/R\s*-?15|15禁/i.test(ratingText)) work.ageRating = 'r15';
  else if (/全年齢|全年齡|全年龄|all\s*ages|general/i.test(ratingText)) work.ageRating = 'sfw';
  if (work.ageRating) work.nsfw = work.ageRating === 'r18';

  // Release date (YYYY-MM-DD)
  const releaseRaw = (getCell(lang.release)?.textContent || '').replace(/[^0-9]/ig, '');
  work.release = (releaseRaw.length >= 8)
    ? `${releaseRaw.slice(0, 4)}-${releaseRaw.slice(4, 6)}-${releaseRaw.slice(6, 8)}`
    : '';

  // Series
  const seriesElement = getCell(lang.series)?.querySelector('a');
  const seriesUrl = seriesElement?.getAttribute('href');
  const seriesMatch = seriesUrl ? /SRI(\d{10})/.exec(seriesUrl) : null;
  if (seriesMatch && seriesElement) {
    work.series = {
      id: parseInt(seriesMatch[1], 10),
      name: seriesElement.textContent
    };
  }

  // Tags
  getCell(lang.genre)?.querySelectorAll('div > a').forEach((el) => {
    const tagUrl = el.getAttribute('href') || '';
    const tagName = el.textContent;
    const match = /genre\/(\d{3})/.exec(tagUrl);
    if (match) {
      work.tags.push({
        id: parseInt(match[1], 10),
        name: tagName
      });
    }
  });

  // Voice actors
  getCell(lang.va)?.querySelectorAll('a').forEach((el) => {
    const vaName = el.textContent.trim();
    if (vaName) {
      work.vas.push({
        id: nameToUUID(vaName),
        name: vaName
      });
    }
  });

  if (work.tags.length === 0 && work.vas.length === 0) {
    throw new Error('Couldn\'t parse data from DLsite work page.');
  }

  return hydrateVoiceActors(work, id, signal);
};

const scrapeStaticWorkMetadataFromDLsiteJson = async (
  id: number,
  language?: string,
  hydrateMissingVoiceActors = true,
  signal?: AbortSignal,
): Promise<ScrapedWorkMetadata> => {
  const lang = (language as SupportedLanguage) || 'ja-jp';
  const rjcode = formatID(id);
  const url = `https://www.dlsite.com/maniax/api/=/product.json?workno=RJ${rjcode}`;

  const work: ScrapedWorkMetadata = { id, tags: [], vas: [] };
  const COOKIE_LOCALE = `locale=${lang}`;

  const response = await axios.retryGet<JsonObject[]>(url, {
    retry: {},
    headers: { cookie: COOKIE_LOCALE }, // Locale request header
    signal,
  });

  const jsonObj = response.data;
  const data = jsonObj[0];
  if (!data) {
    throw new Error('Couldn\'t parse data from DLsite work page.');
  }
  const coverUrl = collectImageCandidateFromJson(data, url);
  if (coverUrl) {
    work.cover_url = coverUrl;
  }

  // Title
  const rawTitle = stringValue(data.product_name);
  if (rawTitle) {
    work.title = rawTitle.replace(titlePattern, '');
  }

  // Circle
  work.circle = {
    id: parseInt(String(data.maker_id).replace('RG', ''), 10),
    name: stringValue(data.maker_name)
  };

  // DLsite: 1 = all ages, 2 = R-15, 3 = R-18.
  work.ageRating = parseSourceAgeRating(data.age_category) ?? parseSourceAgeRating(data.age_category_string);
  if (work.ageRating) work.nsfw = work.ageRating === 'r18';

  // Release date (YYYY-MM-DD)
  const releaseMatch = /\d{4}-\d{2}-\d{2}/.exec(String(data.regist_date));
  work.release = releaseMatch ? releaseMatch[0] : '';

  // Tags
  work.tags = Array.isArray(data.genres)
    ? data.genres
      .filter(isJsonObject)
      .map((v) => ({
        id: numberValue(v.id) ?? String(v.id || ''),
        name: stringValue(v.name) || ''
      }))
      .filter((v) => v.name)
    : [];

  // Voice actors
  const creaters = isJsonObject(data.creaters) ? data.creaters : null;
  work.vas = Array.isArray(creaters?.voice_by)
    ? creaters.voice_by
      .filter(isJsonObject)
      .map((v) => stringValue(v.name))
      .filter((name): name is string => Boolean(name))
      .map((name) => ({
        id: nameToUUID(name),
        name
      }))
    : [];

  if (work.tags.length === 0 && work.vas.length === 0) {
    throw new Error('Couldn\'t parse data from DLsite work page.');
  }

  return hydrateMissingVoiceActors ? hydrateVoiceActors(work, id, signal) : work;
};

type DlsiteDynamicStats = Pick<ScrapedWorkMetadata, 'dl_count' | 'rate_average_2dp' | 'rate_count' | 'rate_count_detail' | 'review_count' | 'price' | 'rank'>;

/**
 * Requests dynamic work metadata from public DLsite API.
 * @param {number} id Work id.
 */
const scrapeDynamicWorkMetadataFromDLsite = async (
  id: number,
  signal?: AbortSignal,
): Promise<Partial<DlsiteDynamicStats>> => {
  const rjcode = formatID(id);
  const url = `https://www.dlsite.com/maniax-touch/product/info/ajax?product_id=RJ${rjcode}`;

  try {
    const response = await axios.retryGet<JsonObject>(url, { retry: {}, signal });
    const payload = response?.data || {};
    const data = payload[`RJ${rjcode}`];

    // When the dynamic API does not return data, fall back to empty stats
    if (!isJsonObject(data)) {
      console.warn(`[RJ${rjcode}] DLsite dynamic API returned no data; continuing with empty stats.`);
      return {};
    }

    const work: Partial<DlsiteDynamicStats> = {};
    if (data.dl_count !== undefined && data.dl_count !== null) {
      work.dl_count = String(data.dl_count); // Download count
    }
    const rateAverage = numberValue(data.rate_average_2dp);
    if (rateAverage !== undefined) work.rate_average_2dp = rateAverage; // Average rating
    const rateCount = numberValue(data.rate_count);
    if (rateCount !== undefined) work.rate_count = rateCount; // Rating count
    if (data.rate_count_detail === null) {
      work.rate_count_detail = null;
    } else {
      const rateCountDetail = numericRecordValue(data.rate_count_detail);
      if (rateCountDetail) work.rate_count_detail = rateCountDetail; // Rating distribution
    }
    const reviewCount = numberValue(data.review_count);
    if (reviewCount !== undefined) work.review_count = reviewCount; // Review count
    const price = numberValue(data.price);
    if (price !== undefined) work.price = price; // Price
    if (Array.isArray(data.rank) && data.rank.length) {
      work.rank = data.rank.filter(isJsonObject) as NonNullable<DlsiteDynamicStats['rank']>; // Rankings
    }
    console.log(`[RJ${rjcode}] 成功从 DLSite 抓取Dynamic元数据...`);
    return work;
  } catch (error: unknown) {
    const axiosError = error as { response?: { status?: number } };
    if (axiosError?.response) {
      throw new Error(`Couldn't request work page HTML (${url}), received: ${axiosError.response.status}.`);
    }
    throw error;
  }
};

async function scrapeDynamicWorkMetadataSafely(
  id: number,
  signal?: AbortSignal,
): Promise<Partial<DlsiteDynamicStats>> {
  try {
    return await scrapeDynamicWorkMetadataFromDLsite(id, signal);
  } catch (error) {
    if (signal?.aborted || isScraperRequestCancelled(error)) throw error;
    const rjcode = formatID(id);
    console.warn(`[RJ${rjcode}] Failed to fetch dynamic metadata: ${(error as Error)?.message || error}. Continuing with static metadata.`);
    return {};
  }
}

/**
 * Scrapes work metadata from public DLsite page HTML.
 * @param {number} id Work id.
 * @param {String} language Tag language: 'ja-jp', 'zh-tw', or 'zh-cn'. Defaults to 'ja-jp'.
 */
const scrapeWorkMetadataFromDLsite = async (id: number, language?: string, signal?: AbortSignal) => {
  const dynamicPromise = scrapeDynamicWorkMetadataSafely(id, signal);
  try {
    const staticData = await scrapeStaticWorkMetadataFromDLsite(id, language, signal);
    if (!staticData.cover_url || !staticData.ageRating) {
      try {
        // The fallback needs only cover and rating. Avoid another HVDB request
        // when both DLsite responses omit voice actors.
        const staticDataFromJson = await scrapeStaticWorkMetadataFromDLsiteJson(id, language, false, signal);
        if (!staticData.cover_url && staticDataFromJson.cover_url) {
          staticData.cover_url = staticDataFromJson.cover_url;
        }
        if (!staticData.ageRating && staticDataFromJson.ageRating) {
          staticData.ageRating = staticDataFromJson.ageRating;
          staticData.nsfw = staticDataFromJson.nsfw;
        }
      } catch (error) {
        if (signal?.aborted || isScraperRequestCancelled(error)) throw error;
        // Keep static HTML data; cover download logic has additional fallbacks.
      }
    }
    const dynamicData = await dynamicPromise;

    return Object.assign({}, staticData, dynamicData);
  } catch (error) {
    // The dynamic request starts in parallel. Always observe its rejection when
    // another branch fails or is cancelled, avoiding an unhandled rejection.
    await dynamicPromise.catch(() => undefined);
    throw error;
  }
};

/**
 * Scrapes work metadata from public DLsite project json api.
 * https://www.dlsite.com/maniax/api/=/product.json?workno=RJ00000000
 * @param {number} id Work id.
 * @param {String} language Tag language: 'ja-jp', 'zh-tw', or 'zh-cn'. Defaults to 'ja-jp'.
 */
const scrapeWorkMetadataFromDLsiteJson = async (id: number, language?: string, signal?: AbortSignal) => {
  const [staticData, dynamicData] = await Promise.all([
    scrapeStaticWorkMetadataFromDLsiteJson(id, language, true, signal),
    scrapeDynamicWorkMetadataSafely(id, signal)
  ]);

  return Object.assign({}, staticData, dynamicData);
};

/**
 * Scrapes the source cover work id which holds the cover image,
 * since some translated work(id_translated) in dlsite do not has its own cover,
 * but share the cover from original cover work(id_source).
 * @param {number} id_translated Work id.
 * @param {String} language Tag language: 'ja-jp', 'zh-tw', or 'zh-cn'. Defaults to 'ja-jp'.
 */
const scrapeCoverIdForTranslatedWorkFromDLsite = async (
  id_translated: number,
  language?: string,
  signal?: AbortSignal,
) => {
  const lang = resolveLanguage(language);
  const rjcode = formatID(id_translated);
  const url = `https://www.dlsite.com/maniax/work/=/product_id/RJ${rjcode}.html`;

  try {
    const response = await axios.retryGet(url, {
      retry: {},
      headers: { cookie: lang.cookie }, // Locale request header
      signal,
    });
    const data = response.data as string;
    const root = parse(data);

    // Collect linked work IDs for the original and all translated editions.
    const linkedIdList = root.querySelectorAll('.work_edition_linklist.type_trans a.work_edition_linklist_item')
      .map((link) => link.getAttribute('href') || '')
      .filter(Boolean)
      .map(h => /RJ((?:\d{6}|\d{8}))/.exec(h))
      .filter((r): r is RegExpExecArray => r != null && r.length >= 2)
      .map(r => r[1]);

    let isNoImgMain = false;

    // Collect image work IDs to determine which linked edition supplies the cover.
    const possibleImageIdList = root.querySelectorAll('img')
      .map((image) => image.getAttribute('srcset') || '')
      .filter(Boolean)
      .map(h => {
        // Most srcset values contain work covers, but some DLsite works use a
        // no-image placeholder instead (for example, RJ166657).
        if (h.includes('no_img_main')) {
          isNoImgMain = true;
        }

        return /RJ((?:\d{6}|\d{8}))[_\w.]+$/.exec(h);
      })
      .filter((r): r is RegExpExecArray => r != null && r.length >= 2)
      .map(r => r[1]);

    const hitId = linkedIdList.find(id => possibleImageIdList.includes(id));

    return {
      coverFromId: hitId || id_translated,
      isNoImgMain,
    };
  } catch (error: unknown) {
    const axiosError = error as { response?: { status?: number } };
    if (axiosError?.response) {
      throw new Error(`Couldn't request work page HTML (${url}), received: ${axiosError.response.status}.`);
    }
    throw error;
  }
};

export {
  normalizeDlsiteImageUrl,
  scrapeWorkMetadataFromDLsite,
  scrapeWorkMetadataFromDLsiteJson,
  scrapeDynamicWorkMetadataFromDLsite,
  scrapeCoverIdForTranslatedWorkFromDLsite,
};
