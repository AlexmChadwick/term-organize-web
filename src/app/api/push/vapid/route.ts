import { NextResponse } from "next/server";
import { ensurePushSender, vapidConfig } from "@/lib/push-sender";

export const dynamic = "force-dynamic";

/** The public VAPID key, when the server is configured to send Web Push. */
export function GET() {
  ensurePushSender();
  const config = vapidConfig();
  if (!config) return NextResponse.json({ configured: false, publicKey: null });
  return NextResponse.json({ configured: true, publicKey: config.publicKey }, { headers: { "Cache-Control": "no-store" } });
}
