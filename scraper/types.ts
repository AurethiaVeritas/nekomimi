import type { AgeRating, RankEntry, RateCountDetail } from '../types/shared';

export interface ScrapedTag {
  id: number | string;
  name: string;
}

export interface ScrapedPerson {
  id: number | string;
  name: string;
}

export interface ScrapedSeries {
  id?: number | string;
  name?: string;
}

export interface ScrapedCircle {
  id?: number | string;
  name?: string;
}

export interface ScrapedWorkMetadata {
  id?: number;
  title?: string;
  cover_url?: string;
  circle?: ScrapedCircle;
  nsfw?: boolean;
  ageRating?: AgeRating;
  release?: string;
  series?: ScrapedSeries;
  tags: ScrapedTag[];
  vas: ScrapedPerson[];
  dl_count?: string;
  rate_average_2dp?: number;
  rate_count?: number;
  rate_count_detail?: RateCountDetail | null;
  review_count?: number;
  price?: number;
  rank?: RankEntry[];
}
