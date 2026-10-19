export const DOCUMENT_CAPABILITY = "verity.capability.document";
export const ENTITY_DOCUMENT_TYPE = "verity.document.type";
export const ENTITY_DOCUMENT = "verity.document.document";
export const ENTITY_DOCUMENT_REVISION = "verity.document.revision";
/** Permission-only: who may release (approve), reject or obsolete a revision. Separate from authoring. */
export const ENTITY_DOCUMENT_RELEASE = "verity.document.release";
/** Permission-only: the audited exception that lets an author release their own revision. */
export const ENTITY_DOCUMENT_SELF_RELEASE = "verity.document.self_release";

/** What a document may be linked to. The link names the exact revision relied on, never "the latest". */
export const LINKABLE_ENTITIES = ["verity.project.job", "verity.manufacturing.order", "verity.manufacturing.bom"] as const;
export type LinkableEntity = (typeof LINKABLE_ENTITIES)[number];

export const REVISION_STATUSES = ["draft", "in_review", "released", "superseded", "obsolete"] as const;
export type RevisionStatus = (typeof REVISION_STATUSES)[number];

/** `R01`, `R02`: how people refer to a revision. */
export function revisionLabel(revision: number): string {
  return `R${String(revision).padStart(2, "0")}`;
}
