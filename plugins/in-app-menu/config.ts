import { config } from "@pear/sdk";

export const inAppMenuConfig = {
  windowControls: config.bool(true, {
    label: "Show window buttons",
    description: "Minimize, maximize and close on Linux. Turn off if your window manager provides its own.",
    // Only the Linux page draws them: Windows has native caption buttons, macOS its traffic lights.
    platforms: ["linux"],
  }),
};
