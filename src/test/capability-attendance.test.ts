import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { prisma } from "@/server/platform/db";
import { assertRlsEnforceable, withTenant } from "@/server/platform/tenancy";
import { activateCapability, invalidateCapabilityCache } from "@/server/platform/capability";
import { clearCommands, clearHooks, executeCommand, type ActorContext } from "@/server/platform/command";
import { clearQueries, executeQuery } from "@/server/platform/query";
import { clearScopeResolvers } from "@/server/platform/authorization";
import { clearTransitionGuards } from "@/server/platform/state";
import { clearContributions } from "@/server/platform/contribution";
import { provisionIdentity } from "@/server/platform/identity";
import { LOCATION_CAPABILITY, registerLocationCapability } from "@/server/capabilities/location";
import { HR_CAPABILITY, ENTITY_HR_COMPENSATION, ENTITY_HR_EMPLOYEE, getEmployeeProfile, registerHrCapability, setEmployeeSalary } from "@/server/capabilities/hr";
import { ForbiddenError } from "@/server/platform/authorization";
import {
  ATTENDANCE_CAPABILITY,
  ENTITY_ATTENDANCE,
  ENTITY_SHIFT,
  defineShift,
  getAttendanceDashboard,
  getPayrollInputs,
  listShifts,
  payrollSummary,
  recordAttendance,
  registerAttendanceCapability,
} from "@/server/capabilities/attendance";

/** CAPABILITY: Attendance — record days, get a dashboard count, derive
 * payroll-ready hours from check-in/out, define a shift (§39-40, 42). */

const hasDatabase = Boolean(process.env.DATABASE_URL);
const describeDb = hasDatabase ? describe : describe.skip;

if (!hasDatabase) {
  const message = "capability-attendance.test.ts cannot run: DATABASE_URL is unset.";
  if (process.env.CI) throw new Error(message);
  console.warn(message);
}

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

describeDb("capability: Attendance", () => {
  const tenantId = randomUUID();

  let organizationId: string;
  let locationId: string;
  let manager: ActorContext;
  let employeeId: string;
  const today = "2026-09-10";

  beforeAll(async () => {
    await assertRlsEnforceable();
    clearCommands();
    clearQueries();
    clearHooks();
    clearScopeResolvers();
    clearTransitionGuards();
    clearContributions();
    registerLocationCapability();
    registerHrCapability();
    registerAttendanceCapability();

    await withTenant(tenantId, async (tx) => {
      await tx.tenant.create({
        data: { id: tenantId, name: "Colonel Kebabz Attendance Test", timeZone: "Asia/Kolkata" },
      });
      await activateCapability(tx, tenantId, LOCATION_CAPABILITY);
      await activateCapability(tx, tenantId, HR_CAPABILITY);
      await activateCapability(tx, tenantId, ATTENDANCE_CAPABILITY);

      organizationId = (await tx.organization.create({ data: { tenantId, name: "Outlet 1" } })).id;
      locationId = (
        await tx.location.create({ data: { tenantId, organizationId, name: "Outlet 1" } })
      ).id;

      const managerRole = await tx.role.create({ data: { tenantId, name: "Manager" }, select: { id: true } });
      const everything = [ENTITY_HR_EMPLOYEE, ENTITY_ATTENDANCE, ENTITY_SHIFT];
      await tx.permission.createMany({
        data: everything.flatMap((entity) =>
          (["Read", "Create", "Edit", "ActionExecute"] as const).map((verb) => ({
            tenantId,
            roleId: managerRole.id,
            verb,
            entity,
            scope: "Tenant" as const,
          })),
        ),
      });

      const managerIdentity = await provisionIdentity(tx, {
        organizationId,
        authUserId: randomUUID(),
        displayName: "Manager",
      });
      await tx.tenantMembership.update({
        where: { id: managerIdentity.membershipId },
        data: { roleId: managerRole.id },
      });

      manager = {
        tenantId,
        userId: managerIdentity.userId,
        membershipId: managerIdentity.membershipId,
        organizationId,
        roleId: managerRole.id,
      };

      const staffIdentity = await provisionIdentity(tx, {
        organizationId,
        authUserId: randomUUID(),
        displayName: "Kitchen Staff",
      });
      const employee = await tx.hrEmployee.create({
        data: { tenantId, partyId: staffIdentity.partyId },
      });
      employeeId = employee.id;
    });

    invalidateCapabilityCache();
  });

  afterAll(async () => {
    clearCommands();
    clearQueries();
    clearHooks();
    clearScopeResolvers();
    clearTransitionGuards();
    clearContributions();
    const admin = new PrismaClient({ datasourceUrl: process.env.DIRECT_URL });
    try {
      await admin.$executeRaw`DELETE FROM tenant WHERE id = ${tenantId}::uuid`;
      await admin.$executeRaw`DELETE FROM "user" WHERE id NOT IN (SELECT user_id FROM tenant_membership)`;
      await admin.$executeRaw`DELETE FROM party WHERE id NOT IN (SELECT party_id FROM "user")`;
    } finally {
      await admin.$disconnect();
    }
    await prisma.$disconnect();
  });

  it("records attendance, counts a dashboard, and derives payroll hours", async () => {
    await executeCommand(manager, recordAttendance, {
      employeeId,
      date: today,
      status: "Present",
      checkInAt: `${today}T10:00:00.000Z`,
      checkOutAt: `${today}T18:30:00.000Z`,
    });

    const dashboard = await executeQuery(manager, getAttendanceDashboard, { date: today });
    expect(dashboard.present).toBe(1);
    expect(dashboard.absent).toBe(0);

    const payroll = await executeQuery(manager, getPayrollInputs, {
      employeeId,
      fromDate: today,
      toDate: today,
    });
    expect(payroll.daysWorked).toBe(1);
    expect(payroll.hoursWorked).toBe(8.5);
    expect(payroll.absentCount).toBe(0);

    // A second recordAttendance call the same day corrects the row, not a duplicate.
    await executeCommand(manager, recordAttendance, { employeeId, date: today, status: "Late" });
    const updatedDashboard = await executeQuery(manager, getAttendanceDashboard, { date: today });
    expect(updatedDashboard.present).toBe(0);
    expect(updatedDashboard.late).toBe(1);

    await executeCommand(manager, defineShift, {
      locationId,
      employeeId,
      date: today,
      label: "Morning",
      startTime: "10:00",
      endTime: "18:00",
    });
    const shifts = await executeQuery(manager, listShifts, { locationId, date: today });
    expect(shifts).toHaveLength(1);
    expect(shifts[0]?.label).toBe("Morning");
  });

  it("marks a late check-in Late from the shift, counts overtime past the shift (IST)", async () => {
    const day = "2026-09-11";
    await executeCommand(manager, defineShift, { locationId, employeeId, date: day, label: "Morning", startTime: "10:00", endTime: "18:00" });

    // 10:15 IST is past 10:00 + 10 minutes' grace.
    await executeCommand(manager, recordAttendance, { employeeId, date: day, status: "Present", checkInAt: `${day}T04:45:00.000Z` });
    expect((await executeQuery(manager, getAttendanceDashboard, { date: day })).late).toBe(1);

    // 10:05 IST is within grace; out at 20:00 IST is 9h55m against an 8h shift.
    await executeCommand(manager, recordAttendance, {
      employeeId, date: day, status: "Present", checkInAt: `${day}T04:35:00.000Z`, checkOutAt: `${day}T14:30:00.000Z`,
    });
    expect((await executeQuery(manager, getAttendanceDashboard, { date: day })).present).toBe(1);

    const summary = await executeQuery(manager, payrollSummary, { fromDate: day, toDate: day });
    const row = summary.rows.find((r) => r.employeeId === employeeId)!;
    expect(row.hoursWorked).toBeCloseTo(9.92, 2);
    expect(row.overtimeHours).toBeCloseTo(1.92, 2);
  });

  it("hides salary from a role without the pay permission and shows it once granted (DECISIONS.md #3)", async () => {
    await expect(
      executeCommand(manager, setEmployeeSalary, { employeeId, monthlySalaryMinor: 1_800_000 }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const before = await executeQuery(manager, payrollSummary, { fromDate: today, toDate: today });
    expect(before.canSeeSalary).toBe(false);
    expect(before.rows.every((r) => r.monthlySalaryMinor === null)).toBe(true);

    await withTenant(tenantId, (tx) =>
      tx.permission.createMany({
        data: (["Read", "Edit"] as const).map((verb) => ({ tenantId, roleId: manager.roleId!, verb, entity: ENTITY_HR_COMPENSATION, scope: "Tenant" as const })),
      }),
    );
    await executeCommand(manager, setEmployeeSalary, { employeeId, monthlySalaryMinor: 1_800_000 });
    const after = await executeQuery(manager, payrollSummary, { fromDate: today, toDate: today });
    expect(after.canSeeSalary).toBe(true);
    expect(after.rows.find((r) => r.employeeId === employeeId)!.monthlySalaryMinor).toBe(1_800_000);
    const profile = (await executeQuery(manager, getEmployeeProfile, { employeeId }))!;
    expect(profile.canSeeSalary).toBe(true);
    expect(profile.monthlySalaryMinor).toBe(1_800_000);
  });
});
