import { randomId } from "./crypto";

// Random local-part for an inbox address, e.g. "swift-fox-9a".
const ADJ = ["swift", "calm", "bold", "lunar", "neon", "amber", "cobalt", "vivid", "quiet", "rapid"];
const NOUN = ["fox", "owl", "wave", "pine", "echo", "atlas", "comet", "delta", "ember", "flux"];

export function randomLocal(): string {
  const a = ADJ[Math.floor(Math.random() * ADJ.length)];
  const n = NOUN[Math.floor(Math.random() * NOUN.length)];
  return `${a}-${n}-${randomId(2)}`;
}
