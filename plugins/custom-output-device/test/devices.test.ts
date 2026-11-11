import { describe, expect, it } from "vitest";
import { outputDevices, resolveOutputDevice } from "../devices.ts";

const device = (deviceId: string, label: string, kind = "audiooutput"): MediaDeviceInfo =>
  ({ deviceId, label, kind, groupId: "", toJSON: () => ({}) }) as MediaDeviceInfo;

describe("output device list", () => {
  it("lists output devices but not Chromium's duplicate default entry", () => {
    const devices = [device("default", "Default"), device("a", "Speakers"), device("b", "Headphones"), device("c", "Camera", "videoinput")];
    expect(outputDevices(devices).map((entry) => entry.deviceId)).toEqual(["a", "b"]);
  });
});

describe("stored output resolution", () => {
  const devices = [device("a", "Speakers"), device("b", "Headphones")];

  it("keeps the system default for an empty setting", () => {
    expect(resolveOutputDevice("", devices)).toBe("");
  });

  it("finds a device by label (what settings stores) or by id", () => {
    expect(resolveOutputDevice("Headphones", devices)).toBe("b");
    expect(resolveOutputDevice("a", devices)).toBe("a");
  });

  it("reports a missing device instead of switching to another one", () => {
    expect(resolveOutputDevice("Studio monitors", devices)).toBeUndefined();
  });
});
