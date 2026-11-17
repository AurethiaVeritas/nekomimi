import { parse } from 'node-html-parser'; // HTML parser

import axios from './axios'; // HTTP client
import { nameToUUID } from './utils';
import { formatID } from '../filesystem/utils';
import type { ScrapedWorkMetadata } from './types';

// Parse complete voice-actor names; the previous implementation captured only the final character.
function scrapeHvdbHtml(data: string): ScrapedWorkMetadata {
  const root = parse(data);
  const work: ScrapedWorkMetadata = { tags: [], vas: [] };
  work.title = root.querySelector('input#Name')?.getAttribute('value') || undefined;

  function getId(text?: string | null) {
    if (!text) return '';
    const reMatch = /\/(\d*)$/.exec(text);
    return reMatch ? reMatch[1] : "";
  }

  // circle
  const circleElement = root.querySelector('a.detailCircle');
  const circleName = circleElement?.textContent || '';
  work.circle = {
    id: getId(circleElement?.getAttribute('href')),
    name: circleName.split("/")[0]?.trim()
  };

  // sfw
  work.nsfw = !root.querySelector('input[name="SFW"]')?.hasAttribute('checked');
  work.ageRating = work.nsfw ? 'r18' : 'sfw';

  // tags
  root.querySelectorAll('a[href*="TagWorks"]').forEach((elem) => {
    work.tags.push({
      id: getId(elem.getAttribute('href')),
      name: elem.textContent,
    });
  })

  // vas
  root.querySelectorAll('a[href*="CVWorks"]').forEach((elem) => {
    const cvName = elem.textContent;
    work.vas.push({
      id: nameToUUID(cvName),
      name: cvName,
    });
  })

  return work;
}

/**
 * Scrapes work metadata from public HVDB page HTML.
 * @param {number} id Work id.
 */
const scrapeWorkMetadataFromHVDB = async (id: number, signal?: AbortSignal): Promise<ScrapedWorkMetadata> => {
  const rjcode = formatID(id);
  const url = `https://hvdb.me/Dashboard/WorkDetails/${id}`;

  console.log(`[RJ${rjcode}] 从 HVDB 抓取元数据...`);
  try {
    const response = await axios.retryGet(url, { retry: {}, signal });
    const work = scrapeHvdbHtml(String(response.data));
    work.id = id;

    if (work.tags.length === 0 && work.vas.length === 0) {
      throw new Error('Couldn\'t parse data from HVDB work page.');
    }
    console.log(`[RJ${rjcode}] 成功从 HVDB 抓取元数据...`);
    return work;
  } catch (error: unknown) {
    const requestError = error as { response?: { status?: number } };
    if (requestError.response) {
      throw new Error(`Couldn't request work page HTML (${url}), received: ${requestError.response.status}.`);
    }
    throw error;
  }
};

export {
  scrapeWorkMetadataFromHVDB,
};
