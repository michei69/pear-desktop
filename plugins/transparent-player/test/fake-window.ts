import { vi } from "vitest";

export function fakeWindow() {
  const calls: string[] = [];
  return {
    calls,
    isDestroyed: () => false,
    setBackgroundMaterial: vi.fn((material: string) => void calls.push(`material:${material}`)),
    setVibrancy: vi.fn((vibrancy: string | null) => void calls.push(`vibrancy:${vibrancy}`)),
    setBackgroundColor: vi.fn((color: string) => void calls.push(`background:${color}`)),
  };
}
