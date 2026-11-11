import { DEFAULT_WAVE, type Renderer, type Stage } from "../config.ts";
import { loadUmd } from "../load.ts";
import type { Logger } from "@pear/sdk";
import { quietAudio } from "./silent.ts";

interface Animation {
  type: string;
  config: unknown;
}

/** Wave's animations; it animates itself. */
export async function waveRenderer({ ctx, graph, canvas }: Stage): Promise<Renderer | undefined> {
  const { context, tap } = quietAudio(ctx, graph);
  const { Wave } = await loadUmd<WaveModule>(ctx.host.invoke("wave"));
  if (ctx.signal.aborted) return;
  const wave = new Wave({ context, source: tap }, canvas);
  const animations = parseAnimations(ctx.config.waveAnimations, ctx.log);
  const addAnimations = () => {
    for (const animation of animations) {
      const Animation = wave.animations[animation.type];
      if (Animation) wave.addAnimation(new Animation(animation.config));
      else ctx.log.warn(`unknown Wave animation ${animation.type}`);
    }
  };
  addAnimations();
  ctx.onCleanup(() => wave.clearAnimations());
  let paused = false;
  return {
    resize(width, height) {
      canvas.width = width;
      canvas.height = height;
    },
    // Wave's own requestAnimationFrame loop can't be stopped from outside; its
    // animations can, which is what pear-desktop's pause() did.
    pause() {
      if (paused) return;
      paused = true;
      wave.clearAnimations();
    },
    resume() {
      if (!paused) return;
      paused = false;
      addAnimations();
    },
  };
}

function parseAnimations(json: string, log: Logger): Animation[] {
  try {
    const parsed: unknown = JSON.parse(json || "[]");
    if (!Array.isArray(parsed)) throw new Error("expected an array");
    return parsed.filter((item): item is Animation => typeof item?.type === "string");
  } catch (error) {
    log.warn("ignoring invalid Wave animations", error);
    return DEFAULT_WAVE;
  }
}
