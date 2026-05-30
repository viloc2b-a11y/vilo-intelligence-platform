import { createClient } from "@supabase/supabase-js";
import { loadDotEnvLocal, requireSupabaseEnv } from "./env.js";

interface HealthRow {
  corpus_entries?: number;
  pending_artifact_approvals?: number;
  pending_learning_candidates?: number;
  latest_audit_event_at?: string | null;
  latest_learning_job_at?: string | null;
}

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

  console.log("VIP health check");

  const healthResult = await supabase.from("v_health").select("*").limit(1).maybeSingle();
  if (healthResult.error) {
    fail(
      "Could not read vip.v_health. Confirm vip-schema.sql, vip-memory.sql, and vip-hardening.sql were applied in order.",
      healthResult.error.message
    );
  }

  const countResult = await supabase
    .from("corpus_entries")
    .select("id", { count: "exact", head: true });

  if (countResult.error) {
    fail(
      "Could not query vip.corpus_entries. Confirm the vip schema is installed and exposed to the service role.",
      countResult.error.message
    );
  }

  const health = healthResult.data as HealthRow | null;
  const corpusCount = countResult.count ?? health?.corpus_entries ?? 0;

  console.log("database reachable: yes");
  console.log("vip schema installed: yes");
  console.log("health view readable: yes");
  console.log(`corpus count: ${corpusCount}`);

  if (health) {
    console.log(`pending artifact approvals: ${health.pending_artifact_approvals ?? 0}`);
    console.log(`pending learning candidates: ${health.pending_learning_candidates ?? 0}`);
  }
}

function fail(message: string, detail?: string): never {
  console.error("VIP health check failed");
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
  fail("Unexpected error while checking VIP health.", message);
});
