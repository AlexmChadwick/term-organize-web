import { NextResponse } from "next/server";
import { fetchTerms } from "@/lib/banner-server";
import { termName } from "@/lib/models";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const terms = await fetchTerms();
    return NextResponse.json({
      terms: terms.map((term) => ({ code: term.code, name: termName(term), description: term.bannerDescription })),
      bundled: ["202710"],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Couldn't load terms.";
    return NextResponse.json({ error: message, terms: [], bundled: ["202710"] }, { status: 200 });
  }
}
