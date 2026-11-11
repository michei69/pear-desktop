/** The output devices that can be picked: the system default is listed separately. */
export function outputDevices(devices: readonly MediaDeviceInfo[]): MediaDeviceInfo[] {
  return devices.filter((device) => device.kind === "audiooutput" && device.deviceId !== "default");
}

/**
 * The device id the stored setting names. The config keeps the label, which is
 * readable in the settings card and survives deviceId churn; a deviceId also
 * works. "" is the system default; undefined means the device is gone (stay on
 * the current output until it is back).
 */
export function resolveOutputDevice(wanted: string, devices: readonly Pick<MediaDeviceInfo, "deviceId" | "label">[]): string | undefined {
  if (!wanted) return "";
  return devices.find((device) => device.label === wanted || device.deviceId === wanted)?.deviceId;
}
