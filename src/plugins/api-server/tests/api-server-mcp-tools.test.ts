/**
 * The MCP tool table's wiring: every tool is named for the operation it calls,
 * and its handler passes the validated arguments and maps the outcome. The
 * protocol side is covered in `api-server-mcp.test.ts`; the tools are thin
 * enough that a fake `Operations` is enough here.
 */
import { expect, test } from '@playwright/test';

import { createMcpTools } from '../backend/mcp-tools';

import type { Operations, Outcome } from '../backend/operations';

/** Records an operation call, and answers with whatever the test set up. */
const createFakeOperations = () => {
  const calls: { name: string; args: unknown[] }[] = [];

  const record = (name: string, result?: unknown) => {
    return (...args: unknown[]) => {
      calls.push({ name, args });
      return result;
    };
  };

  return {
    calls,
    operations: {
      play: record('play'),
      nextVideo: record('nextVideo'),
      previousVideo: record('previousVideo'),
      setPlaybackSpeed: record('setPlaybackSpeed'),
      moveInQueue: record('moveInQueue'),
      playing: () => true,
      volume: () => 40,
      downloadVideo: record(
        'downloadVideo',
        Promise.resolve<Outcome>({ ok: true, value: undefined }),
      ),
      lyrics: record(
        'lyrics',
        Promise.resolve<Outcome>({
          ok: false,
          status: 404,
          error: 'The synced-lyrics plugin is disabled.',
        }),
      ),
    } as unknown as Operations,
  };
};

const tool = (name: string) => {
  const { calls, operations } = createFakeOperations();
  const found = createMcpTools(operations).find((it) => it.name === name);
  if (!found) throw new Error(`no tool named ${name}`);

  return { calls, run: found.run };
};

test('every tool has a unique snake-case name and a description', () => {
  const { operations } = createFakeOperations();
  const tools = createMcpTools(operations);
  const names = tools.map(({ name }) => name);

  expect(tools).toHaveLength(49);
  expect(new Set(names).size).toBe(names.length);
  for (const { name, description } of tools) {
    expect(name).toMatch(/^[a-z][a-z0-9_]*$/);
    expect(description.length).toBeGreaterThan(0);
  }
});

test('query-like tools take real booleans, not query strings', () => {
  const { operations } = createFakeOperations();
  const tools = createMcpTools(operations);
  const inputOf = (name: string) => tools.find((it) => it.name === name)?.input;

  expect(inputOf('queue')?.safeParse({ raw: true }).success).toBe(true);
  expect(
    inputOf('playback_position')?.safeParse({ percentage: true }).success,
  ).toBe(true);
  expect(inputOf('autoplay')?.safeParse({ raw: true }).success).toBe(true);
  // The query-string form is not part of the tool contract.
  expect(inputOf('queue')?.safeParse({ raw: 'true' }).success).toBe(false);
});

test('getters are marked read-only, commands are not', () => {
  const { operations } = createFakeOperations();
  const tools = createMcpTools(operations);
  const readOnly = (name: string) =>
    tools.find((it) => it.name === name)?.readOnly;

  expect(readOnly('playing')).toBe(true);
  expect(readOnly('play')).toBeUndefined();
});

test('a command tool calls its operation', async () => {
  const { calls, run } = tool('play');

  await run({});

  expect(calls).toEqual([{ name: 'play', args: [] }]);
});

test('a tool passes its arguments through to the operation', async () => {
  const { calls, run } = tool('move_in_queue');

  await run({ index: 2, toIndex: 9 });

  expect(calls).toEqual([{ name: 'moveInQueue', args: [2, 9] }]);
});

test('a getter tool answers with the operation value', async () => {
  const { run } = tool('volume');

  expect(await run({})).toEqual({
    content: [{ type: 'text', text: JSON.stringify({ volume: 40 }) }],
  });
});

test('an operation failure becomes a tool error with its message', async () => {
  const { run } = tool('lyrics');

  expect(await run({})).toEqual({
    isError: true,
    content: [{ type: 'text', text: 'The synced-lyrics plugin is disabled.' }],
  });
});

test('a successful command answers "Success"', async () => {
  const { run } = tool('download_video');

  expect(await run({ videoId: 'abc' })).toEqual({
    content: [{ type: 'text', text: 'Success' }],
  });
});
