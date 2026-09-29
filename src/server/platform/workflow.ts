import type { WorkflowNode } from "@prisma/client";
import type { ActorContext } from "./command";
import { withTenant, type TenantScopedClient } from "./tenancy";

/**
 * Workflow and automation runtime.
 *
 * Authority: Spec MET-AUT-001→003 (node categories, envelope, credentials),
 * MET-WKF-001→003 (transaction boundaries, routing, sub-workflow cascades).
 *
 * The engine knows two things: how to walk a DAG, and how to invoke a *node
 * type*. It knows nothing about any particular workflow. Workflows are data;
 * node types are code registered here. Adding a capability therefore means
 * registering a handler, never editing the executor — foundation-ready
 * condition C.
 */

/** The envelope every node receives and returns (Authority: MET-AUT-002). */
export type AutomationPayload = {
  json: Record<string, unknown>;
  binary?: Array<{ key: string; mimetype: string; size: number }>;
  error?: { message: string; code: string };
};

export type NodeHandlerContext = {
  actor: ActorContext;
  tx: TenantScopedClient;
  node: WorkflowNode;
  runId: string;
};

export type NodeHandler = (
  ctx: NodeHandlerContext,
  input: AutomationPayload,
) => Promise<AutomationPayload>;

const handlers = new Map<string, NodeHandler>();

/** Registers a node type. This is the extension point for new automation behaviour. */
export function registerNodeHandler(handlerKey: string, handler: NodeHandler): void {
  if (handlers.has(handlerKey)) throw new Error(`Node handler already registered: ${handlerKey}`);
  handlers.set(handlerKey, handler);
}

export function clearNodeHandlers(): void {
  handlers.clear();
}

/**
 * A declarative routing predicate over the envelope (Authority: MET-WKF-002).
 *
 * Conditions are data rather than code so a tenant can change a threshold — the
 * spec's own example is a $5,000 approval cutoff — without a deploy, and so a
 * stored workflow can never carry executable code.
 */
export type EdgeCondition = {
  path: string;
  op: "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "exists";
  value?: unknown;
};

export function readPath(json: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, part) => {
    if (acc && typeof acc === "object") return (acc as Record<string, unknown>)[part];
    return undefined;
  }, json);
}

export function evaluateCondition(
  condition: EdgeCondition | null | undefined,
  payload: AutomationPayload,
): boolean {
  if (!condition) return true; // an unconditional edge always fires
  const actual = readPath(payload.json, condition.path);

  switch (condition.op) {
    case "exists":
      return actual !== undefined && actual !== null;
    case "eq":
      return actual === condition.value;
    case "neq":
      return actual !== condition.value;
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      // Ordering comparisons are only meaningful between numbers; anything else
      // is a mis-declared condition and must not quietly evaluate to true.
      if (typeof actual !== "number" || typeof condition.value !== "number") return false;
      if (condition.op === "gt") return actual > condition.value;
      if (condition.op === "gte") return actual >= condition.value;
      if (condition.op === "lt") return actual < condition.value;
      return actual <= condition.value;
    }
  }
}

export class WorkflowError extends Error {
  readonly code = "E_WORKFLOW" as const;
  constructor(message: string) {
    super(message);
    this.name = "WorkflowError";
  }
}

/**
 * Executes a workflow from its Trigger node.
 *
 * MET-WKF-001 requires a workflow *step* to run in a single transaction
 * boundary, and that is what happens: each node runs in its own transaction, so
 * a node that fails validation leaves no half-written record of its own work.
 * The run as a whole is not one transaction — it cannot be, since a workflow may
 * span external calls and wait states — so partial progress is recorded
 * explicitly in workflow_step_run rather than silently discarded.
 *
 * `idempotencyKey` deduplicates: the same trigger fact must not start two runs.
 */
export async function executeWorkflow(
  actor: ActorContext,
  workflowKey: string,
  input: AutomationPayload,
  options: { idempotencyKey?: string; triggerEventId?: string } = {},
): Promise<{ runId: string; status: "Succeeded" | "Failed"; output: AutomationPayload }> {
  const prepared = await withTenant(actor.tenantId, async (tx) => {
    const workflow = await tx.workflowDefinition.findUnique({
      where: { tenantId_key: { tenantId: actor.tenantId, key: workflowKey } },
      include: { nodes: true, edges: true },
    });
    if (!workflow) throw new WorkflowError(`Unknown workflow: ${workflowKey}`);
    if (!workflow.enabled) throw new WorkflowError(`Workflow is disabled: ${workflowKey}`);

    if (options.idempotencyKey) {
      const existing = await tx.workflowRun.findFirst({
        where: { idempotencyKey: options.idempotencyKey },
      });
      if (existing) return { workflow, existingRunId: existing.id };
    }

    const run = await tx.workflowRun.create({
      data: {
        tenantId: actor.tenantId,
        workflowId: workflow.id,
        workflowVersion: workflow.version,
        idempotencyKey: options.idempotencyKey ?? null,
        triggerEventId: options.triggerEventId ?? null,
        input: input as never,
      },
    });
    return { workflow, runId: run.id };
  });

  if ("existingRunId" in prepared && prepared.existingRunId) {
    const done = await withTenant(actor.tenantId, (tx) =>
      tx.workflowRun.findUniqueOrThrow({ where: { id: prepared.existingRunId } }),
    );
    return {
      runId: done.id,
      status: done.status === "Failed" ? "Failed" : "Succeeded",
      output: (done.input as AutomationPayload) ?? { json: {} },
    };
  }

  const { workflow } = prepared;
  const runId = prepared.runId!;
  const nodesById = new Map(workflow.nodes.map((n) => [n.id, n]));

  const trigger = workflow.nodes.find((n) => n.type === "Trigger");
  if (!trigger) throw new WorkflowError(`Workflow ${workflowKey} has no Trigger node`);

  let payload: AutomationPayload = input;
  let sequence = 0;
  let current: WorkflowNode | undefined = trigger;

  try {
    while (current) {
      const node: WorkflowNode = current;
      const handler = handlers.get(node.handlerKey);
      if (!handler) throw new WorkflowError(`No handler registered for ${node.handlerKey}`);

      // MET-WKF-001: one transaction per step.
      payload = await withTenant(actor.tenantId, async (tx) => {
        const step = await tx.workflowStepRun.create({
          data: { tenantId: actor.tenantId, runId, nodeId: node.id, sequence: sequence++ },
        });
        const out = await handler({ actor, tx, node, runId }, payload);
        await tx.workflowStepRun.update({
          where: { id: step.id },
          data: { status: "Succeeded", output: out as never, finishedAt: new Date() },
        });
        return out;
      });

      // MET-WKF-002: take the first edge whose condition holds.
      const next = workflow.edges
        .filter((e) => e.fromNodeId === node.id)
        .find((e) => evaluateCondition(e.condition as EdgeCondition | null, payload));

      current = next ? nodesById.get(next.toNodeId) : undefined;
    }

    await withTenant(actor.tenantId, (tx) =>
      tx.workflowRun.update({
        where: { id: runId },
        data: { status: "Succeeded", finishedAt: new Date() },
      }),
    );
    return { runId, status: "Succeeded", output: payload };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await withTenant(actor.tenantId, (tx) =>
      tx.workflowRun.update({
        where: { id: runId },
        data: { status: "Failed", error: message, finishedAt: new Date() },
      }),
    );
    throw error;
  }
}

/** Stores a secret, encrypted (Authority: MET-AUT-003). */
export async function storeCredential(
  tx: TenantScopedClient,
  name: string,
  secret: string,
  key: string,
): Promise<void> {
  await tx.$queryRaw`SELECT verity.credential_store(${name}, ${secret}, ${key})`;
}

/**
 * Decrypts a secret at execution time.
 *
 * Deliberately not a field on the Credential row: selecting the ciphertext into
 * application memory on every ordinary listing is what MET-AUT-003 is trying to
 * prevent.
 */
export async function revealCredential(
  tx: TenantScopedClient,
  name: string,
  key: string,
): Promise<string | null> {
  const rows = await tx.$queryRaw<{ credential_reveal: string | null }[]>`
    SELECT verity.credential_reveal(${name}, ${key})`;
  return rows[0]?.credential_reveal ?? null;
}
