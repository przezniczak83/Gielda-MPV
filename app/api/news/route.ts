export async function POST(req: Request) {
  try {
    if (isGitHubPagesBuild()) {
      return NextResponse.json(
        { ok: false, error: "API disabled on GitHub Pages (static export)." },
        { status: 501 }
      );
    }

    const supabaseUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
    const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    const body = (await req.json()) as Partial<NewsInsert>;

    const rawTicker = String(body.ticker ?? "").trim();

    // ✅ WALIDACJA NA SUROWYM TICKERZE (bez toUpperCase)
    const tickerRegex = /^[A-Z]{1,6}$/;
    if (!tickerRegex.test(rawTicker)) {
      return NextResponse.json(
        { ok: false, error: "Invalid ticker format (A-Z only, 1–6 chars, no lowercase, no digits)" },
        { status: 400 }
      );
    }

    const payload: NewsInsert = {
      ticker: rawTicker, // już wiemy że poprawny
      title: String(body.title ?? "").trim(),
      source: body.source ?? null,
      url: body.url ? String(body.url).trim() : null,
      published_at: body.published_at ? String(body.published_at).trim() : null,
      impact_score: body.impact_score ?? null,
      category: body.category ?? null,
    };

    if (!payload.title) {
      return NextResponse.json(
        { ok: false, error: "Missing required field: title" },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from("news")
      .upsert(payload, { onConflict: "url" })
      .select("*");

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, data });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Server error" }, { status: 500 });
  }
}