import type { VIPMetadata } from "@vilo/vip-types";

export interface VIPPack {
  id: string;
  name: string;
  description: string;
  artifactTypes: string[];
  guidance: string[];
  metadata?: VIPMetadata;
}

export const financialPack: VIPPack = {
  id: "financial",
  name: "Financial",
  description: "Financial intelligence guidance for analysis drafts and approval workflows.",
  artifactTypes: ["financial-brief", "variance-summary", "forecast-note"],
  guidance: [
    "State assumptions clearly.",
    "Do not present projections as guarantees.",
    "Require human approval before sharing externally."
  ]
};
