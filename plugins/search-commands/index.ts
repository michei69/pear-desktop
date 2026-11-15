import { type ConfigOf, type HostContext, definePlugin } from "@pear/sdk";
import { schema } from "./config.ts";
import { startSearchCommands } from "./page.ts";
import { SPOTLIGHT_CSS } from "./style.ts";

/** The host command of the same name would shadow itself through `this`, so the method lives outside the object. */
function openSettingsCommand(this: HostContext<ConfigOf<typeof schema>>) {
  this.openSettings();
}

export default definePlugin({
  id: "search-commands",
  name: "Search commands",
  description: "Slash commands in the search box, with a Spotlight-style shortcut.",
  enabledByDefault: true,
  config: schema,
  style: SPOTLIGHT_CSS,
  host: {
    commands: {
      /** Used by the page's `/settings` command. */
      openSettings: openSettingsCommand,
    },
  },
  page: startSearchCommands,
});
