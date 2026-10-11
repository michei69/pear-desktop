export type Segment = [number, number];

export interface SkipSegment {
  segment: Segment; // [start, end] in seconds, e.g. [0, 15.23]
  UUID: string;
  category: string; // [1]
  videoDuration: number; // video length at submission time, for staleness checks; 0 when unknown, ±1s
  actionType: string; // [3]
  locked: number; // 1 if the submission is locked
  votes: number;
  description: string; // chapter title, empty for other segments
}
