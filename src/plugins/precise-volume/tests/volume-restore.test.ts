import { expect, test } from '@playwright/test';
import { Window } from 'happy-dom';

import { restoreVolumeScript } from '../renderer';

type Dispatch = { type: string; payload?: unknown };

const setup = () => {
  const window = new Window();
  const document = window.document;
  const volumes: number[] = [];
  const dispatches: Dispatch[] = [];

  const addPlayer = () => {
    const player = document.createElement('div');
    player.id = 'movie_player';
    Object.assign(player, {
      setVolume: (volume: number) => volumes.push(volume),
    });
    document.body.append(player);
    return player;
  };

  const addApp = () => {
    const app = document.createElement('ytmusic-app');
    Object.assign(app, {
      dispatch: (action: Dispatch) => dispatches.push(action),
    });
    document.body.append(app);
    return app;
  };

  const run = (volume: number) => {
    window.eval(restoreVolumeScript(volume));
  };

  return {
    addApp,
    addPlayer,
    close: () => window.happyDOM.close(),
    dispatches,
    run,
    volumes,
  };
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

test('a restored volume also updates the player bar state', async () => {
  const page = setup();
  try {
    page.addPlayer();
    page.addApp();

    page.run(20);

    expect(page.volumes).toEqual([20]);
    expect(page.dispatches).toEqual([{ type: 'SET_VOLUME', payload: 20 }]);
  } finally {
    await page.close();
  }
});

test('applies the volume once the player appears', async () => {
  const page = setup();
  try {
    page.run(35);
    expect(page.volumes).toEqual([]);

    page.addPlayer();
    page.addApp();
    await flush();

    expect(page.volumes).toEqual([35]);
    expect(page.dispatches).toEqual([{ type: 'SET_VOLUME', payload: 35 }]);
  } finally {
    await page.close();
  }
});

test('stops watching after applying the volume', async () => {
  const page = setup();
  try {
    page.run(50);
    const player = page.addPlayer();
    page.addApp();
    await flush();
    expect(page.volumes).toEqual([50]);

    player.remove();
    page.addPlayer();
    await flush();

    expect(page.volumes).toEqual([50]);
  } finally {
    await page.close();
  }
});
