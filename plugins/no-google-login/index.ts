import { definePlugin } from "@pear/sdk";
import { css } from "@pear/sdk/macros" with { type: "macro" };

export default definePlugin({
  id: "no-google-login",
  name: "Hide sign-in prompts",
  description: "Hides the sign-in link, the sidebar's sign-in promo and the liked-songs tab while signed out.",
  style: css`
    sel(nav_bar.sign_in_link),
    sel(guide.signin_promo),
    ytmusic-pivot-bar-renderer[tab-id="FEmusic_liked"] {
      display: none !important;
    }
  `,
});
