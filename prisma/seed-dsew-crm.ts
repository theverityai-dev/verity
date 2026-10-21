/**
 * Adds a working CRM to the D & S Electric Works demo tenant (Task 128, ADR-050/051, both PROPOSED): the CRM
 * capability is activated, the Owner role gets its permissions, and the pipeline is filled the way an engineering
 * seller's really looks: labs, universities, power and telecom buyers, tenders with bid dates, a few deals won and
 * lost with reasons, calls and site visits logged, and follow-ups, some of them overdue.
 *
 * EVERY company, person, figure and date here is fictional demo data, labelled "(demo)" where a name could be
 * mistaken for a real organisation. Everything is written through the CRM's own commands, so the timeline shows it
 * exactly as it would after a person did it.
 *
 * Idempotent: does nothing when the demo tenant already has CRM companies. Touches ONLY the tenant flagged
 * demoFor = "dsew". Run against a LOCAL database unless the product owner has approved the migration on production:
 *
 *   node prisma/run-seed.cjs seed-dsew-crm.ts
 */
import { PrismaClient } from "@prisma/client";
import { installCapabilities } from "../src/server/capabilities/registry";
import { activateCapability, invalidateCapabilityCache } from "../src/server/platform/capability";
import { executeCommand as rawExecute, type ActorContext } from "../src/server/platform/command";
import { executeQuery } from "../src/server/platform/query";
import { ENTITY_CUSTOM_FIELD, ENTITY_SAVED_VIEW, defineCustomField, listCustomFields, saveView } from "../src/server/platform/views";
import {
  ENTITY_COMPANY,
  ENTITY_FOLLOW_UP,
  ENTITY_INTERACTION,
  ENTITY_NOTE,
  ENTITY_OPPORTUNITY,
  ENTITY_PERSON,
  ENTITY_STAGE,
  RELATIONSHIP_CAPABILITY,
  addFollowUp,
  addNote,
  completeFollowUp,
  createCompany,
  createOpportunity,
  createPerson,
  listStages,
  logInteraction,
  moveOpportunity,
  setupPipeline,
  setStagePlaybook,
  updateOpportunity,
} from "../src/server/capabilities/relationship";

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

async function withTenant<T>(tenantId: string, fn: (tx: typeof admin) => Promise<T>): Promise<T> {
  return admin.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('verity.tenant_id', ${tenantId}, true)`;
    return fn(tx as typeof admin);
  });
}

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const at = (offsetDays: number, hour = 11) => {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  d.setUTCHours(hour - 5, 30, 0, 0); // IST
  return d.toISOString();
};

async function main() {
  installCapabilities();
  const tenants = await admin.$queryRaw<Array<{ id: string }>>`SELECT id FROM public.tenant WHERE custom_fields->>'demoFor' = 'dsew'`;
  if (tenants.length !== 1) throw new Error(`expected exactly one DSEW demo tenant, found ${tenants.length}`);
  const tenantId = tenants[0]!.id;

  const owner = await withTenant(tenantId, async (tx) => {
    const membership = await tx.tenantMembership.findFirst({ where: { tenantId, role: { name: "Owner" } }, include: { role: true } });
    if (!membership?.role) throw new Error("no Owner membership in the DSEW tenant");
    return {
      tenantId, userId: membership.userId, membershipId: membership.id, organizationId: membership.organizationId, roleId: membership.role.id,
    } satisfies ActorContext;
  });

  await withTenant(tenantId, async (tx) => {
    await activateCapability(tx as never, tenantId, RELATIONSHIP_CAPABILITY);
    const grants: Array<[string, Array<"Read" | "Create" | "Edit">]> = [
      [ENTITY_COMPANY, ["Read", "Create", "Edit"]],
      [ENTITY_PERSON, ["Read", "Create", "Edit"]],
      [ENTITY_OPPORTUNITY, ["Read", "Create", "Edit"]],
      [ENTITY_STAGE, ["Read", "Create", "Edit"]],
      [ENTITY_NOTE, ["Read", "Create", "Edit"]],
      [ENTITY_INTERACTION, ["Read", "Create", "Edit"]],
      [ENTITY_FOLLOW_UP, ["Read", "Create", "Edit"]],
      [ENTITY_SAVED_VIEW, ["Read", "Create", "Edit"]],
      [ENTITY_CUSTOM_FIELD, ["Edit"]],
    ];
    for (const [entity, verbs] of grants) {
      for (const verb of verbs) {
        const has = await tx.permission.findFirst({ where: { tenantId, roleId: owner.roleId, verb, entity } });
        if (!has) await tx.permission.create({ data: { tenantId, roleId: owner.roleId, verb, entity, scope: "Tenant" } });
      }
    }
  });
  invalidateCapabilityCache();

  if ((await withTenant(tenantId, (tx) => tx.relationshipCompany.count())) > 0) {
    console.log("The demo CRM already has companies; adding only what is new since (tender fields, playbook).");
    await addStage3(owner, tenantId);
    return;
  }

  await executeCommand(owner, setupPipeline, {});
  const stages = await executeQuery(owner, listStages, {});
  const stage = (key: string) => stages.find((s) => s.key === key)!.id;

  const companies: Record<string, string> = {};
  const add = async (key: string, input: Parameters<typeof createCompany.handler>[1]) => {
    companies[key] = (await executeCommand(owner, createCompany, input)).id;
  };
  await add("barc", { name: "Atomic Research Centre (demo)", domain: "arc-demo.in", industry: "Research laboratory", city: "Mumbai", region: "Maharashtra", country: "India", sizeBand: "1000+", source: "tender", phone: "+91 22 5550 0101" });
  await add("iit", { name: "Institute of Technology, Indore (demo)", domain: "iti-demo.ac.in", industry: "University", city: "Indore", region: "Madhya Pradesh", country: "India", sizeBand: "1000+", source: "rfq" });
  await add("hel", { name: "Heavy Electricals Ltd (demo)", domain: "hel-demo.co.in", industry: "Power generation", city: "Bhopal", region: "Madhya Pradesh", country: "India", sizeBand: "1000+", source: "repeat", taxId: "23AABCH0000D1Z5" });
  await add("malwa", { name: "Malwa Cement Works (demo)", domain: "malwacement-demo.in", industry: "Manufacturing", city: "Neemuch", region: "Madhya Pradesh", country: "India", sizeBand: "201-1000", source: "referral" });
  await add("tele", { name: "Narmada Telecom Infra (demo)", domain: "narmadatel-demo.in", industry: "Telecom", city: "Jabalpur", region: "Madhya Pradesh", country: "India", sizeBand: "201-1000", source: "website" });
  await add("metro", { name: "Central India Metro Rail (demo)", domain: "cimr-demo.in", industry: "Construction", city: "Bhopal", region: "Madhya Pradesh", country: "India", sizeBand: "1000+", source: "tender" });
  await add("solar", { name: "Sunfield Solar Parks (demo)", domain: "sunfield-demo.in", industry: "Power generation", city: "Ratlam", region: "Madhya Pradesh", country: "India", sizeBand: "51-200", source: "exhibition" });
  await add("pharma", { name: "Vindhya Pharma (demo)", domain: "vindhyapharma-demo.in", industry: "Pharmaceuticals", city: "Pithampur", region: "Madhya Pradesh", country: "India", sizeBand: "201-1000", source: "enquiry" });
  await add("steel", { name: "Rewa Steel Rolling (demo)", domain: "rewasteel-demo.in", industry: "Manufacturing", city: "Rewa", region: "Madhya Pradesh", country: "India", sizeBand: "51-200", source: "referral" });
  await add("labs", { name: "National Magnet Laboratory (demo)", domain: "nml-demo.res.in", industry: "Research laboratory", city: "Bengaluru", region: "Karnataka", country: "India", sizeBand: "201-1000", source: "rfq" });

  const people: Record<string, string> = {};
  const person = async (key: string, input: Parameters<typeof createPerson.handler>[1]) => {
    people[key] = (await executeCommand(owner, createPerson, input)).id;
  };
  await person("rao", { givenName: "Meera", familyName: "Rao", jobTitle: "Scientific Officer (Procurement)", emails: ["meera.rao@arc-demo.in"], phones: ["+91 98200 11111"] });
  await person("iyer", { givenName: "Suresh", familyName: "Iyer", jobTitle: "Head, Magnet Division", emails: ["s.iyer@arc-demo.in"], phones: ["+91 98200 22222"] });
  await person("jain", { givenName: "Anil", familyName: "Jain", jobTitle: "Professor, Electrical Engineering", emails: ["anil.jain@iti-demo.ac.in"], phones: ["+91 94250 33333"] });
  await person("verma", { givenName: "Kavita", familyName: "Verma", jobTitle: "Purchase Manager", emails: ["kavita.verma@hel-demo.co.in"], phones: ["+91 75500 44444"] });
  await person("singh", { givenName: "Rajesh", familyName: "Singh", jobTitle: "Chief Electrical Engineer", emails: ["rajesh.singh@hel-demo.co.in"], phones: ["+91 75500 55555"] });
  await person("patel", { givenName: "Hemant", familyName: "Patel", jobTitle: "Plant Head", emails: ["hemant@malwacement-demo.in"], phones: ["+91 93000 66666"] });
  await person("khan", { givenName: "Imran", familyName: "Khan", jobTitle: "Projects Lead", emails: ["imran.khan@narmadatel-demo.in"], phones: ["+91 99260 77777"] });
  await person("dubey", { givenName: "Pooja", familyName: "Dubey", jobTitle: "Deputy General Manager, Traction", emails: ["pooja.dubey@cimr-demo.in"], phones: ["+91 98930 88888"] });
  await person("mehta", { givenName: "Arjun", familyName: "Mehta", jobTitle: "Founder", emails: ["arjun@sunfield-demo.in"], phones: ["+91 99070 99999"] });
  await person("nair", { givenName: "Deepa", familyName: "Nair", jobTitle: "Engineering Manager", emails: ["deepa.nair@vindhyapharma-demo.in"] });
  await person("gupta", { givenName: "Vikas", familyName: "Gupta", jobTitle: "Maintenance Head", emails: ["vikas@rewasteel-demo.in"], phones: ["+91 94251 10101"] });
  await person("reddy", { givenName: "Lakshmi", familyName: "Reddy", jobTitle: "Principal Investigator", emails: ["l.reddy@nml-demo.res.in"], phones: ["+91 98450 20202"] });

  type Opp = { key: string; name: string; contact: string; amount: number; stage: string; source: string; close: number; bid?: number; lost?: string; lostNote?: string };
  const opps: Opp[] = [
    { key: "magnet", name: "Water-cooled electromagnet, 1.5 T", contact: "iyer", amount: 4_850_000, stage: "negotiation", source: "tender", close: 12, bid: -4 },
    { key: "coil", name: "Helmholtz coil pair with power supply", contact: "rao", amount: 1_240_000, stage: "quote", source: "rfq", close: 30, bid: 6 },
    { key: "lab", name: "Electromagnet for teaching lab (3 units)", contact: "jain", amount: 960_000, stage: "qualified", source: "rfq", close: 45 },
    { key: "crt", name: "2 MVA cast resin transformer", contact: "singh", amount: 3_150_000, stage: "quote", source: "repeat", close: 20, bid: 2 },
    { key: "cp", name: "Control panel retrofit, Unit 3", contact: "verma", amount: 740_000, stage: "enquiry", source: "repeat", close: 60 },
    { key: "lift", name: "Lifting magnets for clinker yard (2)", contact: "patel", amount: 1_480_000, stage: "negotiation", source: "referral", close: -3 },
    { key: "dg", name: "Isolation transformers for tower sites (40)", contact: "khan", amount: 2_600_000, stage: "qualified", source: "website", close: 35 },
    { key: "traction", name: "Traction transformer rewinding", contact: "dubey", amount: 5_400_000, stage: "enquiry", source: "tender", close: 90, bid: 14 },
    { key: "solar", name: "Inverter duty transformers, 4 × 1.25 MVA", contact: "mehta", amount: 6_200_000, stage: "won", source: "exhibition", close: -10 },
    { key: "pharma", name: "Ultra-isolation transformers for clean room", contact: "nair", amount: 410_000, stage: "won", source: "enquiry", close: -22 },
    { key: "steel", name: "Magnetic separator drum", contact: "gupta", amount: 890_000, stage: "lost", source: "referral", close: -15, lost: "price", lostNote: "Went with a cheaper imported drum; 11% under our quote." },
    { key: "nml", name: "Superconducting magnet test rig, power supply", contact: "reddy", amount: 2_250_000, stage: "quote", source: "rfq", close: 25, bid: 9 },
    { key: "nml2", name: "Field mapping fixture", contact: "reddy", amount: 380_000, stage: "lost", source: "rfq", close: -30, lost: "lead_time", lostNote: "Needed it in four weeks; our slot was eight." },
  ];
  const oppIds: Record<string, string> = {};
  for (const o of opps) {
    const created = await executeCommand(owner, createOpportunity, {
      name: o.name, contact: people[o.contact], amount: o.amount, source: o.source, expectedCloseOn: day(o.close),
      ...(o.bid !== undefined ? { submissionDueOn: day(o.bid) } : {}),
    });
    oppIds[o.key] = created.id;
    // Walk the deal through the stages it passed, so its stage history reads like a real one.
    const path: Record<string, string[]> = {
      enquiry: [],
      qualified: ["qualified"],
      quote: ["qualified", "quote"],
      negotiation: ["qualified", "quote", "negotiation"],
      won: ["qualified", "quote", "negotiation", "won"],
      lost: ["qualified", "quote", "lost"],
    };
    for (const [i, step] of path[o.stage]!.entries()) {
      await executeCommand(owner, moveOpportunity, {
        id: created.id, stageId: stage(step), position: i,
        ...(step === "lost" ? { lostReason: o.lost, lostNote: o.lostNote } : {}),
      });
    }
  }

  // What happened around them.
  await executeCommand(owner, logInteraction, {
    opportunityId: oppIds.magnet, personId: people.iyer, kind: "meeting", subject: "Technical clarification on field uniformity",
    summary: "Agreed ±0.5% over a 50 mm sphere; they want the cooling circuit drawing with the bid.", outcome: "Spec agreed", durationMinutes: 75, occurredAt: at(-9),
  });
  await executeCommand(owner, logInteraction, {
    opportunityId: oppIds.magnet, personId: people.rao, kind: "call", subject: "Commercial negotiation", summary: "Asked for 4% off for an early PO.",
    outcome: "Revised offer requested", durationMinutes: 20, occurredAt: at(-2, 15),
    nextStep: { title: "Send revised commercial offer for the 1.5 T magnet", dueAt: at(-1, 17) },
  });
  await executeCommand(owner, addNote, { opportunityId: oppIds.magnet, body: "Tender closes with technical and commercial bids together. EMD already paid (demo)." });
  await executeCommand(owner, logInteraction, {
    opportunityId: oppIds.crt, personId: people.singh, kind: "visit", subject: "Site survey at Unit 2 substation",
    summary: "Measured the plinth; existing oil transformer to be replaced. Indoor install, forced air cooling preferred.", outcome: "Survey done", durationMinutes: 180, occurredAt: at(-6),
    nextStep: { title: "Share GA drawing and losses data for the 2 MVA unit", dueAt: at(1, 12) },
  });
  await executeCommand(owner, logInteraction, {
    opportunityId: oppIds.lift, personId: people.patel, kind: "call", subject: "Follow-up on lifting magnet quote",
    summary: "They are comparing with one other supplier; decision expected this week.", outcome: "Awaiting decision", durationMinutes: 10, occurredAt: at(-1, 12),
  });
  await executeCommand(owner, addFollowUp, { opportunityId: oppIds.lift, title: "Call Hemant for the lifting magnet decision", dueAt: at(-2, 11) });
  await executeCommand(owner, addFollowUp, { opportunityId: oppIds.coil, title: "Submit Helmholtz coil bid on the portal", dueAt: at(5, 16), details: "Upload signed technical compliance sheet and price bid." });
  await executeCommand(owner, addFollowUp, { opportunityId: oppIds.traction, title: "Download tender documents and pre-bid queries", dueAt: at(0, 18) });
  await executeCommand(owner, addFollowUp, { companyId: companies.iit, title: "Offer a lab demo of the teaching electromagnet", dueAt: at(9, 11) });
  await executeCommand(owner, logInteraction, {
    personId: people.mehta, kind: "email", subject: "PO received for inverter duty transformers", summary: "PO for 4 units; advance 30% within 7 days.",
    outcome: "Won", occurredAt: at(-10, 10),
  });
  const done = await executeCommand(owner, addFollowUp, { opportunityId: oppIds.solar, title: "Open the job and book the winding slot", dueAt: at(-8, 10) });
  await executeCommand(owner, completeFollowUp, { id: done.id });
  await executeCommand(owner, addNote, { companyId: companies.hel, body: "Repeat customer since 2019 (demo). Payment terms 45 days; always asks for routine test certificates with dispatch." });
  await executeCommand(owner, logInteraction, {
    personId: people.khan, kind: "meeting", subject: "Tower-site isolation transformer requirement", summary: "40 sites in phase one; samples wanted before a rate contract.",
    outcome: "Sample requested", durationMinutes: 45, occurredAt: at(-4, 14),
    nextStep: { title: "Quote a sample unit and the rate contract price", dueAt: at(3, 12) },
  });

  // Two views worth having on day one.
  await executeCommand(owner, saveView, {
    objectKey: ENTITY_OPPORTUNITY, name: "Tenders and RFQs", type: "table", visibility: "shared",
    config: { filters: [{ field: "source", op: "is_any_of", value: ["tender", "rfq"] }], columns: [{ key: "name" }, { key: "company" }, { key: "stage" }, { key: "submissionDueOn" }, { key: "amount" }, { key: "owner" }], sorts: [{ field: "submissionDueOn", dir: "asc" }], aggregates: { amount: "sum" } },
  });
  await executeCommand(owner, saveView, {
    objectKey: ENTITY_OPPORTUNITY, name: "Closing in 30 days", type: "table", visibility: "shared",
    config: { filters: [{ field: "expectedCloseOn", op: "next_days", value: 30 }], sorts: [{ field: "expectedCloseOn", dir: "asc" }], aggregates: { amount: "sum" } },
  });

  console.log(`CRM demo: ${Object.keys(companies).length} companies, ${Object.keys(people).length} people, ${opps.length} opportunities.`);
  await addStage3(owner, tenantId);
}

/**
 * Task 128 stages 3-4 for the demo: DSEW's tender fields on opportunities, filled in on the tender deals, and a
 * playbook on the technical quote stage. Idempotent: a field that exists is left alone.
 */
async function addStage3(owner: ActorContext, tenantId: string) {
  const existing = new Set((await executeQuery(owner, listCustomFields, { entityKey: ENTITY_OPPORTUNITY })).map((f) => f.name));
  if (existing.has("EMD status")) return;
  if (!existing.has("Tender number")) await executeCommand(owner, defineCustomField, { entityKey: ENTITY_OPPORTUNITY, name: "Tender number", type: "String" });
  if (!existing.has("EMD amount")) await executeCommand(owner, defineCustomField, { entityKey: ENTITY_OPPORTUNITY, name: "EMD amount", type: "Number" });
  await executeCommand(owner, defineCustomField, { entityKey: ENTITY_OPPORTUNITY, name: "EMD status", type: "Select", options: ["Paid", "Exempt", "Pending"] });
  const tenders = await withTenant(tenantId, (tx) =>
    tx.relationshipOpportunity.findMany({ where: { source: { in: ["tender", "rfq"] } }, select: { id: true, number: true, amount: true } }),
  );
  for (const t of tenders) {
    await executeCommand(owner, updateOpportunity, {
      id: t.id,
      patch: { customFields: { "Tender number": `DEMO/2026/${100 + t.number}`, "EMD amount": Math.round(Number(t.amount ?? 0) * 0.02), "EMD status": t.number % 2 ? "Paid" : "Pending" } },
    });
  }
  const stages = await executeQuery(owner, listStages, {});
  const quote = stages.find((s) => s.key === "quote");
  if (quote) {
    await executeCommand(owner, setStagePlaybook, {
      id: quote.id,
      playbook: { followUps: [{ title: "Send the technical offer and GA drawing", dueInDays: 2 }, { title: "Call to confirm they received the offer", dueInDays: 5 }], notifyOwner: true },
    });
  }
  console.log(`CRM demo: tender fields on ${tenders.length} deals, playbook on Technical quote.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => admin.$disconnect());
