import { NextResponse } from "next/server";
import { removePushSubscription } from "@/lib/push-store";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { endpoint?: string } | null;
  if (!body?.endpoint) return NextResponse.json({ error: "Missing endpoint." }, { status: 400 });
  await removePushSubscription(body.endpoint);
  return NextResponse.json({ ok: true });
}
