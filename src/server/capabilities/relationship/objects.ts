import type { RecordObject } from "@/server/platform/views";
import {
  ENTITY_COMPANY,
  ENTITY_OPPORTUNITY,
  ENTITY_PERSON,
  LOST_REASONS,
  OPPORTUNITY_SOURCES,
  RELATIONSHIP_CAPABILITY,
  SIZE_BANDS,
} from "./shared";

/**
 * The CRM's three record objects (ADR-051). Each field names where it lives on the model, how it may be filtered,
 * sorted and totalled, and the command that edits it. Stage and owner options are tenant data, filled in at request
 * time by `describe` in index.ts; everything else here is fixed.
 *
 * Row values: a relation or user field's value is `{ id, label }`; everything else is the plain value.
 */

const UPDATE_COMPANY = "verity.relationship.update_company";
const UPDATE_PERSON = "verity.relationship.update_person";
const UPDATE_OPPORTUNITY = "verity.relationship.update_opportunity";
const LOOKUP = "verity.relationship.lookup";

export const COMPANY_OBJECT: RecordObject = {
  key: ENTITY_COMPANY,
  entity: ENTITY_COMPANY,
  capability: RELATIONSHIP_CAPABILITY,
  labelSingular: "Company",
  labelPlural: "Companies",
  icon: "building",
  titleField: "name",
  recordHref: "/crm/companies/{id}",
  listQuery: "verity.relationship.list_companies",
  searchColumns: ["name", "domain", "city", "email", "phone"],
  lookupQuery: LOOKUP,
  defaultSort: { field: "name", dir: "asc" },
  defaultColumns: ["name", "domain", "industry", "city", "owner", "people", "openOpportunities", "pipelineValue", "lastActivity"],
  fields: [
    { key: "name", label: "Name", type: "text", editCommand: UPDATE_COMPANY, width: 240 },
    { key: "domain", label: "Domain", type: "link", editCommand: UPDATE_COMPANY, width: 160 },
    { key: "industry", label: "Industry", type: "text", editCommand: UPDATE_COMPANY, width: 160 },
    { key: "sizeBand", label: "Employees", type: "select", options: SIZE_BANDS, editCommand: UPDATE_COMPANY, width: 120 },
    { key: "phone", label: "Phone", type: "phone", editCommand: UPDATE_COMPANY, width: 150 },
    { key: "email", label: "Email", type: "email", editCommand: UPDATE_COMPANY, width: 200 },
    { key: "taxId", label: "GSTIN / tax ID", type: "text", editCommand: UPDATE_COMPANY, width: 170 },
    { key: "city", label: "City", type: "text", editCommand: UPDATE_COMPANY, width: 130 },
    { key: "region", label: "State / region", type: "text", editCommand: UPDATE_COMPANY, width: 140 },
    { key: "country", label: "Country", type: "text", editCommand: UPDATE_COMPANY, width: 120 },
    { key: "owner", label: "Account owner", type: "user", column: "ownerUserId", sortable: false, editCommand: UPDATE_COMPANY, width: 160 },
    { key: "source", label: "Source", type: "select", options: OPPORTUNITY_SOURCES, editCommand: UPDATE_COMPANY, width: 140 },
    { key: "people", label: "People", type: "number", filterable: false, sortable: false, width: 90 },
    { key: "openOpportunities", label: "Open deals", type: "number", filterable: false, sortable: false, width: 110 },
    { key: "pipelineValue", label: "Open value", type: "currency", filterable: false, sortable: false, width: 130 },
    { key: "lastActivity", label: "Last activity", type: "datetime", filterable: false, sortable: false, width: 140 },
    { key: "createdAt", label: "Created", type: "datetime", width: 130 },
    { key: "updatedAt", label: "Updated", type: "datetime", width: 130 },
  ],
};

export const PERSON_OBJECT: RecordObject = {
  key: ENTITY_PERSON,
  entity: ENTITY_PERSON,
  capability: RELATIONSHIP_CAPABILITY,
  labelSingular: "Person",
  labelPlural: "People",
  icon: "people",
  titleField: "name",
  recordHref: "/crm/people/{id}",
  listQuery: "verity.relationship.list_people",
  searchColumns: ["givenName", "familyName", "jobTitle", "city", "company.name"],
  defaultSort: { field: "name", dir: "asc" },
  defaultColumns: ["name", "company", "jobTitle", "emails", "phones", "city", "owner", "lastActivity"],
  lookupQuery: LOOKUP,
  fields: [
    { key: "name", label: "Name", type: "text", column: "givenName", filterable: false, width: 220 },
    { key: "givenName", label: "First name", type: "text", editCommand: UPDATE_PERSON, width: 140 },
    { key: "familyName", label: "Last name", type: "text", editCommand: UPDATE_PERSON, width: 140 },
    {
      key: "company", label: "Company", type: "relation", relation: ENTITY_COMPANY, column: "companyId", sortColumn: "company.name",
      editCommand: UPDATE_PERSON, width: 200,
    },
    { key: "jobTitle", label: "Job title", type: "text", editCommand: UPDATE_PERSON, width: 180 },
    { key: "emails", label: "Emails", type: "email", array: true, sortable: false, editCommand: UPDATE_PERSON, width: 220 },
    { key: "phones", label: "Phones", type: "phone", array: true, sortable: false, editCommand: UPDATE_PERSON, width: 160 },
    { key: "city", label: "City", type: "text", editCommand: UPDATE_PERSON, width: 130 },
    { key: "owner", label: "Owner", type: "user", column: "ownerUserId", sortable: false, editCommand: UPDATE_PERSON, width: 160 },
    { key: "lastActivity", label: "Last activity", type: "datetime", filterable: false, sortable: false, width: 140 },
    { key: "createdAt", label: "Created", type: "datetime", width: 130 },
  ],
};

export const OPPORTUNITY_OBJECT: RecordObject = {
  key: ENTITY_OPPORTUNITY,
  entity: ENTITY_OPPORTUNITY,
  capability: RELATIONSHIP_CAPABILITY,
  labelSingular: "Opportunity",
  labelPlural: "Opportunities",
  icon: "enquiry",
  titleField: "name",
  recordHref: "/crm/opportunities/{id}",
  listQuery: "verity.relationship.list_opportunities",
  searchColumns: ["name", "company.name"],
  defaultSort: { field: "createdAt", dir: "desc" },
  defaultColumns: ["name", "company", "stage", "amount", "expectedCloseOn", "owner", "contact", "source"],
  boardGroupField: "stage",
  boardSumField: "amount",
  lookupQuery: LOOKUP,
  boardMove: { command: "verity.relationship.move_opportunity", groupParam: "stageId" },
  quickCreate: { command: "verity.relationship.create_opportunity", titleParam: "name", groupParam: "stage" },
  fields: [
    { key: "name", label: "Name", type: "text", editCommand: UPDATE_OPPORTUNITY, width: 260 },
    { key: "number", label: "Ref", type: "number", width: 90 },
    {
      key: "company", label: "Company", type: "relation", relation: ENTITY_COMPANY, column: "companyId", sortColumn: "company.name",
      editCommand: UPDATE_OPPORTUNITY, width: 200,
    },
    {
      key: "contact", label: "Point of contact", type: "relation", relation: ENTITY_PERSON, column: "contactId",
      sortColumn: "contact.givenName", editCommand: UPDATE_OPPORTUNITY, width: 180,
    },
    { key: "stage", label: "Stage", type: "select", column: "stageId", sortColumn: "stage.position", editCommand: UPDATE_OPPORTUNITY, width: 150 },
    {
      key: "amount", label: "Amount", type: "currency", aggregates: ["sum", "avg", "min", "max", "count_empty", "count_not_empty"],
      editCommand: UPDATE_OPPORTUNITY, width: 140,
    },
    { key: "probability", label: "Probability", type: "number", filterable: false, sortable: false, width: 110 },
    { key: "expectedCloseOn", label: "Expected close", type: "date", editCommand: UPDATE_OPPORTUNITY, width: 140 },
    { key: "submissionDueOn", label: "Bid due", type: "date", editCommand: UPDATE_OPPORTUNITY, width: 130 },
    { key: "source", label: "Source", type: "select", options: OPPORTUNITY_SOURCES, editCommand: UPDATE_OPPORTUNITY, width: 150 },
    { key: "owner", label: "Owner", type: "user", column: "ownerUserId", sortable: false, editCommand: UPDATE_OPPORTUNITY, width: 160 },
    { key: "lostReason", label: "Lost reason", type: "select", options: LOST_REASONS, width: 170 },
    { key: "createdAt", label: "Created", type: "datetime", width: 130 },
    { key: "closedAt", label: "Closed", type: "datetime", width: 130 },
  ],
};

export const RELATIONSHIP_OBJECTS = [COMPANY_OBJECT, PERSON_OBJECT, OPPORTUNITY_OBJECT];
