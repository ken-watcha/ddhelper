import { NextRequest, NextResponse } from "next/server";
import { compareTokens } from "@/lib/compare";

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const { designTokens, implTokens } = await request.json();

    if (!designTokens || !Array.isArray(designTokens)) {
      return NextResponse.json(
        { error: "designTokens array is required" },
        { status: 400 }
      );
    }

    if (!implTokens || !Array.isArray(implTokens)) {
      return NextResponse.json(
        { error: "implTokens array is required" },
        { status: 400 }
      );
    }

    const results = await compareTokens(designTokens, implTokens);
    const summary = {
      critical: results.filter((r) => r.severity === "critical").length,
      warning: results.filter((r) => r.severity === "warning").length,
      info: results.filter((r) => r.severity === "info").length,
      match: results.filter((r) => r.status === "match").length,
      missing: results.filter((r) => r.status === "missing_in_impl").length,
      total: results.length,
    };

    return NextResponse.json({ results, summary });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
