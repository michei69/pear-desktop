import { test, expect } from '@playwright/test';

import { sortSegments } from '../segments';

test('Segment sorting', () => {
  expect(
    sortSegments([
      [0, 3],
      [7, 8],
      [5, 6],
    ]),
  ).toEqual([
    [0, 3],
    [5, 6],
    [7, 8],
  ]);

  expect(
    sortSegments([
      [0, 5],
      [6, 8],
      [4, 6],
    ]),
  ).toEqual([[0, 8]]);

  expect(
    sortSegments([
      [0, 6],
      [7, 8],
      [4, 6],
    ]),
  ).toEqual([
    [0, 6],
    [7, 8],
  ]);

  expect(
    sortSegments([
      [5, 6],
      [0, 3],
    ]),
  ).toEqual([
    [0, 3],
    [5, 6],
  ]);
});

test('Segment sorting leaves the input untouched', () => {
  const input = [
    [0, 6],
    [7, 8],
    [4, 6],
  ];
  const original = input.map((segment) => [...segment]);

  sortSegments(input);

  expect(input).toEqual(original);
});
