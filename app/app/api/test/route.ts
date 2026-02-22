import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/admin";

export async function GET() {
  const { data, error } = await supabaseAdmin
    .from("test")
    .select("*")
    .order("created_at", { ascending: false });

  return NextResponse.json({ data, error });
}

export async function POST() {
  const { data, error } = await supabaseAdmin
    .from("test")
    .insert({ name: "hello-from-admin" })
    .select("*")
    .single();

  return NextResponse.json({ data, error });
}
