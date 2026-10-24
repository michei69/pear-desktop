import { config } from "@pear/sdk";
import { DEFAULT_ICE_ENTRIES } from "./ice.ts";

export const schema = {
  displayName: config.string("", { label: "Your name", placeholder: "Guest 1234", description: "Shown to others in a session." }),
  // pear-desktop's permissions (it started every session at "playlist").
  defaultPermission: config.select(
    "playlist",
    [
      { value: "host-only", label: "Listen only" },
      { value: "playlist", label: "Change the queue" },
      { value: "all", label: "Full control" },
    ],
    { label: "What guests can do", description: "Default for new sessions; change it any time while hosting." },
  ),
  iceServers: config.list([...DEFAULT_ICE_ENTRIES], {
    label: "STUN and TURN servers",
    description:
      "One per line: `stun:host:port`, or `turn:host:port|username|credential` for a relay. Used for new sessions and the connection test.",
  }),
};
