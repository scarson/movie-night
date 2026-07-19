// ABOUTME: The matchmaker's write-up — the AI narrative set like a programme note,
// ABOUTME: with **title** markers as real emphasis and never a byte of injected HTML.

import { BoldText } from "@/components/bold-text";

/** DESIGN.md motion: 80ms between blocks, fade + slight drift. */
const STAGGER_MS = 80;

export interface ConversationalViewProps {
  text: string;
}

export function ConversationalView({ text }: ConversationalViewProps) {
  const paragraphs = text.split("\n").filter((line) => line.trim() !== "");
  if (paragraphs.length === 0) return null;

  // The opening line carries the display face only when there is a body for it
  // to lead into; on its own it would just be a large sentence.
  const hasLead = paragraphs.length > 1;

  return (
    <div className="max-w-[62ch]">
      {paragraphs.map((paragraph, index) => (
        <p
          key={index}
          style={{ animationDelay: `${index * STAGGER_MS}ms` }}
          className={
            hasLead && index === 0
              ? "animate-rise-fade break-words font-display text-xl/[1.5] text-warm-white"
              : "animate-rise-fade mt-lg break-words text-base/[1.75] text-cream"
          }
        >
          <BoldText text={paragraph} />
        </p>
      ))}
    </div>
  );
}
