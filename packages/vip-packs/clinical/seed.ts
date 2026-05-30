import { createClient } from "@supabase/supabase-js";
import { loadDotEnvLocal, requireSupabaseEnv } from "../../../scripts/env.js";

interface ClinicalSeedEntry {
  source_id: string;
  title: string;
  body: string;
  tags: string[];
  evidence: Array<{
    source_type: string;
    source_id: string;
    quote: string;
  }>;
  metadata: Record<string, unknown>;
}

const SOURCE_TYPE = "vip-pack-clinical-seed";

const entries: ClinicalSeedEntry[] = [
  {
    source_id: "clinical.screening_visit_source_template",
    title: "Screening Visit Source Template",
    body: "Capture inclusion and exclusion review, informed consent status, screening procedures, relevant medical history, concomitant medications, and eligibility disposition.",
    tags: ["clinical", "screening", "source-template"],
    evidence: [
      {
        source_type: "vip_pack_seed",
        source_id: "clinical.screening_visit_source_template",
        quote: "Screening visit source templates should support eligibility and consent review."
      }
    ],
    metadata: {
      seed_version: 1,
      pattern_type: "source_template"
    }
  },
  {
    source_id: "clinical.baseline_visit_source_template",
    title: "Baseline Visit Source Template",
    body: "Document baseline assessments, randomization or enrollment status, pre-dose requirements, protocol-required measurements, and baseline safety observations.",
    tags: ["clinical", "baseline", "source-template"],
    evidence: [
      {
        source_type: "vip_pack_seed",
        source_id: "clinical.baseline_visit_source_template",
        quote: "Baseline documentation should establish pre-intervention clinical status."
      }
    ],
    metadata: {
      seed_version: 1,
      pattern_type: "source_template"
    }
  },
  {
    source_id: "clinical.visit_window_pattern",
    title: "Visit Window Pattern",
    body: "Represent visit windows with anchor event, target day, allowed early and late bounds, timezone assumptions, and escalation guidance when visits fall outside protocol windows.",
    tags: ["clinical", "visit-window", "schedule"],
    evidence: [
      {
        source_type: "vip_pack_seed",
        source_id: "clinical.visit_window_pattern",
        quote: "Visit windows require explicit anchors and allowed date boundaries."
      }
    ],
    metadata: {
      seed_version: 1,
      pattern_type: "operational_pattern"
    }
  },
  {
    source_id: "clinical.protocol_deviation_documentation_pattern",
    title: "Protocol Deviation Documentation Pattern",
    body: "Protocol deviation records should describe what occurred, when it occurred, why it occurred, participant impact, corrective action, preventive action, and reporting status.",
    tags: ["clinical", "protocol-deviation", "documentation"],
    evidence: [
      {
        source_type: "vip_pack_seed",
        source_id: "clinical.protocol_deviation_documentation_pattern",
        quote: "Deviation documentation should include impact assessment and corrective action."
      }
    ],
    metadata: {
      seed_version: 1,
      pattern_type: "documentation_pattern"
    }
  },
  {
    source_id: "clinical.21_cfr_part_11_audit_trail_pattern",
    title: "21 CFR Part 11 Audit Trail Pattern",
    body: "Electronic records should preserve attributable, timestamped, computer-generated audit trail events for creation, modification, review, approval, and deletion-sensitive actions.",
    tags: ["clinical", "part-11", "audit-trail"],
    evidence: [
      {
        source_type: "vip_pack_seed",
        source_id: "clinical.21_cfr_part_11_audit_trail_pattern",
        quote: "Audit trails should preserve who changed what, when, and why."
      }
    ],
    metadata: {
      seed_version: 1,
      pattern_type: "compliance_pattern"
    }
  }
];

async function main(): Promise<void> {
  loadDotEnvLocal();
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = requireSupabaseEnv();

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    },
    db: {
      schema: "vip"
    }
  });

  console.log("Seeding VIP clinical pack corpus entries");

  const sourceIds = entries.map((entry) => entry.source_id);
  const existingResult = await supabase
    .from("corpus_entries")
    .select("source_id")
    .eq("source_type", SOURCE_TYPE)
    .in("source_id", sourceIds);

  if (existingResult.error) {
    fail(
      "Could not read existing clinical seed entries. Confirm vip-schema.sql has been applied.",
      existingResult.error.message
    );
  }

  const existingSourceIds = new Set(
    (existingResult.data ?? [])
      .map((row) => row.source_id)
      .filter((sourceId): sourceId is string => typeof sourceId === "string")
  );
  const missingEntries = entries.filter((entry) => !existingSourceIds.has(entry.source_id));

  if (missingEntries.length === 0) {
    console.log("clinical seed status: already up to date");
    console.log(`inserted: 0`);
    console.log(`total seed entries: ${entries.length}`);
    return;
  }

  const insertResult = await supabase.from("corpus_entries").insert(
    missingEntries.map((entry) => ({
      tenant_id: null,
      pack_id: "clinical",
      source_type: SOURCE_TYPE,
      source_id: entry.source_id,
      title: entry.title,
      body: entry.body,
      tags: entry.tags,
      evidence: entry.evidence,
      metadata: entry.metadata,
      embedding: null,
      status: "active"
    }))
  );

  if (insertResult.error) {
    fail("Could not insert clinical seed entries.", insertResult.error.message);
  }

  console.log("clinical seed status: complete");
  console.log(`inserted: ${missingEntries.length}`);
  console.log(`skipped existing: ${entries.length - missingEntries.length}`);
  console.log(`total seed entries: ${entries.length}`);
}

function fail(message: string, detail?: string): never {
  console.error("VIP clinical seed failed");
  console.error(message);

  if (detail) {
    console.error(`Detail: ${sanitize(detail)}`);
  }

  process.exit(1);
}

function sanitize(message: string): string {
  return message
    .replace(/service_role_[A-Za-z0-9._-]+/g, "[redacted]")
    .replace(/eyJ[A-Za-z0-9._-]+/g, "[redacted]");
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  fail("Unexpected error while seeding the clinical pack.", message);
});
