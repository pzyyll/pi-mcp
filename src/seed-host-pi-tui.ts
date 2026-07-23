// ABOUTME: Eagerly resolves host pi-tui under jiti aliases and seeds the peer bridge.
// ABOUTME: Keeps lazy panel chunks free of bare @earendil-works/pi-tui imports.
import { matchesKey, Text, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { seedHostPiTui } from "./host-peers.ts";

seedHostPiTui({
  matchesKey,
  truncateToWidth,
  visibleWidth,
  Text,
});
