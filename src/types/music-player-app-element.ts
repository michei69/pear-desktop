import { type AppAPI } from './queue';

// TODO: merge with the one in queue.ts
export interface MusicPlayerAppElement extends HTMLElement, AppAPI {
  navigate(page: string): void;
  networkManager: {
    fetch: <ReturnType, Data>(url: string, data: Data) => Promise<ReturnType>;
  };
}
