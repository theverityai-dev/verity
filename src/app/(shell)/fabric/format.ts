/** Hundredths of a unit as a plain quantity: 4805 and "m" become "48.05 m". */
export const qty = (centi: number, unit: string) => `${(centi / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })} ${unit}`;
