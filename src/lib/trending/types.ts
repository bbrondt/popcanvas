export type TrendingPlatform = 'youtube' | 'tiktok' | 'instagram';

export interface TrendingResult {
  platform: TrendingPlatform;
  /** Canonical watch URL — what we hand to the source-node URL field. */
  url: string;
  title: string;
  /** Square or 16:9 thumbnail URL. May be undefined for hashtag-only results. */
  thumbnail?: string;
  /** Channel name / TikTok handle / IG username. */
  author?: string;
  /** Most relevant engagement metric for ranking; views when available. */
  views?: number;
  likes?: number;
  /** ISO timestamp if the platform exposes it. */
  publishedAt?: string;
  /** First N chars of caption / description, useful for the discover card. */
  description?: string;
}

export interface TrendingSearchInput {
  query: string;
  platforms: TrendingPlatform[];
  /** Per-platform result cap. */
  limit?: number;
}

export interface TrendingSearchResponse {
  results: TrendingResult[];
  /** Per-platform error notes so the UI can show "TikTok unavailable" without failing the whole request. */
  errors: { platform: TrendingPlatform; message: string }[];
}
