// ABOUTME: Renders AI-generated text with **bold** markers as React text nodes.
// ABOUTME: The only formatting honored is `**` → <strong>; HTML is never injected.

export interface BoldSegment {
  bold: boolean;
  text: string;
}

/**
 * Splits text on `**` markers into plain/bold segments. An unbalanced final
 * marker is restored as literal text so nothing the model wrote is dropped.
 */
export function parseBold(text: string): BoldSegment[] {
  const parts = text.split("**");
  const segments: BoldSegment[] = [];
  parts.forEach((part, i) => {
    const opensBoldRun = i % 2 === 1;
    const unbalanced = opensBoldRun && i === parts.length - 1;
    if (unbalanced) {
      segments.push({ bold: false, text: `**${part}` });
    } else if (part.length > 0) {
      segments.push({ bold: opensBoldRun, text: part });
    }
  });
  return segments;
}

export function BoldText({ text }: { text: string }) {
  return (
    <>
      {parseBold(text).map((segment, i) =>
        segment.bold ? (
          <strong key={i}>{segment.text}</strong>
        ) : (
          <span key={i}>{segment.text}</span>
        )
      )}
    </>
  );
}
