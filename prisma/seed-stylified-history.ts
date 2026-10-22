/**
 * Adds a year of closed lots to the Stylified demo tenant, by bulk insert, so page and query speed can be measured on the volume
 * a working factory reaches (about 120 lots, 2,400 bundles and 24,000 ledger entries a year). Read and index behaviour only:
 * the rows skip the command path, so they carry no events and no audit rows. Never quote a write figure measured from this.
 *
 * SAFETY: refuses a Supabase host and refuses unless SCALE_CONFIRM_DISPOSABLE=1. Run it on a COPY of the demo database, never on
 * the database a demo or a client uses (the rows cannot be removed one by one; drop the copy instead).
 *
 *   SCALE_CONFIRM_DISPOSABLE=1 DIRECT_URL=... node prisma/run-seed.cjs seed-stylified-history.ts
 */
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const url = process.env.DIRECT_URL ?? "";
if (process.env.SCALE_CONFIRM_DISPOSABLE !== "1") throw new Error("Set SCALE_CONFIRM_DISPOSABLE=1: this adds ~27,000 rows that cannot be removed one by one.");
if (/supabase\.(co|com)/i.test(url)) throw new Error("Refusing to run against a Supabase host.");

const MONTHS = Number(process.env.HISTORY_MONTHS ?? 12);
const LOTS_PER_MONTH = Number(process.env.HISTORY_LOTS_PER_MONTH ?? 10);
const BUNDLES_PER_LOT = Number(process.env.HISTORY_BUNDLES_PER_LOT ?? 20);
const PIECES = 50;

const admin = new PrismaClient({ datasourceUrl: url });
const today = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate());
const day = (ago: number) => new Date(today - ago * 86_400_000);
const chunk = <T,>(rows: T[], n = 1000) => Array.from({ length: Math.ceil(rows.length / n) }, (_, i) => rows.slice(i * n, (i + 1) * n));

async function main() {
  const tenant = await admin.tenant.findFirstOrThrow({ where: { name: "Stylified" } });
  const tenantId = tenant.id;
  await admin.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('verity.tenant_id', ${tenantId}, true)`;
    const stages = await tx.pieceworkStage.findMany({ orderBy: { sequence: "asc" } });
    const workers = await tx.pieceworkWorker.findMany();
    const rates = await tx.pieceworkWorkerRate.findMany();
    const workerAt = new Map(stages.map((s) => [s.id, workers.find((w) => rates.some((r) => r.workerId === w.id && r.stageId === s.id))!]));
    const rateOf = (workerId: string, stageId: string) => rates.find((r) => r.workerId === workerId && r.stageId === stageId)?.rateMinor ?? 0;
    const user = await tx.tenantMembership.findFirstOrThrow({ select: { userId: true } });
    const lastLot = (await tx.pieceworkLot.aggregate({ _max: { sequenceNo: true } }))._max.sequenceNo ?? 0;
    const lastBundle = (await tx.pieceworkBundle.aggregate({ _max: { sequenceNo: true } }))._max.sequenceNo ?? 0;

    const lots: any[] = [];
    const bundles: any[] = [];
    const issues: any[] = [];
    const receives: any[] = [];
    let lotSeq = lastLot;
    let bundleSeq = lastBundle;

    for (let m = MONTHS; m >= 1; m -= 1) {
      for (let l = 0; l < LOTS_PER_MONTH; l += 1) {
        lotSeq += 1;
        const startAgo = m * 30 - l * 2 + 6;
        const lotId = randomUUID();
        lots.push({
          id: lotId, tenantId, number: `LOT-${String(lotSeq).padStart(4, "0")}`, sequenceNo: lotSeq, name: `History ${lotSeq}`, design: "Oxford formal, full sleeve",
          plannedPieces: BUNDLES_PER_LOT * PIECES, fabricType: "Oxford", startDate: day(startAgo), dueDate: day(startAgo - 20), status: "closed", createdById: user.userId, createdAt: day(startAgo),
        });
        for (let b = 0; b < BUNDLES_PER_LOT; b += 1) {
          bundleSeq += 1;
          const bundleId = randomUUID();
          bundles.push({ id: bundleId, tenantId, lotId, number: `B-${String(bundleSeq).padStart(4, "0")}`, sequenceNo: bundleSeq, netPieces: PIECES, createdById: user.userId, createdAt: day(startAgo - 1) });
          let intake = PIECES;
          stages.forEach((s, i) => {
            const worker = workerAt.get(s.id)!;
            const ago = startAgo - 2 - i * 3;
            const rejected = intake > 20 && (b + i) % 7 === 0 ? 1 : 0;
            const good = intake - rejected;
            const issueId = randomUUID();
            const base = { tenantId, lotId, bundleId, stageId: s.id, workerId: worker.id, wageBasis: "good", enteredById: user.userId };
            issues.push({ ...base, id: issueId, kind: "issue", pieces: intake, entryDate: day(ago), createdAt: day(ago) });
            receives.push({ ...base, id: randomUUID(), kind: "receive", pieces: intake, goodPieces: good, rejectedPieces: rejected, reworkPieces: 0, shortPieces: 0, issueId, rateMinor: rateOf(worker.id, s.id), entryDate: day(ago - 1), createdAt: day(ago - 1) });
            intake = good;
          });
        }
      }
    }
    for (const rows of chunk(lots)) await tx.pieceworkLot.createMany({ data: rows });
    for (const rows of chunk(bundles)) await tx.pieceworkBundle.createMany({ data: rows });
    for (const rows of chunk(issues)) await tx.pieceworkEntry.createMany({ data: rows });
    for (const rows of chunk(receives)) await tx.pieceworkEntry.createMany({ data: rows });

    const payments: any[] = [];
    for (let m = MONTHS; m >= 1; m -= 1) for (const w of workers) payments.push({ tenantId, workerId: w.id, kind: "payment", amountMinor: 200_000, mode: "bank", paidOn: day(m * 30 - 3), enteredById: user.userId, createdAt: day(m * 30 - 3) });
    for (const rows of chunk(payments)) await tx.pieceworkPayment.createMany({ data: rows });
    console.log(`History added: ${lots.length} lots, ${bundles.length} bundles, ${issues.length + receives.length} entries, ${payments.length} payments.`);
  }, { timeout: 600_000, maxWait: 60_000 });
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => admin.$disconnect());
