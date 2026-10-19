/**
 * Adds controlled documents to the D & S Electric Works demo tenant (ADR-048, PROPOSED): the Documents capability
 * is activated for this tenant, the Owner role gets its permissions, three document types are defined with number
 * rules, and a handful of documents are created in the states a real register shows: a superseded revision a job
 * still relies on, one expiring soon, one expired, one waiting for release, one draft, and a traveller.
 *
 * EVERY title, client code and number here is fictional demo data. The number rule is illustrative until DSEW sends
 * its own scheme, and the files are records that point at no stored bytes. The Owner is the only login in the demo
 * tenant, so documents are released through the audited self-release exception, with its recorded reason.
 *
 * Idempotent: does nothing when the "drg" document type already exists. Touches ONLY the tenant flagged demoFor =
 * "dsew". Run against a LOCAL database unless the product owner has approved the migration on production:
 *
 *   node prisma/run-seed.cjs seed-dsew-documents.ts
 */
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { installCapabilities } from "../src/server/capabilities/registry";
import { activateCapability, invalidateCapabilityCache } from "../src/server/platform/capability";
import { executeCommand as rawExecute, type ActorContext } from "../src/server/platform/command";
import {
  DOCUMENT_CAPABILITY,
  ENTITY_DOCUMENT,
  ENTITY_DOCUMENT_RELEASE,
  ENTITY_DOCUMENT_REVISION,
  ENTITY_DOCUMENT_SELF_RELEASE,
  ENTITY_DOCUMENT_TYPE,
  approveRevision,
  createDocument,
  defineDocumentType,
  linkRevision,
  startRevision,
  submitRevision,
} from "../src/server/capabilities/document";

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
const SELF = "Seeded for the demo: the only login in this tenant is the Owner.";

async function main() {
  installCapabilities();
  const tenants = await admin.$queryRaw<Array<{ id: string }>>`SELECT id FROM public.tenant WHERE custom_fields->>'demoFor' = 'dsew'`;
  if (tenants.length !== 1) throw new Error(`expected exactly one DSEW demo tenant, found ${tenants.length}`);
  const tenantId = tenants[0]!.id;

  const setup = await withTenant(tenantId, async (tx) => {
    const membership = await tx.tenantMembership.findFirst({ where: { tenantId, role: { name: "Owner" } }, include: { role: true } });
    if (!membership?.role) throw new Error("no Owner membership in the DSEW tenant");
    const actor: ActorContext = {
      tenantId, userId: membership.userId, membershipId: membership.id, organizationId: membership.organizationId, roleId: membership.role.id,
    };
    const jobs = await tx.projectJob.findMany({ where: { tenantId }, select: { id: true, title: true } });
    return { actor, jobs, existing: await tx.documentType.count({ where: { tenantId, key: "drg" } }) };
  });

  // The capability is its own to activate, and the Owner role gets its permissions. Idempotent.
  await withTenant(tenantId, async (tx) => {
    await activateCapability(tx as never, tenantId, DOCUMENT_CAPABILITY);
    const grants: Array<[string, Array<"Read" | "Create" | "Edit" | "ActionExecute">]> = [
      [ENTITY_DOCUMENT_TYPE, ["Read", "Create", "Edit"]],
      [ENTITY_DOCUMENT, ["Read", "Create"]],
      [ENTITY_DOCUMENT_REVISION, ["Read", "Create", "Edit", "ActionExecute"]],
      [ENTITY_DOCUMENT_RELEASE, ["ActionExecute"]],
      [ENTITY_DOCUMENT_SELF_RELEASE, ["ActionExecute"]],
    ];
    for (const [entity, verbs] of grants) {
      for (const verb of verbs) {
        const has = await tx.permission.findFirst({ where: { tenantId, roleId: setup.actor.roleId, verb, entity } });
        if (!has) await tx.permission.create({ data: { tenantId, roleId: setup.actor.roleId, verb, entity, scope: "Tenant" } });
      }
    }
  });
  invalidateCapabilityCache();

  if (setup.existing > 0) {
    console.log("The demo documents already exist; nothing done (the capability is active for the demo tenant).");
    return;
  }
  const owner = setup.actor;
  const job = (needle: string) => setup.jobs.find((j) => j.title.includes(needle))?.id;

  const clients = [
    { code: "A", label: "Atomic Research Centre (demo)" },
    { code: "B", label: "Heavy Electricals Ltd (demo)" },
    { code: "M", label: "Malwa Cement Works (demo)" },
  ];
  const drawing = await executeCommand(owner, defineDocumentType, {
    key: "drg",
    label: "Drawing",
    pattern: "IN-{SEG:client}{SEG:division}-{TYPE}-{SEQ:3}",
    segments: [
      { key: "client", label: "Client", options: clients },
      { key: "division", label: "Division", options: [{ code: "3", label: "Magnets" }, { code: "4", label: "Transformers" }] },
    ],
    validMonths: 12,
  });
  const sop = await executeCommand(owner, defineDocumentType, { key: "sop", label: "Procedure", pattern: "{TYPE}-{YEAR}-{SEQ:3}", validMonths: 24 });
  const traveller = await executeCommand(owner, defineDocumentType, {
    key: "trv",
    label: "Traveller",
    pattern: "{TYPE}-{SEG:client}-{SEQ:4}",
    segments: [{ key: "client", label: "Client", options: clients }],
    requiresApproval: false,
    validMonths: 6,
  });

  /** A file record on the draft: a stored file row that points at no bytes (the demo has no object store). */
  const attach = (revisionId: string, fileName: string) =>
    withTenant(tenantId, async (tx) => {
      const file = await tx.storedFile.create({
        data: {
          tenantId, storageKey: `${tenantId}/demo/${randomUUID()}/${fileName}`, fileName, mimeType: "application/pdf",
          byteSize: 184_320, checksum: "demo", status: "Stored", confirmedAt: new Date(),
          entityKey: ENTITY_DOCUMENT_REVISION, entityId: revisionId,
        },
      });
      await tx.documentRevision.update({ where: { id: revisionId }, data: { fileId: file.id } });
    });
  const release = async (revisionId: string, fileName: string, extra: { effectiveFrom?: string; validUntil?: string } = {}) => {
    await attach(revisionId, fileName);
    await executeCommand(owner, submitRevision, { revisionId });
    await executeCommand(owner, approveRevision, { revisionId, selfApprovalReason: SELF, ...extra });
  };
  const link = async (revisionId: string, jobId: string | undefined) => {
    if (jobId) await executeCommand(owner, linkRevision, { revisionId, entityKey: "verity.project.job", entityId: jobId });
  };

  // 1. A magnet yoke drawing: R01 was released and a job built from it; R02 has since superseded it.
  const yoke = await executeCommand(owner, createDocument, { typeId: drawing.id, title: "Magnet yoke and pole, general arrangement", segments: { client: "A", division: "3" } });
  await release(yoke.revisionId, "yoke-ga-r01.pdf", { effectiveFrom: day(-120), validUntil: day(245) });
  await link(yoke.revisionId, job("electromagnet") ?? job("0.5 T") ?? job("magnet"));
  const yokeR2 = await executeCommand(owner, startRevision, { documentId: yoke.id, changeReason: "Pole gap corrected from 42 mm to 40 mm after field mapping" });
  await release(yokeR2.id, "yoke-ga-r02.pdf", { effectiveFrom: day(-20), validUntil: day(345) });

  // 2. The 100 kVA coil assembly drawing the hero job relied on, expiring soon.
  const coil = await executeCommand(owner, createDocument, { typeId: drawing.id, title: "100 kVA cast resin coil assembly", segments: { client: "M", division: "4" } });
  await release(coil.revisionId, "coil-assembly-r01.pdf", { effectiveFrom: day(-340), validUntil: day(21) });
  await link(coil.revisionId, job("hero journey"));

  // 3. A bushing drawing waiting for someone to release it.
  const bushing = await executeCommand(owner, createDocument, { typeId: drawing.id, title: "HV bushing and tap-changer arrangement", segments: { client: "B", division: "4" } });
  await attach(bushing.revisionId, "hv-bushing-r01.pdf");
  await executeCommand(owner, submitRevision, { revisionId: bushing.revisionId });

  // 4. A procedure that has lapsed and needs renewing.
  const vpi = await executeCommand(owner, createDocument, { typeId: sop.id, title: "Vacuum pressure impregnation procedure" });
  await release(vpi.revisionId, "vpi-procedure-r01.pdf", { effectiveFrom: day(-800), validUntil: day(-70) });

  // 5. A traveller, released on submission (its type needs no second approver).
  const trv = await executeCommand(owner, createDocument, { typeId: traveller.id, title: "Traveller, 100 kVA cast resin transformer", segments: { client: "M" } });
  await attach(trv.revisionId, "traveller-100kva.pdf");
  await executeCommand(owner, submitRevision, { revisionId: trv.revisionId });

  // 6. A draft that has no file yet.
  await executeCommand(owner, createDocument, { typeId: sop.id, title: "Test report template, routine tests" });

  console.log("Demo documents ready:", [yoke, coil, bushing, vpi, trv].map((d) => d.number).join(", "));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => admin.$disconnect());
