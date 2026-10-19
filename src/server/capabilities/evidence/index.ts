import { validateCustomFields } from "@/server/platform/entity";
import { z } from "zod";
import { registerContribution } from "@/server/platform/contribution";
import { registerCommand, type CommandDefinition } from "@/server/platform/command";
import { registerQuery, type QueryDefinition } from "@/server/platform/query";
import { withinGeofence } from "@/server/capabilities/location";
import { reserveUpload, confirmUpload } from "@/server/platform/files";

/**
 * CAPABILITY: Evidence — `verity.capability.evidence`
 *
 * Authority: Bible V2 (Evidence as immutable field data — GPS, photos,
 * signatures), EXE-AUD-003 (append-only), ADR-004 (a geofence is the policy
 * that judges a captured point). Depends on Location.
 *
 * Evidence is why the append-only guarantee had to hold even against a
 * privileged role: a calibration certificate or a proof-of-attendance
 * photograph that can be edited afterwards is not evidence, and a regulator
 * asking "could this have been changed" needs the answer to be no.
 *
 * The geofence verdict is stored at capture time rather than computed on read.
 * A fence can be moved or resized later, and re-judging a two-year-old check-in
 * against today's boundary would silently rewrite history.
 *
 * An artefact may be a platform-managed StoredFile — whose checksum is frozen at
 * confirmation, so the bytes behind the reference cannot change — or an external
 * URI for artefacts the platform does not host. A photo or document must carry
 * one of the two; evidence of a photograph with no photograph is not evidence.
 */

export const EVIDENCE_CAPABILITY = "verity.capability.evidence";
export const ENTITY_EVIDENCE = "verity.evidence.evidence";

const measuredReading = z.strictObject({
  value: z.number().finite(),
  unit: z.string().trim().min(1).max(12),
  condition: z.string().trim().max(120).optional(),
  instrument: z.string().trim().max(120).optional(),
  photoEvidenceId: z.string().uuid().optional(),
});

export const captureEvidence: CommandDefinition<
  {
    entityKey: string;
    entityId: string;
    kind: "Photo" | "Signature" | "GeoPoint" | "Document" | "Reading";
    uri?: string;
    fileId?: string;
    latitude?: number;
    longitude?: number;
    capturedAt: string;
    geofenceId?: string;
    payload?: Record<string, unknown>;
  },
  { id: string; withinFence: boolean | null }
> = {
  key: "verity.evidence.capture",
  entity: ENTITY_EVIDENCE,
  verb: "Create",
  input: z.object({
    entityKey: z.string().min(1),
    entityId: z.string().uuid(),
    kind: z.enum(["Photo", "Signature", "GeoPoint", "Document", "Reading"]),
    uri: z.string().min(1).optional(),
    fileId: z.string().uuid().optional(),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
    capturedAt: z.string().datetime(),
    geofenceId: z.string().uuid().optional(),
    payload: z.record(z.string(), z.unknown()).optional(),
  }),
  preconditions: async (_ctx, input) => {
    // A photo or document without a stored artefact is not evidence of anything.
    if ((input.kind === "Photo" || input.kind === "Document") && !input.uri && !input.fileId) {
      throw new Error(`E_VALIDATION: ${input.kind} evidence requires a stored artefact`);
    }
    if (input.kind === "GeoPoint" && (input.latitude === undefined || input.longitude === undefined)) {
      throw new Error("E_VALIDATION: GeoPoint evidence requires coordinates");
    }
  },
  handler: async (ctx, input) => {
    if (input.payload) {
      if (input.kind === "Reading" && "value" in input.payload && "unit" in input.payload) {
        // A measured reading is a platform-defined shape (a value in a unit), not tenant custom data.
        const parsed = measuredReading.safeParse(input.payload);
        if (!parsed.success) {
          throw new Error(`E_VALIDATION: a measured reading needs a number and a unit (${parsed.error.issues.map((i) => i.path.join(".") || "payload").join(", ")})`);
        }
      } else {
        await validateCustomFields(ctx.tx, ENTITY_EVIDENCE, input.payload);
      }
    }
    // Judge against the fence now and record the verdict, because the fence may
    // move later and the verdict must not move with it.
    let withinFence: boolean | null = null;
    if (input.geofenceId && input.latitude !== undefined && input.longitude !== undefined) {
      withinFence = await withinGeofence(ctx.tx, input.geofenceId, {
        latitude: input.latitude,
        longitude: input.longitude,
      });
    }

    const evidence = await ctx.tx.evidence.create({
      data: {
        tenantId: ctx.actor.tenantId,
        entityKey: input.entityKey,
        entityId: input.entityId,
        kind: input.kind,
        uri: input.uri ?? null,
        fileId: input.fileId ?? null,
        latitude: input.latitude ?? null,
        longitude: input.longitude ?? null,
        capturedAt: new Date(input.capturedAt),
        capturedById: ctx.actor.userId,
        geofenceId: input.geofenceId ?? null,
        withinFence,
        payload: (input.payload ?? {}) as never,
      },
    });

    return {
      result: { id: evidence.id, withinFence },
      events: [
        {
          name: "verity.evidence.captured",
          entityId: evidence.id,
          payload: { kind: input.kind, subject: input.entityKey, withinFence },
        },
      ],
    };
  },
};

/**
 * Phase one of capturing a photograph from a device camera: reserve a `StoredFile`
 * (Pending, unreadable) about the subject and hand back an upload URL. No evidence
 * row exists until `captureEvidenceFile` confirms the bytes, so an Evidence row can
 * never claim a photograph that did not arrive.
 */
export const reserveEvidenceFile: CommandDefinition<
  { entityKey: string; entityId: string; fileName: string; mimeType: string; byteSize: number },
  { fileId: string; uploadUrl?: string; uploadHeaders?: Record<string, string> }
> = {
  key: "verity.evidence.reserve_file",
  entity: ENTITY_EVIDENCE,
  verb: "Create",
  input: z.object({
    entityKey: z.string().min(1),
    entityId: z.string().uuid(),
    fileName: z.string().min(1).max(200),
    mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
    byteSize: z.number().int().positive(),
  }),
  handler: async (ctx, input) => {
    const reserved = await reserveUpload(ctx.tx, {
      tenantId: ctx.actor.tenantId,
      uploadedById: (await ctx.tx.user.findUniqueOrThrow({ where: { id: ctx.actor.userId } })).partyId,
      fileName: input.fileName,
      mimeType: input.mimeType,
      byteSize: input.byteSize,
      entityKey: input.entityKey,
      entityId: input.entityId,
    });
    // Some drivers sign headers into the upload URL (S3 signs `if-none-match`); the browser must send them as given.
    return { result: { fileId: reserved.fileId, uploadUrl: reserved.uploadUrl, uploadHeaders: reserved.uploadHeaders }, events: [] };
  },
};

/**
 * Phase two: confirm the uploaded bytes match what was declared, then record the
 * Evidence row that points at the sealed file. A mismatch quarantines the file and
 * records nothing. The reserved file must be about the same subject, so a file
 * uploaded for one record cannot be attached to another.
 */
export const captureEvidenceFile: CommandDefinition<
  { entityKey: string; entityId: string; fileId: string; checksum: string; byteSize: number; capturedAt: string },
  { id: string | null; status: "Stored" | "Quarantined" }
> = {
  key: "verity.evidence.capture_file",
  entity: ENTITY_EVIDENCE,
  verb: "Create",
  input: z.object({
    entityKey: z.string().min(1),
    entityId: z.string().uuid(),
    fileId: z.string().uuid(),
    checksum: z.string().min(1),
    byteSize: z.number().int().positive(),
    capturedAt: z.string().datetime(),
  }),
  handler: async (ctx, input) => {
    const file = await ctx.tx.storedFile.findUnique({ where: { id: input.fileId } });
    if (!file || file.entityKey !== input.entityKey || file.entityId !== input.entityId) {
      throw new Error("E_VALIDATION: that upload was not reserved for this record");
    }
    const confirmed = await confirmUpload(ctx.tx, { fileId: input.fileId, checksum: input.checksum, byteSize: input.byteSize });
    if (!confirmed.ok) return { result: { id: null, status: "Quarantined" }, events: [] };

    const evidence = await ctx.tx.evidence.create({
      data: {
        tenantId: ctx.actor.tenantId,
        entityKey: input.entityKey,
        entityId: input.entityId,
        kind: "Photo",
        fileId: input.fileId,
        capturedAt: new Date(input.capturedAt),
        capturedById: ctx.actor.userId,
        payload: {} as never,
      },
    });
    return {
      result: { id: evidence.id, status: "Stored" },
      events: [{ name: "verity.evidence.captured", entityId: evidence.id, payload: { kind: "Photo", subject: input.entityKey, withinFence: null } }],
    };
  },
};

export const listEvidenceFor: QueryDefinition<
  { entityKey: string; entityId: string },
  Array<Record<string, unknown>>
> = {
  key: "verity.evidence.list_for",
  entity: ENTITY_EVIDENCE,
  input: z.object({ entityKey: z.string().min(1), entityId: z.string().uuid() }),
  handler: async (ctx, input) =>
    ctx.tx.evidence.findMany({
      where: { entityKey: input.entityKey, entityId: input.entityId },
      orderBy: { capturedAt: "asc" },
    }),
};

export function registerEvidenceCapability(): void {
  registerContribution({
    capabilityId: EVIDENCE_CAPABILITY,
    navigation: [
      { href: "/evidence", label: "Evidence", group: "Capabilities", order: 30, icon: "evidence",
        requiresEntity: ENTITY_EVIDENCE, shells: ["platform", "operations"] },
    ],
  });
  registerCommand(captureEvidence);
  registerCommand(reserveEvidenceFile);
  registerCommand(captureEvidenceFile);
  registerQuery(listEvidenceFor);
}
