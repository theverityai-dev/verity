import type { TenantScopedClient } from "@/server/platform/tenancy";
import { hasTenantPermission } from "@/server/platform/authorization";
import { ENTITY_PROJECT_JOB, jobReference } from "./shared";

export type OrderJob = {
  reference: string;
  title: string;
  customer: { name: string; contact: string | null; phone: string | null; email: string | null; gstin: string | null };
  dueDate: string | Date | null;
};

/**
 * The job a production order is linked to, for the documents printed from the order (traveler, dispatch pack).
 * Jobs are their own entity with their own grant: a reader without it gets null and the document prints without
 * the commercial details. An order with no linked job also gives null.
 */
export async function jobForOrder(tx: TenantScopedClient, reader: { roleId: string | null }, orderId: string): Promise<OrderJob | null> {
  if (!(await hasTenantPermission(tx, reader.roleId, "Read", ENTITY_PROJECT_JOB))) return null;
  const link = await tx.projectJobOrder.findUnique({ where: { orderId }, include: { job: { include: { customer: true } } } });
  if (!link) return null;
  return {
    reference: jobReference(link.job.number),
    title: link.job.title,
    customer: {
      name: link.job.customerName,
      contact: link.job.customerContact,
      phone: link.job.customer?.phone ?? null,
      email: link.job.customer?.email ?? null,
      gstin: link.job.customer?.gstin ?? null,
    },
    dueDate: link.job.dueDate,
  };
}
