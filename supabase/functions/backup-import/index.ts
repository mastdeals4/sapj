import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import postgres from "npm:postgres@3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const REQUIRED_TABLES = [
  "products",
  "customers",
  "batches",
  "sales_invoices",
  "sales_invoice_items",
  "delivery_challans",
  "delivery_challan_items",
  "inventory_transactions",
] as const;

type TableName = typeof REQUIRED_TABLES[number];

type BackupPayload = {
  [K in TableName]?: Record<string, unknown>[];
} & { exported_at?: unknown };

function validateStructure(body: unknown): BackupPayload {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new Error("Payload must be a JSON object");
  }
  const obj = body as Record<string, unknown>;
  for (const table of REQUIRED_TABLES) {
    if (!(table in obj)) {
      throw new Error(`Missing required table: ${table}`);
    }
    if (!Array.isArray(obj[table])) {
      throw new Error(`Table "${table}" must be an array`);
    }
  }
  return obj as BackupPayload;
}

function buildUpsertQuery(
  table: string,
  rows: Record<string, unknown>[],
  conflictColumn: string
): { text: string; values: unknown[] } | null {
  if (rows.length === 0) return null;

  const keys = Object.keys(rows[0]);
  if (keys.length === 0) return null;

  const columnList = keys.map((k) => `"${k}"`).join(", ");
  const updateSet = keys
    .filter((k) => k !== conflictColumn)
    .map((k) => `"${k}" = EXCLUDED."${k}"`)
    .join(", ");

  const placeholderRows: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  for (const row of rows) {
    const placeholders = keys.map(() => `$${idx++}`).join(", ");
    placeholderRows.push(`(${placeholders})`);
    for (const key of keys) {
      const val = row[key];
      values.push(val === undefined ? null : val);
    }
  }

  const text = `
    INSERT INTO "${table}" (${columnList})
    VALUES ${placeholderRows.join(", ")}
    ON CONFLICT ("${conflictColumn}") DO UPDATE SET ${updateSet}
  `;

  return { text, values };
}

const CONFLICT_COLUMNS: Record<TableName, string> = {
  products: "id",
  customers: "id",
  batches: "id",
  sales_invoices: "id",
  sales_invoice_items: "id",
  delivery_challans: "id",
  delivery_challan_items: "id",
  inventory_transactions: "id",
};

const INSERT_ORDER: TableName[] = [
  "products",
  "customers",
  "batches",
  "sales_invoices",
  "sales_invoice_items",
  "delivery_challans",
  "delivery_challan_items",
  "inventory_transactions",
];

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: profile } = await adminClient
      .from("user_profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();

    if (!profile || profile.role !== "admin") {
      return new Response(JSON.stringify({ error: "Only admins can import backups" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const payload = validateStructure(body);

    const dbUrl = Deno.env.get("SUPABASE_DB_URL");
    if (!dbUrl) {
      throw new Error("Database URL not configured");
    }

    const sql = postgres(dbUrl, { max: 1 });

    try {
      await sql.begin(async (tx) => {
        for (const table of INSERT_ORDER) {
          const rows = payload[table] ?? [];
          if (rows.length === 0) continue;

          const conflictCol = CONFLICT_COLUMNS[table];
          const query = buildUpsertQuery(table, rows, conflictCol);
          if (!query) continue;

          await tx.unsafe(query.text, query.values as never[]);
        }
      });
    } finally {
      await sql.end();
    }

    const counts: Record<string, number> = {};
    for (const table of INSERT_ORDER) {
      counts[table] = payload[table]?.length ?? 0;
    }

    return new Response(
      JSON.stringify({ success: true, imported: counts }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    const message = (err as Error).message ?? "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
