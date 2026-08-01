// ABOUTME: Shared class strings for DESIGN.md's filled and outlined levels of the amber
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

/**
 * A disabled control leaves the amber hierarchy — it is chrome, not a dimmed CTA.
 * The outlined level says that by dropping its ash boundary to slate with an ash
 * label; see the filled counterpart below, and DESIGN.md §Accessibility for why
 * slate is the sanctioned inactive token and opacity is not.
 *
 * The `disabled:hover:*` neutralisers are load-bearing: `:hover` still matches a
 * disabled button, and Tailwind resolves same-specificity variants by stylesheet
 * order, not class-attribute order. Fill and label are neutralised as well as the
 * boundary because the two ember-outlined buttons hover to a filled ember.
 */
export const disabledOutlinedClasses =
  "disabled:border-slate disabled:bg-transparent disabled:text-ash disabled:hover:border-slate disabled:hover:bg-transparent disabled:hover:text-ash";

/** The outlined treatment for a standalone control: boundary, border, radius, label color. */
export const outlinedControlClasses = `rounded-control border ${outlinedBoundaryClasses} text-cream transition-colors duration-100 ${disabledOutlinedClasses}`;

/**
 * Standard secondary button — the counterweight to a primary CTA, at the same 48px
 * height. Call sites add their own layout modifiers (`w-full`, `sm:w-auto`, …);
 * none of those conflict with what is set here, and the disabled treatment
 * arrives with the boundary rather than being restated per call site.
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

/**
 * The amber fill of DESIGN.md's top level, with the label colour its contrast is
 * measured against: midnight on amber is 9.04:1 (`docs/accessibility.md`), and hover
 * lifts the fill to warm-white, which only stays legible because the label is dark.
 * Changing one of the three without the others is the failure mode, so they are one
 * string.
 *
 * Deliberately carries no radius, size, or display: the landing CTA is `inline-flex`,
 * the groups form button is 44px, and the rest are 48px flex rows. Bundling those
 * per-control choices in is what left twelve call sites re-spelling the fill.
 */
export const primaryFillClasses = "bg-amber text-midnight hover:bg-warm-white";

/**
 * The filled level's half of the disabled rule: the amber fill drops to slate and
 * the label to ash, so a disabled CTA reads as chrome rather than as a faded CTA.
 * The hover neutraliser holds the inactive fill against `hover:bg-warm-white`,
 * which `:hover` still matches on a disabled button — see
 * `disabledOutlinedClasses` on why that cannot be left to variant order.
 */
export const disabledFillClasses = "disabled:bg-slate disabled:text-ash disabled:hover:bg-slate";

/** The filled treatment for a standalone control: fill, radius, transition. */
export const primaryControlClasses = `rounded-control ${primaryFillClasses} transition-colors duration-100 ${disabledFillClasses}`;

/**
 * Standard primary button — the CTA `secondaryButtonClasses` counterweights, at the
 * same 48px height. Call sites add their own layout modifiers (`w-full`,
 * `sm:w-auto`, …); none of those conflict with what is set here, and the disabled
 * treatment arrives with the fill rather than being restated per call site.
 *
 * Compose from `primaryControlClasses` rather than appending to this when a call site
 * needs a different size or padding, for the reason on `compactOutlinedButtonClasses`.
 */
export const primaryButtonClasses = `flex min-h-12 items-center justify-center px-xl text-base font-semibold ${primaryControlClasses}`;
