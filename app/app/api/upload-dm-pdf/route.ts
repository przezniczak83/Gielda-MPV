import { NextResponse }  from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const supabaseUrl    = process.env.NEXT_PUBLIC_SUPABASE_URL    ?? "";
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY   ?? "";
  const supabaseRef    = supabaseUrl.match(/https:\/\/([^.]+)/)?.[1] ?? "";

  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json({ ok: false, error: "Missing env vars" }, { status: 500 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid form data" }, { status: 400 });
  }

  const institution = (formData.get("institution") as string | null)?.trim() ?? "";
  const report_date = (formData.get("report_date") as string | null)?.trim() ?? "";
  const file        = formData.get("file") as File | null;

  if (!file || file.type !== "application/pdf") {
    return NextResponse.json({ ok: false, error: "PDF file required" }, { status: 400 });
  }
  if (file.size > 20 * 1024 * 1024) {
    return NextResponse.json({ ok: false, error: "File too large (max 20 MB)" }, { status: 400 });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

  // Upload to Storage bucket "reports" under dm/ prefix
  const fileName = `dm/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
  const { error: uploadErr } = await supabase.storage
    .from("reports")
    .upload(fileName, file, { contentType: "application/pdf", upsert: false });

  if (uploadErr) {
    return NextResponse.json({ ok: false, error: `Storage: ${uploadErr.message}` }, { status: 500 });
  }

  // Signed URL (1 hour) for Edge Function
  const { data: signedData, error: signErr } = await supabase.storage
    .from("reports")
    .createSignedUrl(fileName, 3600);

  if (signErr || !signedData?.signedUrl) {
    return NextResponse.json({ ok: false, error: "Could not create signed URL" }, { status: 500 });
  }

  // Call process-dm-pdf Edge Function
  const efUrl = `https://${supabaseRef}.supabase.co/functions/v1/process-dm-pdf`;
  try {
    const efRes = await fetch(efUrl, {
      method:  "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${serviceRoleKey}`,
      },
      body: JSON.stringify({
        url:         signedData.signedUrl,
        institution: institution || undefined,
        report_date: report_date || undefined,
      }),
    });

    const result = await efRes.json() as Record<string, unknown>;
    if (!efRes.ok || !result.ok) {
      return NextResponse.json({ ok: false, error: result.error ?? `EF returned ${efRes.status}` }, { status: efRes.status });
    }

    return NextResponse.json({ ok: true, file_name: fileName, ...result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 502 });
  }
}
