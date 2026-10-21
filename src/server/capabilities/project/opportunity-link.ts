import { z } from "zod";
import { ValidationError, type CommandDefinition } from "@/server/platform/command";
import type { QueryDefinition } from "@/server/platform/query";
import { recordActivity } from "@/server/platform/audit";
import { ENTITY_OPPORTUNITY, opportunityRef } from "@/server/capabilities/relationship/shared";
import { ENTITY_PROJECT_JOB, jobReference } from "./shared";
import { createJob } from "./jobs";

/**
 * A won CRM opportunity becomes a job (Task 128, ADR-050 clause 4). The link is owned here, by the capability that
 * needs it: the job records the opportunity it came from, the CRM never learns about jobs, and a tenant with jobs but
 * no CRM is unaffected. It reads the opportunity inside this command's own transaction, under the caller's tenant,
 * so it is a command-owned integration, not an activation dependency (conformance: COMMAND_OWNED_INTEGRATIONS).
 *
 * A job needs a customer from the trading customer master; the person opening it chooses one (the screen suggests
 * the one whose name matches the opportunity's company). At most one job per opportunity, held in the database too.
 */

export const openJobFromOpportunity: CommandDefinition<
  { opportunityId: string; customerId: string; title?: string; dueDate?: string },
  { id: string; number: number }
> = {
  key: "verity.project.open_job_from_opportunity",
  entity: ENTITY_PROJECT_JOB,
  verb: "Create",
  description: "Open a job from a won opportunity, carrying its name, contact and value across.",
  input: z.object({
    opportunityId: z.string().uuid(),
    customerId: z.string().uuid(),
    title: z.string().trim().min(3).max(200).optional(),
    dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  }),
  handler: async (ctx, input) => {
    const opp = await ctx.tx.relationshipOpportunity.findUnique({
      where: { id: input.opportunityId },
      include: { stage: true, contact: { select: { givenName: true, familyName: true, phones: true, emails: true } } },
    });
    if (!opp) throw new ValidationError("E_VALIDATION: no such opportunity");
    if (opp.stage.category !== "Completed") throw new ValidationError("E_VALIDATION: only a won opportunity becomes a job");
    const existing = await ctx.tx.projectJob.findFirst({ where: { opportunityId: opp.id }, select: { number: true } });
    if (existing) throw new ValidationError(`E_VALIDATION: ${jobReference(existing.number)} was already opened from this opportunity`);

    const contact = opp.contact
      ? [[opp.contact.givenName, opp.contact.familyName].filter(Boolean).join(" "), opp.contact.phones[0] ?? opp.contact.emails[0]].filter(Boolean).join(", ")
      : undefined;
    const jobInput = {
      title: input.title ?? opp.name,
      customerId: input.customerId,
      customerContact: contact,
      description: `Opened from ${opportunityRef(opp.number)}${opp.amount ? `, won at ₹${Number(opp.amount).toLocaleString("en-IN")}` : ""}.`,
      ...(input.dueDate ? { dueDate: input.dueDate } : {}),
    };
    await createJob.preconditions?.(ctx, jobInput);
    const created = await createJob.handler(ctx, jobInput);
    await ctx.tx.projectJob.update({ where: { id: created.result.id }, data: { opportunityId: opp.id } });
    // The opportunity's timeline says where it went.
    await recordActivity(ctx, {
      entityKey: ENTITY_OPPORTUNITY,
      entityId: opp.id,
      commandKey: "verity.project.open_job_from_opportunity",
      changes: [{ field: "record", oldValue: null, newValue: `Opened job ${jobReference(created.result.number)}` }],
    });
    return {
      result: created.result,
      events: [...(created.events ?? []), { name: "verity.project.job_opened_from_opportunity", entityId: created.result.id, payload: { opportunityId: opp.id } }],
    };
  },
};

/** The job opened from an opportunity, if any: what the opportunity page shows instead of "Open a job". */
export const jobForOpportunity: QueryDefinition<{ opportunityId: string }, { id: string; reference: string; title: string; state: string } | null> = {
  key: "verity.project.job_for_opportunity",
  entity: ENTITY_PROJECT_JOB,
  description: "The job that was opened from a CRM opportunity.",
  input: z.object({ opportunityId: z.string().uuid() }),
  handler: async (ctx, input) => {
    const job = await ctx.tx.projectJob.findFirst({ where: { opportunityId: input.opportunityId } });
    return job ? { id: job.id, reference: jobReference(job.number), title: job.title, state: job.state } : null;
  },
};
