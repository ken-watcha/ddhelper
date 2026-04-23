import { analyzeWithAI, parseJsonFromResponse } from "./claude";
import { DesignToken } from "./types";

const IOS_SYSTEM_PROMPT = `You are a design token extractor for iOS/SwiftUI code. Extract ALL design properties from the given SwiftUI code.

Look for:
- Colors: .red, Color(hex:), Color(red:green:blue:), UIColor, Color("name"), .foregroundColor, .tint, .accentColor
- Font sizes: .font(.system(size:)), .font(.title), .font(.body), custom fonts with size
- Padding: .padding(), .padding(.horizontal, X), .padding(.vertical, X), .padding(EdgeInsets(...))
- Frame sizes: .frame(width:, height:, minWidth:, maxWidth:)
- Corner radius: .cornerRadius(), .clipShape(RoundedRectangle(cornerRadius:))
- Spacing: VStack(spacing:), HStack(spacing:), LazyVStack(spacing:)
- Opacity: .opacity()
- Border: .overlay(RoundedRectangle().stroke())

Convert all SwiftUI color values to hex format.
Convert SwiftUI system font sizes to px equivalent.

Return ONLY a valid JSON array (no markdown, no explanation) where each item has:
{
  "element": "descriptive name of the element",
  "property": "CSS-like property name",
  "value": "the value with unit",
  "category": "color" | "typography" | "spacing" | "sizing" | "border"
}`;

const ANDROID_SYSTEM_PROMPT = `You are a design token extractor for Android/Jetpack Compose code. Extract ALL design properties from the given Compose code.

Look for:
- Colors: Color(0xFF...), MaterialTheme.colorScheme.X, Color.Red, contentColor
- Font sizes: fontSize = X.sp, MaterialTheme.typography.X, TextStyle(fontSize = ...)
- Padding: Modifier.padding(X.dp), Modifier.padding(horizontal = X.dp, vertical = Y.dp)
- Sizes: Modifier.size(X.dp), Modifier.width(X.dp), Modifier.height(X.dp), Modifier.fillMaxWidth()
- Corner radius: RoundedCornerShape(X.dp), shape = RoundedCornerShape(...)
- Spacing: Arrangement.spacedBy(X.dp)
- Border: Modifier.border(width, color, shape), BorderStroke(...)
- Opacity: Modifier.alpha()

Convert all Compose color values to hex format (e.g., Color(0xFF1A1A1A) → #1A1A1A).
Convert dp to px (assume 1dp = 1px for comparison purposes).
Convert sp to px for font sizes.

Return ONLY a valid JSON array (no markdown, no explanation) where each item has:
{
  "element": "descriptive name of the element",
  "property": "CSS-like property name",
  "value": "the value with unit",
  "category": "color" | "typography" | "spacing" | "sizing" | "border"
}`;

export async function extractCodeTokens(
  code: string,
  platform: "ios" | "android"
): Promise<DesignToken[]> {
  const systemPrompt =
    platform === "ios" ? IOS_SYSTEM_PROMPT : ANDROID_SYSTEM_PROMPT;
  const response = await analyzeWithAI(systemPrompt, code.slice(0, 40000));
  return parseJsonFromResponse<DesignToken[]>(response);
}
