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

  // Parse multipart form
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid form data" }, { status: 400 });
  }

  const ticker  = (formData.get("ticker")  as string | null)?.toUpperCase();
  const file    = formData.get("file") as File | null;

  if (!ticker) {
    return NextResponse.json({ ok: false, error: "ticker required" }, { status: 400 });
  }
  if (!file || file.type !== "application/pdf") {
    return NextResponse.json({ ok: false, error: "PDF file required" }, { status: 400 });
  }
  if (file.size > 20 * 1024 * 1024) {
    return NextResponse.json({ ok: false, error: "File too large (max 20 MB)" }, { status: 400 });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

  // Upload to Supabase Storage bucket "reports"
  const fileName = `${ticker}/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
  const { error: uploadErr } = await supabase.storage
    .from("reports")
    .upload(fileName, file, { contentType: "application/pdf", upsert: false });

  if (uploadErr) {
    return NextResponse.json({ ok: false, error: `Storage: ${uploadErr.message}` }, { status: 500 });
  }

  // Get signed URL (valid 1 hour) for extract-pdf Edge Function
  const { data: signedData, error: signErr } = await supabase.storage
    .from("reports")
    .createSignedUrl(fileName, 3600);

  if (signErr || !signedData?.signedUrl) {
    return NextResponse.json({ ok: false, error: "Could not create signed URL" }, { status: 500 });
  }

  // Invoke extract-pdf Edge Function
  const efUrl = `https://${supabaseRef}.supabase.co/functions/v1/extract-pdf`;
  let extracted: Record<string, unknown> = {};

  try {
    const efRes = await fetch(efUrl, {
      method:  "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${serviceRoleKey}`,
      },
      body: JSON.stringify({ ticker, pdf_url: signedData.signedUrl }),
    });

    if (efRes.ok) {
      extracted = await efRes.json() as Record<string, unknown>;
    } else {
      const errText = await efRes.text();
      console.warn(`[upload-pdf] extract-pdf returned ${efRes.status}: ${errText}`);
      extracted = { warning: `extract-pdf returned ${efRes.status}` };
    }
  } catch (efErr) {
    const msg = efErr instanceof Error ? efErr.message : String(efErr);
    console.warn(`[upload-pdf] extract-pdf call failed: ${msg}`);
    extracted = { warning: msg };
  }

  return NextResponse.json({
    ok:               true,
    ticker,
    file_name:        fileName,
    extracted_fields: extracted,
  });
}
