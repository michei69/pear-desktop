import { DEFAULT_WAVE, type Renderer, type Stage } from "../config.ts";
import { loadUmd } from "../load.ts";
import type { Logger } from "@pear/sdk";
import { quietAudio } from "./silent.ts";

interface Animation {
  type: string;
  config: unknown;
}

/**
 * Wave starts an unconditional requestAnimationFrame loop in `_play()`. Patch
 * the bundle so the loop checks an instance flag, which gives us a real stop
 * (its public API only clears the animation list; the loop keeps running).
 */
function patchLoop(source: string) {
  return source.replace("var i=function(){", "var i=function(){if(t._pearStopped)return;");
}

/** Wave's animations; it animates itself. */
export async function waveRenderer({ ctx, graph, canvas }: Stage): Promise<Renderer | undefined> {
  const { context, tap } = quietAudio(ctx, graph);
  const source = await ctx.host.invoke("wave");
  const patched = patchLoop(source);
  if (patched === source) ctx.log.warn("the Wave bundle changed; its frame loop may keep running while paused");
  const { Wave } = await loadUmd<WaveModule>(Promise.resolve(patched));
  if (ctx.signal.aborted) return;
  const wave = new Wave({ context, source: tap }, canvas) as WaveInstance & { _pearStopped?: boolean; _play?(): void };
  const animations = parseAnimations(ctx.config.waveAnimations, ctx.log);
  const addAnimations = () => {
    for (const animation of animations) {
      const Animation = wave.animations[animation.type];
      if (Animation) wave.addAnimation(new Animation(animation.config));
      else ctx.log.warn(`unknown Wave animation ${animation.type}`);
    }
  };
  addAnimations();
  let paused = false;
  const stop = () => {
    wave._pearStopped = true;
    wave.clearAnimations();
  };
  ctx.onCleanup(stop);
  return {
    resize(width, height) {
      canvas.width = width;
      canvas.height = height;
    },
    pause() {
      if (paused) return;
      paused = true;
      stop();
    },
    resume() {
      if (!paused) return;
      paused = false;
      wave._pearStopped = false;
      addAnimations();
      wave._play?.();
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
