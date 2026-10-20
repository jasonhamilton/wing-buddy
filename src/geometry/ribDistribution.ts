/**
 * Where a panel's ribs go. Two numbers shape a layout of a given number of ribs:
 *   bias                  -3 to 3. 0 is even. Positive crowds the ribs toward the root, negative toward the tip.
 *   chord proportionality -2 to 2. 0 ignores the chord. 1 spaces ribs in proportion to the local chord, so a
 *                         tapered panel has them closer toward the narrow end. 2 goes further. Negative does the
 *                         opposite: further apart where the chord is narrow.
 * Bias is applied first, as an exponential curve along the rib number; the chord step then maps that onto the span.
 * With 0 and 0 the ribs are evenly spaced. The distribution picks which of the two is in play: linear neither,
 * exponential the bias, chord proportional the proportionality.
 */
import type { Panel, RibLayout } from "../domain/schema";

export const DEFAULT_LAYOUT: RibLayout = { distribution: "linear", bias: 0, chordProportionality: 0, vary: { thickness: false, half: false } };

/** The layout a panel has, or the one an older file implies. */
export function ribLayoutOf(panel: Pick<Panel, "ribLayout" | "ribsManuallyEdited">): RibLayout {
  if (panel.ribLayout) return { ...DEFAULT_LAYOUT, ...panel.ribLayout, vary: { ...DEFAULT_LAYOUT.vary, ...panel.ribLayout.vary } };
  return panel.ribsManuallyEdited ? { ...DEFAULT_LAYOUT, distribution: "custom", vary: { thickness: true, half: true } } : DEFAULT_LAYOUT;
}

export function chordAtMm(panel: Pick<Panel, "lengthMm" | "rootChordMm" | "tipChordMm">, y: number): number {
  const t = panel.lengthMm === 0 ? 0 : y / panel.lengthMm;
  return panel.rootChordMm + (panel.tipChordMm - panel.rootChordMm) * t;
}

const round = (v: number) => Number(v.toFixed(4));

export type RibDistributionInput = {
  lengthMm: number;
  rootChordMm: number;
  tipChordMm: number;
  ribCount: number;
  /** the ribs' thickness: the last rib's far face lands on the panel's end, so the last one sits this far short of it */
  thicknessMm?: number;
  bias?: number;
  chordProportionality?: number;
};

/** Ribs from the root to the tip, the first at 0 and the last at the length less the rib thickness. Anything unusable gives an even layout. */
export function distributeRibs(input: RibDistributionInput): number[] {
  const { lengthMm, rootChordMm, tipChordMm } = input;
  const count = Math.max(2, Math.round(input.ribCount));
  const bias = Number.isFinite(input.bias) ? Math.max(-3, Math.min(3, input.bias!)) : 0;
  const a = Number.isFinite(input.chordProportionality) ? Math.max(-2, Math.min(2, input.chordProportionality!)) : 0;
  const reach = Math.max(0, lengthMm - Math.max(0, input.thicknessMm ?? 0));
  const usable = lengthMm > 0 && rootChordMm > 0 && tipChordMm > 0;
  const logR = usable ? Math.log(tipChordMm / rootChordMm) : 0;

  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    // Step 1: exponential bias along the rib number.
    const u = Math.abs(bias) < 1e-8 ? t : Math.expm1(bias * t) / Math.expm1(bias);
    // Step 2: chord proportionality maps that onto the span.
    let p: number;
    if (Math.abs(logR) < 1e-8) p = u; // the chord does not change, so there is nothing to follow
    else {
      const logChord = Math.abs(a - 1) < 1e-8 ? u * logR : Math.log1p(u * Math.expm1((1 - a) * logR)) / (1 - a);
      p = Math.expm1(logChord) / Math.expm1(logR);
    }
    out.push(round(reach * p));
  }
  out[0] = 0;
  out[count - 1] = round(reach);
  return out;
}

/**
 * The positions a panel's layout gives when nothing is set by hand. A custom layout keeps the shape it was made
 * from (its stored bias and proportionality), which is what its table marks changes against.
 */
export function calculatedPositions(panel: Panel): number[] {
  const layout = ribLayoutOf(panel);
  const d = layout.distribution;
  return distributeRibs({
    lengthMm: panel.lengthMm,
    rootChordMm: panel.rootChordMm,
    tipChordMm: panel.tipChordMm,
    ribCount: panel.ribCountTarget,
    thicknessMm: panel.ribThicknessMm,
    bias: d === "exponential" || d === "custom" ? layout.bias : 0,
    chordProportionality: d === "chord" || d === "custom" ? layout.chordProportionality : 0,
  });
}
