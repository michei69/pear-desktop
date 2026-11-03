// Segments are an array [ [start, end], … ]
import type { Segment } from './types';

export const sortSegments = (segments: Segment[]) => {
  const sortedSegments = [...segments].sort((segment1, segment2) =>
    segment1[0] === segment2[0]
      ? segment1[1] - segment2[1]
      : segment1[0] - segment2[0],
  );

  const compiledSegments: Segment[] = [];
  let currentSegment: Segment | undefined;

  for (const segment of sortedSegments) {
    if (!currentSegment) {
      currentSegment = [segment[0], segment[1]];
      continue;
    }

    if (currentSegment[1] < segment[0]) {
      compiledSegments.push(currentSegment);
      currentSegment = [segment[0], segment[1]];
      continue;
    }

    currentSegment[1] = Math.max(currentSegment[1], segment[1]);
  }

  if (currentSegment) {
    compiledSegments.push(currentSegment);
  }

  return compiledSegments;
};
