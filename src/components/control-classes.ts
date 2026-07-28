// ABOUTME: Shared class strings for DESIGN.md's outlined ("border") level of the amber
// ABOUTME: hierarchy, so the 1.4.11 control boundary is defined in exactly one place.

/**
 * The resting boundary WCAG 1.4.11 governs, plus its hover — and nothing else.
 * `ash` is 6.21:1 on midnight and 5.44:1 on charcoal (see `docs/accessibility.md`);
 * hover is `cream` because `hover:border-ash` became a no-op once resting was ash.
 *
 * Deliberately carries no radius or border width: chips are `rounded-pill`, group rows
 * `rounded-panel`, buttons `rounded-control`. Shape is a design choice per control,
 * but the boundary contrast is a conformance requirement shared by all of them, and
 * the slate -> ash fix had to be applied at eight call sites because they were mixed
 * together. `control-classes.test.ts` fails if a ninth spells the pair out again.
 */
export const outlinedBoundaryClasses = "border-ash hover:border-cream";

/** The outlined treatment for a standalone control: boundary, border, radius, label color. */
export const outlinedControlClasses = `rounded-control border ${outlinedBoundaryClasses} text-cream transition-colors duration-100`;

/**
 * Standard secondary button — the counterweight to a primary CTA, at the same 48px
 * height. Call sites add their own layout and state modifiers (`w-full`,
 * `disabled:opacity-50`, …); none of those conflict with what is set here.
 *
 * Used on `<button>` and `<Link>` alike, which is why this is a class string rather
 * than a component — a component would need polymorphism plus class merging to say
 * the same thing.
 */
export const secondaryButtonClasses = `flex min-h-12 items-center justify-center px-xl text-base font-medium ${outlinedControlClasses}`;

/**
 * Compact outlined button for an inline form row, where a 48px control sitting next
 * to a 44px input reads as mismatched. Same boundary, tighter box.
 *
 * Compose from `outlinedControlClasses` rather than appending to this when a call site
 * needs different padding: Tailwind resolves conflicting utilities by stylesheet order,
 * not class-attribute order, so `${compactOutlinedButtonClasses} px-lg` is undefined.
 */
export const compactOutlinedButtonClasses = `min-h-11 px-md text-sm font-medium ${outlinedControlClasses}`;
