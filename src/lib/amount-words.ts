const ONES = [
  "", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve",
  "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen",
];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

function below1000(n: number): string {
  const parts: string[] = [];
  if (n >= 100) {
    parts.push(`${ONES[Math.floor(n / 100)]} hundred`);
    n %= 100;
  }
  if (n >= 20) {
    parts.push(TENS[Math.floor(n / 10)]! + (n % 10 ? `-${ONES[n % 10]}` : ""));
  } else if (n > 0) {
    parts.push(ONES[n]!);
  }
  return parts.join(" ");
}

/** A whole number in the Indian system (thousand, lakh, crore). Zero is "zero". */
function indianWords(n: number): string {
  if (n === 0) return "zero";
  const units: Array<[number, string]> = [
    [10_000_000, "crore"],
    [100_000, "lakh"],
    [1_000, "thousand"],
  ];
  const parts: string[] = [];
  for (const [size, name] of units) {
    if (n >= size) {
      parts.push(`${indianWords(Math.floor(n / size))} ${name}`);
      n %= size;
    }
  }
  if (n > 0) parts.push(below1000(n));
  return parts.join(" ");
}

/**
 * An amount in minor units (paise) as the words printed under the total of an Indian invoice:
 * "Rupees one lakh twenty-three thousand four hundred fifty-six and fifty paise only".
 */
export function rupeesInWords(minor: number): string {
  const total = Math.max(0, Math.round(minor));
  const rupees = Math.floor(total / 100);
  const paise = total % 100;
  const words = `Rupees ${indianWords(rupees)}${paise ? ` and ${indianWords(paise)} paise` : ""} only`;
  return words.charAt(0).toUpperCase() + words.slice(1);
}
