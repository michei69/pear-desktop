import { describe, expect, test } from "vitest";
import type { HostEvent } from "@pear/sdk/protocol";
import { PageRequests } from "../src/main/page-requests.ts";

const details = { videoId: "aaaaaaaaaaa", title: "Song" };

describe("page requests", () => {
  test("concurrent details asks share one round-trip and a later ask starts a new one", async () => {
    const sent: HostEvent[] = [];
    const requests = new PageRequests((event) => sent.push(event));

    const first = requests.songDetails();
    const second = requests.songDetails();
    expect(sent).toHaveLength(1);

    const request = sent[0]!;
    expect(request.type).toBe("plugin-request");
    if (request.type !== "plugin-request") return;
    requests.respond(request.requestId, true, details);

    await expect(first).resolves.toEqual(details);
    await expect(second).resolves.toEqual(details);

    // Settled requests are not cached: the next track asks again.
    void requests.songDetails();
    expect(sent).toHaveLength(2);
  });
});
