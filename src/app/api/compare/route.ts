import { NextRequest, NextResponse } from "next/server";
import { compareTokens } from "@/lib/compare";
import { hashString, withCache } from "@/lib/cache";

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  try {
    const { designTokens, implTokens, catalog } = await request.json();

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

    const cacheKey = `compare:${hashString(
      JSON.stringify(designTokens) +
        "|" +
        JSON.stringify(implTokens) +
        "|" +
        JSON.stringify(catalog || [])
    )}`;

    const { value, cached } = await withCache(cacheKey, async () => {
      const results = await compareTokens(
        designTokens,
        implTokens,
        Array.isArray(catalog) ? catalog : undefined
      );
      const summary = {
        critical: results.filter((r) => r.severity === "critical").length,
        warning: results.filter((r) => r.severity === "warning").length,
        info: results.filter((r) => r.severity === "info").length,
        match: results.filter((r) => r.status === "match").length,
        missing: results.filter((r) => r.status === "missing_in_impl").length,
        total: results.length,
      };
      return { results, summary };
    });

    return NextResponse.json({ ...value, cached });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
