/**
 * Gives the D & S Electric Works demo tenant the details its printed invoices carry: legal name, address, GSTIN,
 * bank and signatory, kept under `customFields.billing`. Synthetic values only (the GSTIN has a valid check digit
 * but belongs to no one; the account number is a placeholder).
 *
 * Merges into the existing custom fields and touches ONLY a tenant flagged demoFor = "dsew". Safe to re-run.
 *
 *   npm run seed:dsew-profile
 */
import { PrismaClient } from "@prisma/client";
import { gstinCheckDigit } from "../src/server/capabilities/trading/keys";

const admin = new PrismaClient({ datasourceUrl: process.env.DIRECT_URL });

async function main() {
  const prefix = "23AAACD4821F1Z";
  const billing = {
    legalName: "D & S Electric Works",
    address: "Plot 14, Industrial Area, Rau\nIndore, Madhya Pradesh 453331",
    gstin: `${prefix}${gstinCheckDigit(prefix)}`,
    bank: { name: "State Bank of India, Rau branch", account: "XXXXXXXX4821", ifsc: "SBIN0000000" },
    signatory: "Authorised signatory",
  };
  const updated = await admin.$executeRaw`
    UPDATE public.tenant
    SET custom_fields = COALESCE(custom_fields, '{}'::jsonb) || ${JSON.stringify({ billing })}::jsonb
    WHERE custom_fields->>'demoFor' = 'dsew'`;
  console.log(`Updated ${updated} tenant(s) with a billing profile (GSTIN ${billing.gstin}).`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await admin.$disconnect();
  });
