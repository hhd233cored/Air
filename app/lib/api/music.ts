import { apiGet } from "./client";

export type MusicTrackSummary = {
  id: string;
  title: string;
  artist: string;
  album: string | null;
  coverUrl: string | null;
  durationMs: number | null;
  canPlay: boolean;
  freeTrial: boolean;
};

export type MusicPlaylistPayload = {
  playlistId: string;
  source: "local" | "netease";
  tracks: MusicTrackSummary[];
  available: boolean;
  message: string | null;
};

export type MusicTrackUrlPayload = {
  id: string;
  playUrl: string | null;
  expiresAt: number | null;
  durationMs: number | null;
  canPlay: boolean;
  message: string | null;
};

export function getMusicPlaylist() {
  return apiGet<MusicPlaylistPayload>("/music/playlist");
}

export function getMusicTrackUrl(trackId: string) {
  return apiGet<MusicTrackUrlPayload>(`/music/tracks/${encodeURIComponent(trackId)}/url`);
}
