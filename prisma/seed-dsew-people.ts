/**
 * Fills People operations for the D & S Electric Works demo tenant: departments, leave types, the people who have
 * a login (Owner, Floor worker, Supervisor) as employees, and one pending leave request to decide. Synthetic data.
 *
 * Employees are Parties, and a Party is only created together with a login identity, so this seeds exactly the
 * people who already have one rather than inventing logins. Runs the real HR commands. Idempotent: does nothing
 * when the tenant already has an employee. Touches ONLY a tenant flagged demoFor = "dsew".
 *
 *   npm run seed:dsew-people
 */
import { PrismaClient } from "@prisma/client";
import { installCapabilities } from "../src/server/capabilities/registry";
import { executeCommand as rawExecute, type ActorContext } from "../src/server/platform/command";
import * as hr from "../src/server/capabilities/hr";
import * as accounting from "../src/server/capabilities/accounting";
import { asMigrationRoleInTenant } from "./migration-role";

const admin = new PrismaClient({ datasourceUrl: process.env.DIRECT_URL });

const executeCommand = (async (...args: Parameters<typeof rawExecute>) => {
  for (;;) {
    try {
      return await rawExecute(...args);
    } catch (error) {
      const e = error as { code?: string; retryAfterSeconds?: number };
      if (e.code !== "E_RATE_LIMIT") throw error;
      await new Promise((resolve) => setTimeout(resolve, ((e.retryAfterSeconds ?? 5) + 1) * 1000));
    }
  }
}) as typeof rawExecute;

const iso = (offsetDays: number) => new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate() + offsetDays)).toISOString();

/** Role name -> where that person sits. */
const PEOPLE: Array<{ role: string; department: string; designation: string; joinedDaysAgo: number }> = [
  { role: "Owner", department: "Management", designation: "Managing partner", joinedDaysAgo: 2400 },
  { role: "Supervisor", department: "Shop floor", designation: "Floor supervisor", joinedDaysAgo: 1500 },
  { role: "Floor worker", department: "Shop floor", designation: "Winder", joinedDaysAgo: 700 },
];

async function main() {
  installCapabilities();
  const tenants = await admin.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM public.tenant WHERE custom_fields->>'demoFor' = 'dsew'`;
  if (tenants.length !== 1) throw new Error(`expected exactly one DSEW demo tenant, found ${tenants.length}`);
  const tenantId = tenants[0]!.id;

  const setup = await asMigrationRoleInTenant(admin, tenantId, async (tx) => {
    const ownerMembership = await tx.tenantMembership.findFirst({
      where: { tenantId, role: { name: "Owner", permissions: { some: { entity: accounting.ENTITY_ACCOUNT, verb: "Create" } } } },
      include: { role: true },
    });
    if (!ownerMembership?.role) throw new Error("no Owner membership in the DSEW tenant");
    const people = [];
    for (const spec of PEOPLE) {
      const m = await tx.tenantMembership.findFirst({ where: { tenantId, role: { name: spec.role } }, include: { user: true } });
      if (m) people.push({ spec, partyId: m.user.partyId });
    }
    const existing = await tx.hrEmployee.count({ where: { tenantId } });
    const actor: ActorContext = {
      tenantId,
      userId: ownerMembership.userId,
      membershipId: ownerMembership.id,
      organizationId: ownerMembership.organizationId,
      roleId: ownerMembership.role.id,
    };
    return { actor, people, existing };
  });
  if (setup.existing > 0) {
    console.log("The tenant already has employees; nothing done.");
    return;
  }
  const owner = setup.actor;

  const departments = new Map<string, string>();
  for (const name of ["Management", "Engineering", "Shop floor", "Quality", "Stores", "Dispatch"]) {
    departments.set(name, (await executeCommand(owner, hr.createDepartment, { name })).id);
  }
  const casual = await executeCommand(owner, hr.createLeaveType, { name: "Casual leave", daysPerYear: 12 });
  await executeCommand(owner, hr.createLeaveType, { name: "Sick leave", daysPerYear: 8 });
  await executeCommand(owner, hr.createLeaveType, { name: "Earned leave", daysPerYear: 15 });

  const employees = new Map<string, string>();
  for (const p of setup.people) {
    const created = await executeCommand(owner, hr.createEmployee, {
      partyId: p.partyId,
      departmentId: departments.get(p.spec.department),
      designation: p.spec.designation,
      dateOfJoining: iso(-p.spec.joinedDaysAgo),
    });
    employees.set(p.spec.role, created.id);
  }

  const worker = employees.get("Floor worker");
  if (worker) {
    await executeCommand(owner, hr.applyForLeave, {
      employeeId: worker,
      leaveTypeId: casual.id,
      fromDate: iso(5),
      toDate: iso(6),
      reason: "Family function",
    });
  }
  console.log(`Seeded ${employees.size} employees, ${departments.size} departments, 3 leave types and 1 pending leave request.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await admin.$disconnect();
  });
