import prompt from 'custom-electron-prompt';

import { t } from '@/i18n';
import promptOptions from '@/providers/prompt-options';
import { createBackend } from '@/utils';

export default createBackend({
  start({ ipc: { handle }, window }) {
    handle(
      'peard:captions-selector',
      async (captionLabels: string[], currentIndex: number | null) =>
        await prompt(
          {
            title: t('plugins.captions-selector.prompt.selector.title'),
            label: t('plugins.captions-selector.prompt.selector.label', {
              language:
                (currentIndex === null
                  ? undefined
                  : captionLabels[currentIndex]) ||
                t('plugins.captions-selector.prompt.selector.none'),
            }),
            type: 'select',
            value:
              currentIndex === null || currentIndex < 0
                ? undefined
                : String(currentIndex),
            selectOptions: Object.fromEntries(
              captionLabels.map((captionLabel, index) => [
                String(index),
                captionLabel,
              ]),
            ),
            resizable: true,
            ...promptOptions(),
          },
          window,
        ),
    );
  },
  stop({ ipc: { removeHandler } }) {
    removeHandler('peard:captions-selector');
  },
});
