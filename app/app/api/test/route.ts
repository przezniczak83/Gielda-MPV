// app/api/test/route.ts

export const dynamic = "force-static";
export const revalidate = 60;

export async function GET() {
  return Response.json({
    ok: true,
    message: "static export API test",
    built_at: new Date().toISOString(),
  });
}