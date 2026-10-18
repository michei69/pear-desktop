// One owner for the media element's `source → … → destination` path.
//
// Consumers (equalizer, audio-compressor, crossfade) splice their own
// sub-chain into the path; the owner alone wires the edges, so two enabled
// consumers can no longer fight over `source.disconnect(...)` and leave the
// audio summed over several paths. Pure taps (analysers, visualizer gains) and
// context-level routing (setSinkId) are unaffected and need no registration.

type ChainInsert = { input: AudioNode; output: AudioNode };

type Graph = {
  context: AudioContext;
  source: MediaElementAudioSourceNode;
};

let graph: Graph | null = null;
/** Registration order is the signal path order; re-registering keeps it. */
const inserts = new Map<string, ChainInsert>();
/** Edges the owner created in the last rewire, undone before the next one. */
let wired: Array<[AudioNode, AudioNode]> = [];

const connect = (from: AudioNode, to: AudioNode) => {
  from.connect(to);
  wired.push([from, to]);
};

const rewire = () => {
  if (!graph) return;
  for (const [from, to] of wired) {
    try {
      from.disconnect(to);
    } catch {
      // The edge is already gone (a consumer rebuilt its own nodes).
    }
  }
  wired = [];

  let previous: AudioNode = graph.source;
  for (const { input, output } of inserts.values()) {
    connect(previous, input);
    previous = output;
  }
  connect(previous, graph.context.destination);
};

/**
 * The shared graph, created on first access: `createMediaElementSource`
 * permanently reroutes the element's audio, and every consumer is a default-off
 * plugin.
 */
export const getAudioGraph = (video: HTMLVideoElement): Graph => {
  if (!graph) {
    const context = new AudioContext();
    graph = { context, source: context.createMediaElementSource(video) };
    rewire();
  }
  return graph;
};

/**
 * YT Music swaps the `<video>` element on some seeks; the source node stays
 * bound to the old one, so the graph has to be re-cut to the new element.
 * Returns the new source, or null when nothing changed.
 */
export const rebindAudioGraphSource = (
  video: HTMLVideoElement,
): MediaElementAudioSourceNode | null => {
  if (!graph || graph.source.mediaElement === video) return null;
  graph = {
    context: graph.context,
    source: graph.context.createMediaElementSource(video),
  };
  rewire();
  return graph.source;
};

/** Splices `input → … → output` (the consumer's sub-chain) into the path.
 *
 * The consumer owns the edges INSIDE its sub-chain (from `input` to `output`);
 * the owner only connects `previous → input` and `output → next`. A sub-chain
 * whose internal edge is missing produces a dead-end graph and stalls playback. */
export const setAudioChain = (
  id: string,
  input: AudioNode,
  output: AudioNode,
) => {
  inserts.set(id, { input, output });
  rewire();
};

/** Takes the consumer's sub-chain out; the default path returns when empty. */
export const clearAudioChain = (id: string) => {
  if (!inserts.delete(id)) return;
  rewire();
};
