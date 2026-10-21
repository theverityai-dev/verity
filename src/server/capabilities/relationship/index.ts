import { registerCommand } from "@/server/platform/command";
import { registerQuery } from "@/server/platform/query";
import { registerContribution } from "@/server/platform/contribution";
import { registerExportable } from "@/server/platform/data-export";
import { notify } from "@/server/platform/notification";
import { getRecordObject, registerRecordObject } from "@/server/platform/views";
import {
  ENTITY_COMPANY,
  ENTITY_FOLLOW_UP,
  ENTITY_INTERACTION,
  ENTITY_NOTE,
  ENTITY_OPPORTUNITY,
  ENTITY_PERSON,
  RELATIONSHIP_CAPABILITY,
} from "./shared";
import { RELATIONSHIP_OBJECTS } from "./objects";
import {
  archiveCompanies,
  archiveOpportunities,
  archivePeople,
  bulkUpdateCompanies,
  bulkUpdateOpportunities,
  bulkUpdatePeople,
  createCompany,
  createOpportunity,
  createPerson,
  importRecords,
  listCompanies,
  listOpportunities,
  listPeople,
  listStages,
  lookupRecords,
  moveOpportunity,
  reorderStages,
  restoreCompanies,
  restoreOpportunities,
  restorePeople,
  saveStage,
  setStagePlaybook,
  mergeCompanies,
  mergePeople,
  findDuplicates,
  setupPipeline,
  updateCompany,
  updateOpportunity,
  updatePerson,
} from "./records";
import {
  addFollowUp,
  addNote,
  archiveFollowUp,
  archiveInteraction,
  archiveNote,
  companyDetail,
  completeFollowUp,
  describeObject,
  dueFollowUps,
  editFollowUp,
  editNote,
  listFollowUps,
  logInteraction,
  opportunityDetail,
  personDetail,
  pipelineSummary,
  pipelineInsights,
  reopenFollowUp,
  searchRecords,
  timeline,
} from "./activity";

/**
 * CAPABILITY: Relationship (B2B CRM) — `verity.capability.relationship`, shown as "CRM".
 *
 * Authority: Task 128 (product-owner request 2026-10-20; Twenty `D:\Code\R&D\twenty` as a patterns-only reference,
 * no code copied, AGPL), ADR-050 (companies and people are tenant-owned, not Party rows), ADR-051 (record objects
 * and saved views). Generic: nothing here is client-specific; DSEW gets configuration (stages, seed data).
 *
 *  - Companies, people (several emails and phones), opportunities in a per-tenant pipeline whose stages each map to
 *    a closed ADR-009 category; won and lost close the deal, lost needs a reason.
 *  - Notes, logged interactions (never rewritten, only archived) and follow-ups (not `Task`: ADR-006).
 *  - One timeline per record: field changes from `activity` plus everything attached to it.
 *  - Table, board and saved views come from the platform (ADR-051); every edit is one of the commands below.
 *  - Overdue follow-ups reach their assignee once a day through the notification outbox (ADR-039).
 *
 * NOT BUILT (Task 128 later stages): custom fields and objects, merge of duplicates, automations, email and
 * calendar sync (needs its own ADR), a "won -> open a job" link into `project`.
 */

export * from "./shared";
export * from "./objects";
export * from "./records";
export * from "./activity";

const COMMANDS = [
  setupPipeline, saveStage, reorderStages, setStagePlaybook,
  mergeCompanies, mergePeople,
  createCompany, updateCompany, archiveCompanies, restoreCompanies, bulkUpdateCompanies,
  createPerson, updatePerson, archivePeople, restorePeople, bulkUpdatePeople,
  createOpportunity, updateOpportunity, moveOpportunity, archiveOpportunities, restoreOpportunities, bulkUpdateOpportunities,
  importRecords,
  addNote, editNote, archiveNote,
  logInteraction, archiveInteraction,
  addFollowUp, editFollowUp, completeFollowUp, reopenFollowUp, archiveFollowUp,
];

const QUERIES = [
  listStages, listCompanies, listPeople, listOpportunities, lookupRecords, findDuplicates, pipelineInsights,
  timeline, listFollowUps, companyDetail, personDetail, opportunityDetail, searchRecords, pipelineSummary, describeObject,
];

const csvDate = (d: Date | null) => (d ? d.toISOString() : null);

export function registerRelationshipCapability(): void {
  for (const object of RELATIONSHIP_OBJECTS) if (!getRecordObject(object.key)) registerRecordObject(object);
  for (const command of COMMANDS) registerCommand(command as never);
  for (const query of QUERIES) registerQuery(query as never);

  registerContribution({
    capabilityId: RELATIONSHIP_CAPABILITY,
    navigation: [
      { href: "/crm/opportunities", label: "Pipeline", group: "Trade", order: 5, icon: "enquiry", requiresEntity: ENTITY_OPPORTUNITY, shells: ["platform", "operations"] },
      { href: "/crm/companies", label: "Companies", group: "Trade", order: 6, icon: "building", requiresEntity: ENTITY_COMPANY, shells: ["platform", "operations"] },
      { href: "/crm/people", label: "People", group: "Trade", order: 7, icon: "people", requiresEntity: ENTITY_PERSON, shells: ["platform", "operations"] },
      { href: "/crm/follow-ups", label: "Follow-ups", group: "Trade", order: 8, icon: "clock", requiresEntity: ENTITY_FOLLOW_UP, shells: ["platform", "operations"] },
      { href: "/crm/insights", label: "Pipeline insights", group: "Insights", order: 30, icon: "overview", requiresEntity: ENTITY_OPPORTUNITY, shells: ["platform", "operations"] },
    ],
    workspace: [
      {
        key: "verity.relationship.my_follow_ups_due",
        label: "Follow-ups due",
        href: "/crm/follow-ups",
        count: ({ tx, userId }) =>
          tx.relationshipFollowUp.count({ where: { archivedAt: null, status: "open", assigneeId: userId, dueAt: { lt: new Date(Date.now() + 86_400_000) } } }),
        shells: ["platform", "operations"],
      },
    ],
    schedules: [
      {
        key: "verity.relationship.remind_follow_ups",
        label: "Remind people of follow-ups that are due or overdue",
        // Daily: a follow-up is due on a day, and one reminder a day is what a person can act on.
        cadence: "daily",
        run: async ({ tx, tenantId, now }) => {
          const due = await dueFollowUps(tx, now);
          const today = new Date(`${now.toISOString().slice(0, 10)}T00:00:00.000Z`);
          const events = [];
          for (const f of due) {
            const overdue = f.dueAt !== null && f.dueAt < now;
            await notify(tx, {
              tenantId,
              recipientIds: [f.assigneeId!],
              key: "verity.relationship.follow_up_due",
              entityKey: ENTITY_FOLLOW_UP,
              entityId: f.id,
              variables: { title: f.title },
              // The kind of thing and its title only: the recipient can already read it (ADR-039).
              fallback: { subject: overdue ? `Overdue follow-up: ${f.title}` : `Follow-up due today: ${f.title}`, body: "Open Follow-ups in the CRM to act on it." },
            });
            await tx.relationshipFollowUp.update({ where: { id: f.id }, data: { remindedOn: today } });
            events.push({ name: "verity.relationship.follow_up_reminded", entityId: f.id });
          }
          return { events };
        },
      },
    ],
  });

  registerExportable({
    key: "crm_companies",
    label: "CRM companies",
    entity: ENTITY_COMPANY,
    columns: ["id", "name", "domain", "industry", "size_band", "phone", "email", "tax_id", "address_line", "city", "region", "country", "postal_code", "owner_user_id", "source", "archived_at", "created_at"],
    read: async (tx) =>
      (await tx.relationshipCompany.findMany({ orderBy: { createdAt: "asc" } })).map((c) => [
        c.id, c.name, c.domain, c.industry, c.sizeBand, c.phone, c.email, c.taxId, c.addressLine, c.city, c.region, c.country, c.postalCode,
        c.ownerUserId, c.source, csvDate(c.archivedAt), csvDate(c.createdAt),
      ]),
  });
  registerExportable({
    key: "crm_people",
    label: "CRM people",
    entity: ENTITY_PERSON,
    columns: ["id", "company_id", "given_name", "family_name", "job_title", "emails", "phones", "city", "owner_user_id", "archived_at", "created_at"],
    read: async (tx) =>
      (await tx.relationshipPerson.findMany({ orderBy: { createdAt: "asc" } })).map((p) => [
        p.id, p.companyId, p.givenName, p.familyName, p.jobTitle, p.emails.join("; "), p.phones.join("; "), p.city, p.ownerUserId,
        csvDate(p.archivedAt), csvDate(p.createdAt),
      ]),
  });
  registerExportable({
    key: "crm_opportunities",
    label: "CRM opportunities",
    entity: ENTITY_OPPORTUNITY,
    columns: ["id", "number", "name", "company_id", "contact_id", "stage", "amount", "currency", "expected_close_on", "submission_due_on", "source", "owner_user_id", "lost_reason", "closed_at", "archived_at", "created_at"],
    read: async (tx) =>
      (await tx.relationshipOpportunity.findMany({ include: { stage: { select: { label: true } } }, orderBy: { number: "asc" } })).map((o) => [
        o.id, o.number, o.name, o.companyId, o.contactId, o.stage.label, o.amount?.toString() ?? null, o.currency,
        o.expectedCloseOn?.toISOString().slice(0, 10) ?? null, o.submissionDueOn?.toISOString().slice(0, 10) ?? null, o.source, o.ownerUserId,
        o.lostReason, csvDate(o.closedAt), csvDate(o.archivedAt), csvDate(o.createdAt),
      ]),
  });
  registerExportable({
    key: "crm_notes",
    label: "CRM notes",
    entity: ENTITY_NOTE,
    columns: ["id", "company_id", "person_id", "opportunity_id", "body", "author_user_id", "archived_at", "created_at"],
    read: async (tx) =>
      (await tx.relationshipNote.findMany({ orderBy: { createdAt: "asc" } })).map((n) => [
        n.id, n.companyId, n.personId, n.opportunityId, n.body, n.authorUserId, csvDate(n.archivedAt), csvDate(n.createdAt),
      ]),
  });
  registerExportable({
    key: "crm_interactions",
    label: "CRM interactions",
    entity: ENTITY_INTERACTION,
    columns: ["id", "company_id", "person_id", "opportunity_id", "kind", "subject", "summary", "outcome", "occurred_at", "duration_minutes", "logged_by_id", "archived_at"],
    read: async (tx) =>
      (await tx.relationshipInteraction.findMany({ orderBy: { occurredAt: "asc" } })).map((i) => [
        i.id, i.companyId, i.personId, i.opportunityId, i.kind, i.subject, i.summary, i.outcome, csvDate(i.occurredAt), i.durationMinutes,
        i.loggedById, csvDate(i.archivedAt),
      ]),
  });
  registerExportable({
    key: "crm_follow_ups",
    label: "CRM follow-ups",
    entity: ENTITY_FOLLOW_UP,
    columns: ["id", "company_id", "person_id", "opportunity_id", "title", "details", "due_at", "assignee_id", "status", "done_at", "archived_at", "created_at"],
    read: async (tx) =>
      (await tx.relationshipFollowUp.findMany({ orderBy: { createdAt: "asc" } })).map((f) => [
        f.id, f.companyId, f.personId, f.opportunityId, f.title, f.details, csvDate(f.dueAt), f.assigneeId, f.status, csvDate(f.doneAt),
        csvDate(f.archivedAt), csvDate(f.createdAt),
      ]),
  });
}
