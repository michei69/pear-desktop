import { Mutex } from 'async-mutex';

import { createRenderer } from '@/utils';

import type { CustomOutputPluginConfig } from './index';
import type { RendererContext } from '@/types/contexts';

const DEVICES_MUTEX = new Mutex();

const updateDeviceList = async (
  context: RendererContext<CustomOutputPluginConfig>,
) => {
  const release = await DEVICES_MUTEX.acquire();

  try {
    const newDevices: [string, string][] = [];
    const devices = await navigator.mediaDevices.enumerateDevices();
    for (const device of devices) {
      if (device.kind !== 'audiooutput') continue;

      newDevices.push([device.deviceId, device.label]);
    }

    // setConfig deep-merges objects, so a record would keep the ids of devices
    // that are gone. An array is replaced wholesale, which is what clearing a
    // device means here.
    await context.setConfig({ devices: newDevices });
  } finally {
    release();
  }
};

const updateSinkId = async (
  audioContext?: AudioContext & {
    setSinkId?: (sinkId: string) => Promise<void>;
  },
  sinkId?: string,
) => {
  if (!audioContext || !sinkId) return;
  if (!('setSinkId' in audioContext)) return;
  if (typeof audioContext.setSinkId !== 'function') return;

  await audioContext.setSinkId(sinkId);
};

export const renderer = createRenderer<
  {
    options?: CustomOutputPluginConfig;
    audioContext?: AudioContext;
    audioCanPlayHandler: (event: CustomEvent<Compressor>) => Promise<void>;
  },
  CustomOutputPluginConfig
>({
  async audioCanPlayHandler({ detail: { audioContext } }) {
    this.audioContext = audioContext;
    await updateSinkId(audioContext, this.options!.output);
  },

  async start(context) {
    this.options = await context.getConfig();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });
      // Only the permission grant is needed to expose device labels; holding
      // the capture stream open would keep the microphone busy for nothing.
      for (const track of stream.getTracks()) {
        track.stop();
      }
    } catch (error) {
      // No capture device or permission denied: the output sink can still be
      // set on the audio context, so carry on.
      console.warn('custom-output-device: no audio input available', error);
    }
    navigator.mediaDevices.ondevicechange = async () =>
      await updateDeviceList(context);

    document.addEventListener(
      'peard:audio-can-play',
      this.audioCanPlayHandler,
      {
        once: true,
        passive: true,
      },
    );
    await updateDeviceList(context);
  },

  stop() {
    document.removeEventListener(
      'peard:audio-can-play',
      this.audioCanPlayHandler,
    );
    navigator.mediaDevices.ondevicechange = null;
  },

  async onConfigChange(config) {
    this.options = config;
    await updateSinkId(this.audioContext, config.output);
  },
});
