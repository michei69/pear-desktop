import type { Renderer, Stage } from "../config.ts";
import { importSource } from "../load.ts";

const INPUT_GAIN = 1.25;

// The loaded module, kept across restarts.
let butterchurn: Promise<ButterchurnModule> | undefined;

/** Milkdrop presets on WebGL; drawn by the page's frame loop. */
export async function butterchurnRenderer({ ctx, graph, canvas, size }: Stage): Promise<Renderer | undefined> {
  butterchurn ??= ctx.host.invoke("butterchurn").then((source) => importSource<ButterchurnModule>(source));
  const [module, preset] = await Promise.all([butterchurn, ctx.host.invoke("preset", ctx.config.preset)]);
  if (ctx.signal.aborted) return;
  // pear-desktop fed butterchurn a little louder than the track.
  const input = graph.context.createGain();
  input.gain.value = INPUT_GAIN;
  ctx.onCleanup(() => input.disconnect());
  graph.tap(input);
  // The canvas is already sized in device pixels, so a pixelRatio as well
  // multiplies its internal buffers by the DPR again (16× the GPU work on a 2×
  // display); pear-desktop rendered at a pixelRatio of 1.
  const visualizer = module.default.createVisualizer(graph.context, canvas, { ...size(), pixelRatio: 1 });
  ctx.onCleanup(() => visualizer.loseGLContext());
  visualizer.connectAudio(input);
  await visualizer.loadPreset(preset, ctx.config.blendTimeInSeconds);
  ctx.player.on("trackChange", (track) => {
    if (ctx.config.songTitle) visualizer.launchSongTitleAnim(`${track.artist} - ${track.title}`);
  });
  return {
    resize(width, height) {
      canvas.width = width;
      canvas.height = height;
      visualizer.setRendererSize(width, height, { pixelRatio: 1 });
    },
    render: () => visualizer.render(),
  };
}
