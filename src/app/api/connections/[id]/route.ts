import { NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * DELETE /api/connections/:id  — disconnect (drop the row, RLS-scoped)
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("connected_accounts").delete().eq("id", id);
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
  return new Response(null, { status: 204 });
}

/**
 * PATCH /api/connections/:id  — update label or company mapping
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = (await req.json()) as { account_label?: string; company_id?: string | null };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("connected_accounts")
    .update({
      ...(body.account_label !== undefined && { account_label: body.account_label }),
      ...(body.company_id !== undefined && { company_id: body.company_id }),
    })
    .eq("id", id);
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
  return new Response(null, { status: 204 });
}
