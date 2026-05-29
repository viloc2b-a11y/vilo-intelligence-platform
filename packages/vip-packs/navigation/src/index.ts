import type { VIPMetadata } from "@vilo/vip-types";

export interface VIPPack {
  id: string;
  name: string;
  description: string;
  artifactTypes: string[];
  guidance: string[];
  metadata?: VIPMetadata;
}

export const navigationPack: VIPPack = {
  id: "navigation",
  name: "Navigation",
  description: "Navigation intelligence guidance for routing, handoff, and next-best-action drafts.",
  artifactTypes: ["navigation-plan", "handoff-brief", "next-action-summary"],
  guidance: [
    "Prefer clear next actions over broad commentary.",
    "Identify missing context before recommending escalation.",
    "Require human approval before sending instructions to external systems."
  ]
};
