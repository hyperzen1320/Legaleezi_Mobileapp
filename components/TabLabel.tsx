import { Text, type TextStyle } from "react-native";
import { FONT_CLAMP } from "../lib/useBreakpoint";

// Tab bars are a single row of four. With the phone's text size turned up,
// plain string labels grew without limit and were clipped at the sides and
// bottom of the bar. Rendering the label ourselves caps the growth at the
// chrome clamp, keeps it on one line, and lets it shrink a little to fit
// the narrowest screens. Used by both the office and the admin tab bars.
export function tabLabel(text: string, style: TextStyle) {
  return function TabLabel({ color }: { color: string }) {
    return (
      <Text
        style={[style, { color }]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.8}
        maxFontSizeMultiplier={FONT_CLAMP.chrome}
      >
        {text}
      </Text>
    );
  };
}
