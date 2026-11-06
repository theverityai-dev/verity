/**
 * Acceptance sampling by attributes, single sampling, normal inspection: ISO 2859-1 (ANSI/ASQ Z1.4, the "AQL table" a garment buyer's
 * inspection is run to). Pure: the lot size, the inspection level and an AQL give a sample size and the most defects that still pass.
 *
 * Table I gives a code letter for the lot size and level; the letter gives a sample size; Table II-A gives the acceptance number for each
 * AQL, where an arrow sends the inspector to the first plan below or above it (and so to that plan's sample size too). Along any AQL
 * column the plans run 0, up-arrow, down-arrow, 1, 2, 3, 5, 7, 10, 14, 21, and each AQL step down starts that run one letter later.
 */

export const INSPECTION_LEVELS = ["I", "II", "III"] as const;
export type InspectionLevel = (typeof INSPECTION_LEVELS)[number];
/** The AQLs a garment buyer writes (critical defects are always zero accepted). */
export const AQL_VALUES = ["0.65", "1.0", "1.5", "2.5", "4.0", "6.5"] as const;
export type AqlValue = (typeof AQL_VALUES)[number];

const LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H", "J", "K", "L", "M", "N", "P", "Q", "R"] as const;
const SAMPLE = [2, 3, 5, 8, 13, 20, 32, 50, 80, 125, 200, 315, 500, 800, 1250, 2000];

/** Table I: upper bound of each lot-size band and the code letter for general levels I, II, III. */
const BANDS: Array<[max: number, i: number, ii: number, iii: number]> = [
  [8, 0, 0, 1], [15, 0, 1, 2], [25, 1, 2, 3], [50, 2, 3, 4], [90, 2, 4, 5], [150, 3, 5, 6], [280, 4, 6, 7], [500, 5, 7, 8],
  [1200, 6, 8, 9], [3200, 7, 9, 10], [10000, 8, 10, 11], [35000, 9, 11, 12], [150000, 10, 12, 13], [500000, 11, 13, 14], [Infinity, 12, 14, 15],
];

/** The letter (index into LETTERS) at which each AQL's plan accepts zero. */
const ZERO_AT: Record<AqlValue, number> = { "6.5": 0, "4.0": 1, "2.5": 2, "1.5": 3, "1.0": 4, "0.65": 5 };
const RUN = [1, 2, 3, 5, 7, 10, 14, 21];

export function codeLetterIndex(lotSize: number, level: InspectionLevel): number {
  if (!Number.isInteger(lotSize) || lotSize < 2) throw new RangeError("a lot to inspect has at least 2 pieces");
  const band = BANDS.find(([max]) => lotSize <= max)!;
  return band[level === "I" ? 1 : level === "II" ? 2 : 3];
}

/** The plan an AQL column gives at one letter, after following its arrow. */
export function planAt(letter: number, aql: AqlValue): { sampleSize: number; accept: number } {
  const z = ZERO_AT[aql];
  let at = letter;
  if (at < z || at === z + 1) at = z; // down-arrow above the first plan; the up-arrow just after it
  else if (at === z + 2) at = z + 3; // the down-arrow before Ac 1
  if (at === z) return { sampleSize: SAMPLE[at]!, accept: 0 };
  const k = Math.min(at - (z + 3), RUN.length - 1); // past Ac 21 the arrow points back up to it
  return { sampleSize: SAMPLE[z + 3 + k]!, accept: RUN[k]! };
}

export type SamplingPlan = {
  codeLetter: string;
  /** Pieces to draw. When the plan asks for at least the whole lot, every piece is checked. */
  sampleSize: number;
  hundredPercent: boolean;
  acceptCritical: 0;
  acceptMajor: number;
  acceptMinor: number;
};

/**
 * One sample for the lot, judged against each defect class. Where the two AQLs' arrows lead to different sample sizes the larger is drawn
 * (the usual practice on a garment final; a larger sample with the same acceptance number is never kinder to the lot).
 */
export function samplingPlan(lotSize: number, level: InspectionLevel, aqlMajor: AqlValue, aqlMinor: AqlValue): SamplingPlan {
  const letter = codeLetterIndex(lotSize, level);
  const major = planAt(letter, aqlMajor);
  const minor = planAt(letter, aqlMinor);
  const n = Math.max(major.sampleSize, minor.sampleSize);
  return {
    codeLetter: LETTERS[letter]!,
    sampleSize: Math.min(n, lotSize),
    hundredPercent: n >= lotSize,
    acceptCritical: 0,
    acceptMajor: major.accept,
    acceptMinor: minor.accept,
  };
}

/** Pass only when every class is within its acceptance number. */
export const inspectionPasses = (plan: Pick<SamplingPlan, "acceptMajor" | "acceptMinor">, found: { critical: number; major: number; minor: number }) =>
  found.critical === 0 && found.major <= plan.acceptMajor && found.minor <= plan.acceptMinor;
