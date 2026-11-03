import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';

import { APPLICATION_NAME } from '@/i18n';

import { defaultInAppMenuConfig, type InAppMenuConfig } from './constants';
import { TitleBar } from './renderer/TitleBar';

import type { RendererContext } from '@/types/contexts';

const isMacOS = navigator.userAgent.includes('Macintosh');
const isNotWindowsOrMacOS =
  !navigator.userAgent.includes('Windows') && !isMacOS;

const [config, setConfig] = createSignal<InAppMenuConfig>(
  defaultInAppMenuConfig,
);

let disposeTitleBar: (() => void) | undefined;

export const onRendererLoad = async ({
  getConfig,
  ipc,
}: RendererContext<InAppMenuConfig>) => {
  setConfig(await getConfig());

  document.title = APPLICATION_NAME;

  disposeTitleBar = render(
    () => (
      <TitleBar
        enableController={
          isNotWindowsOrMacOS && !config().hideDOMWindowControls
        }
        initialCollapsed={window.mainConfig.get('options.hideMenu')}
        ipc={ipc}
        isMacOS={isMacOS}
      />
    ),
    document.body,
  );
};

export const onRendererStop = () => {
  disposeTitleBar?.();
  disposeTitleBar = undefined;
};

export const onConfigChange = (newConfig: InAppMenuConfig) => {
  setConfig(newConfig);
};
