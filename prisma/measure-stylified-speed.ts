/**
 * Times the Stylified screens' queries (median of five) as the owner and a supervisor. Run it on the copy that holds a year of
 * history (seed-stylified-history.ts) to see what a working factory feels like:
 *   DIRECT_URL=... DATABASE_URL=... node prisma/run-seed.cjs measure-stylified-speed.ts
 */
import { PrismaClient } from "@prisma/client";
import { installCapabilities } from "../src/server/capabilities/registry";
import { executeQuery } from "../src/server/platform/query";
import { withTenant } from "../src/server/platform/tenancy";
import * as pw from "../src/server/capabilities/piecework";

async function main() {
  installCapabilities();
  const admin = new PrismaClient({ datasourceUrl: process.env.DIRECT_URL });
  const tenant = await admin.tenant.findFirstOrThrow({ where: { name: "Stylified" } });
  const actorOf = async (roleName: string) => {
    const m = await withTenant(tenant.id, (tx) => tx.tenantMembership.findFirstOrThrow({ where: { role: { name: roleName } } }));
    return { tenantId: tenant.id, userId: m.userId, membershipId: m.id, organizationId: m.organizationId, roleId: m.roleId };
  };
  const owner = await actorOf("Owner");
  const sup = await actorOf("Supervisor");
  const cases: Array<[string, () => Promise<unknown>]> = [
    ["dashboard (owner)", () => executeQuery(owner, pw.dashboard, {})],
    ["listLots (owner)", () => executeQuery(owner, pw.listLots, {})],
    ["listWorkers (owner)", () => executeQuery(owner, pw.listWorkers, {})],
    ["floorOverview (supervisor)", () => executeQuery(sup, pw.floorOverview, {})],
    ["floorRegister (supervisor)", () => executeQuery(sup, pw.floorRegister, {})],
    ["approvalsInbox (owner)", () => executeQuery(owner, pw.approvalsInbox, {})],
  ];
  const w = await withTenant(tenant.id, (tx) => tx.pieceworkWorker.findFirstOrThrow());
  cases.push(["workerLedger (owner)", () => executeQuery(owner, pw.workerLedger, { workerId: w.id })]);
  for (const [name, run] of cases) {
    await run();
    const times: number[] = [];
    for (let i = 0; i < 5; i += 1) { const t = performance.now(); await run(); times.push(performance.now() - t); }
    times.sort((a, b) => a - b);
    console.log(`${name.padEnd(30)} median ${Math.round(times[2]!)} ms   min ${Math.round(times[0]!)}   max ${Math.round(times[4]!)}`);
  }
  await admin.$disconnect();
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
