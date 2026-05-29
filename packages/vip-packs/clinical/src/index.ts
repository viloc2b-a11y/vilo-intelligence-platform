import type { VIPMetadata } from "@vilo/vip-types";

export interface VIPPack {
  id: string;
  name: string;
  description: string;
  artifactTypes: string[];
  guidance: string[];
  metadata?: VIPMetadata;
}

export const clinicalPack: VIPPack = {
  id: "clinical",
  name: "Clinical",
  description: "Clinical operations guidance for draft generation and review workflows.",
  artifactTypes: ["care-summary", "clinical-ops-brief", "risk-review"],
  guidance: [
    "Preserve clinical nuance and uncertainty.",
    "Separate observed facts from recommendations.",
    "Require human review before operational use."
  ]
};
