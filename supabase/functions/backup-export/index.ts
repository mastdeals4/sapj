import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const tables = [
      "products",
      "batches",
      "inventory_transactions",
      "customers",
      "sales_invoices",
      "sales_invoice_items",
      "delivery_challans",
      "delivery_challan_items",
    ];

    const backup: Record<string, unknown[]> = {};

    for (const table of tables) {
      const { data, error } = await supabase.from(table).select("*");
      if (error) throw new Error(`Failed to fetch ${table}: ${error.message}`);
      backup[table] = data ?? [];
    }

    backup["exported_at"] = [new Date().toISOString()] as unknown as unknown[];

    return new Response(JSON.stringify(backup, null, 2), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
