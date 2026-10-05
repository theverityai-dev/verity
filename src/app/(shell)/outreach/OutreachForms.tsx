"use client";

import { useState } from "react";
import { CommandButton } from "@/components/ui/CommandAccess";
import { Field, Input, Select, Textarea } from "@/components/ui/primitives";
import { FormModal, formOptional, formText, useCommand } from "@/components/ui/CommandForm";

/**
 * Outreach forms that had backend commands but no screen (UI completeness
 * audit, 2026-10-04): the domain taxonomy, the rep's daily check-in and weekly
 * report, and a team lead's targets, assignments and weekly assessment.
 */

type Option = { id: string; name: string };
const dayStart = (date: string) => `${date}T00:00:00.000Z`;
const dayEnd = (date: string) => `${date}T23:59:59.999Z`;
const todayIso = () => new Date().toISOString().slice(0, 10);
/** Monday of the current week, as an ISO day. */
const thisMonday = () => {
  const now = new Date();
  const offset = (now.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - offset)).toISOString().slice(0, 10);
};

/* ------------------------------ domain taxonomy ----------------------------- */

export function DomainTaxonomyActions({ groups }: { groups: Option[] }) {
  const [open, setOpen] = useState<"group" | "domain" | null>(null);
  const command = useCommand("/outreach/domains");
  const close = () => {
    setOpen(null);
    command.clear();
  };
  return (
    <>
      <CommandButton commands="verity.outreach.create_domain" variant="primary" onClick={() => setOpen("domain")} disabled={groups.length === 0}>
        New domain
      </CommandButton>
      <CommandButton commands="verity.outreach.create_domain_group" onClick={() => setOpen("group")}>
        New group
      </CommandButton>
      <FormModal
        title="New market group"
        description="A group of related domains, for example Healthcare or Education."
        open={open === "group"}
        onClose={close}
        submitLabel="Create group"
        pending={command.pending}
        failure={command.failure}
        failureTitle="Could not create the group"
        onSubmit={(form) => command.run("verity.outreach.create_domain_group", { name: formText(form, "name") }, close)}
      >
        <Field label="Name" htmlFor="dg-name" required>
          <Input id="dg-name" name="name" required maxLength={120} autoFocus />
        </Field>
      </FormModal>
      <FormModal
        title="New domain"
        description="A market the team prospects into."
        open={open === "domain"}
        onClose={close}
        submitLabel="Create domain"
        pending={command.pending}
        failure={command.failure}
        failureTitle="Could not create the domain"
        onSubmit={(form) =>
          command.run("verity.outreach.create_domain", { groupId: formText(form, "groupId"), name: formText(form, "name") }, close)
        }
      >
        <Field label="Group" htmlFor="d-group" required>
          <Select id="d-group" name="groupId" required defaultValue="">
            <option value="" disabled>Choose a group</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="Name" htmlFor="d-name" required>
          <Input id="d-name" name="name" required maxLength={120} autoFocus />
        </Field>
      </FormModal>
    </>
  );
}

export function RenameDomainButton({ domainId, currentName }: { domainId: string; currentName: string }) {
  const [open, setOpen] = useState(false);
  const command = useCommand(`/outreach/domains/${domainId}`);
  const close = () => {
    setOpen(false);
    command.clear();
  };
  return (
    <>
      <CommandButton commands="verity.outreach.rename_domain" size="sm" variant="secondary" onClick={() => setOpen(true)}>
        Rename
      </CommandButton>
      <FormModal
        title="Rename domain"
        description="Leads and reports keep pointing at this domain under its new name."
        open={open}
        onClose={close}
        submitLabel="Rename"
        pending={command.pending}
        failure={command.failure}
        failureTitle="Could not rename the domain"
        onSubmit={(form) => command.run("verity.outreach.rename_domain", { domainId, name: formText(form, "name") }, close)}
      >
        <Field label="Name" htmlFor="rd-name" required>
          <Input id="rd-name" name="name" required maxLength={120} autoFocus defaultValue={currentName} />
        </Field>
      </FormModal>
    </>
  );
}

/* --------------------------- rep: check-in, report -------------------------- */

export function RepReportingActions({ leads }: { leads: Option[] }) {
  const [open, setOpen] = useState<"checkin" | "weekly" | null>(null);
  const command = useCommand("/outreach/workspace");
  const close = () => {
    setOpen(null);
    command.clear();
  };
  return (
    <div className="mb-6 flex flex-wrap gap-2">
      <CommandButton commands="verity.outreach.submit_check_in" variant="primary" onClick={() => setOpen("checkin")}>
        Daily check-in
      </CommandButton>
      <CommandButton commands="verity.outreach.submit_weekly_report" onClick={() => setOpen("weekly")}>
        Weekly report
      </CommandButton>

      <FormModal
        title="Daily check-in"
        description="What happened today, for your team lead."
        open={open === "checkin"}
        onClose={close}
        width="lg"
        submitLabel="Submit check-in"
        pending={command.pending}
        failure={command.failure}
        failureTitle="Could not submit the check-in"
        onSubmit={(form) =>
          command.run(
            "verity.outreach.submit_check_in",
            {
              checkInDate: dayStart(todayIso()),
              summary: formText(form, "summary"),
              bestLeadId: formOptional(form, "bestLeadId"),
              learning: formOptional(form, "learning"),
              blocker: formOptional(form, "blocker"),
              tomorrowPlan: formOptional(form, "tomorrowPlan"),
            },
            close,
          )
        }
      >
        <Field label="Summary" htmlFor="ci-summary" required>
          <Textarea id="ci-summary" name="summary" required rows={3} autoFocus />
        </Field>
        <Field label="Best lead today" htmlFor="ci-lead">
          <Select id="ci-lead" name="bestLeadId" defaultValue="">
            <option value="">None</option>
            {leads.map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </Select>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Learning" htmlFor="ci-learning">
            <Textarea id="ci-learning" name="learning" rows={2} />
          </Field>
          <Field label="Blocker" htmlFor="ci-blocker">
            <Textarea id="ci-blocker" name="blocker" rows={2} />
          </Field>
        </div>
        <Field label="Plan for tomorrow" htmlFor="ci-plan">
          <Textarea id="ci-plan" name="tomorrowPlan" rows={2} />
        </Field>
      </FormModal>

      <FormModal
        title="Weekly report"
        description="Your week in review, for the week starting Monday."
        open={open === "weekly"}
        onClose={close}
        width="lg"
        submitLabel="Submit report"
        pending={command.pending}
        failure={command.failure}
        failureTitle="Could not submit the report"
        onSubmit={(form) => {
          const target = formOptional(form, "nextWeekTargetValue");
          command.run(
            "verity.outreach.submit_weekly_report",
            {
              weekStart: dayStart(formText(form, "weekStart")),
              whatWorked: formOptional(form, "whatWorked"),
              whatDidntWork: formOptional(form, "whatDidntWork"),
              strongestOpportunityId: formOptional(form, "strongestOpportunityId"),
              biggestLearning: formOptional(form, "biggestLearning"),
              nextWeekChange: formOptional(form, "nextWeekChange"),
              nextWeekTargetValue: target ? Number.parseInt(target, 10) : undefined,
            },
            close,
          );
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Week starting" htmlFor="wr-week" required>
            <Input id="wr-week" name="weekStart" type="date" required defaultValue={thisMonday()} />
          </Field>
          <Field label="Strongest opportunity" htmlFor="wr-opp">
            <Select id="wr-opp" name="strongestOpportunityId" defaultValue="">
              <option value="">None</option>
              {leads.map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="What worked" htmlFor="wr-worked">
            <Textarea id="wr-worked" name="whatWorked" rows={2} />
          </Field>
          <Field label="What didn't" htmlFor="wr-didnt">
            <Textarea id="wr-didnt" name="whatDidntWork" rows={2} />
          </Field>
        </div>
        <Field label="Biggest learning" htmlFor="wr-learning">
          <Textarea id="wr-learning" name="biggestLearning" rows={2} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="What changes next week" htmlFor="wr-change">
            <Input id="wr-change" name="nextWeekChange" maxLength={500} />
          </Field>
          <Field label="Next week's target" htmlFor="wr-target">
            <Input id="wr-target" name="nextWeekTargetValue" type="number" min={1} step={1} />
          </Field>
        </div>
      </FormModal>
    </div>
  );
}

/* -------------------------------- team lead -------------------------------- */

const METRICS = ["QualifiedProspects", "Outreach", "FollowUps", "Responses", "Meetings", "Proposals", "Closed"] as const;
const METRIC_LABEL: Record<(typeof METRICS)[number], string> = {
  QualifiedProspects: "Qualified prospects",
  Outreach: "Outreach",
  FollowUps: "Follow-ups",
  Responses: "Responses",
  Meetings: "Meetings",
  Proposals: "Proposals",
  Closed: "Closed",
};
const SCOPES = [
  { value: "Domain", label: "Domain" },
  { value: "DomainGroup", label: "Market group" },
  { value: "Track", label: "Track" },
  { value: "Geography", label: "Geography" },
];

export function TeamLeadActions({ teamId, members }: { teamId: string; members: Option[] }) {
  const [open, setOpen] = useState<"target" | "assignment" | "assessment" | null>(null);
  const [scope, setScope] = useState<"Team" | "Individual">("Team");
  const [period, setPeriod] = useState<"Daily" | "Weekly">("Weekly");
  const command = useCommand("/outreach/team");
  const close = () => {
    setOpen(null);
    command.clear();
  };

  return (
    <div className="flex flex-wrap gap-2">
      <CommandButton commands="verity.outreach.set_target" size="sm" variant="secondary" onClick={() => setOpen("target")}>
        Set target
      </CommandButton>
      <CommandButton commands="verity.outreach.create_assignment" size="sm" variant="secondary" onClick={() => setOpen("assignment")} disabled={members.length === 0}>
        Assign territory
      </CommandButton>
      <CommandButton commands="verity.outreach.submit_team_weekly_assessment" size="sm" variant="secondary" onClick={() => setOpen("assessment")}>
        Weekly assessment
      </CommandButton>

      <FormModal
        title="Set target"
        description="A target for the team or one member over a day or a week."
        open={open === "target"}
        onClose={close}
        submitLabel="Set target"
        pending={command.pending}
        failure={command.failure}
        failureTitle="Could not set the target"
        onSubmit={(form) => {
          const start = formText(form, "start");
          const end = period === "Daily" ? start : formText(form, "end");
          command.run(
            "verity.outreach.set_target",
            {
              scope,
              teamId: scope === "Team" ? teamId : undefined,
              partyId: scope === "Individual" ? formText(form, "partyId") : undefined,
              period,
              metric: formText(form, "metric"),
              targetValue: Number.parseInt(formText(form, "value"), 10),
              periodStart: dayStart(start),
              periodEnd: dayEnd(end),
              changeReason: formOptional(form, "reason"),
            },
            close,
          );
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="For" htmlFor="tg-scope" required>
            <Select id="tg-scope" value={scope} onChange={(e) => setScope(e.target.value as "Team" | "Individual")}>
              <option value="Team">The whole team</option>
              <option value="Individual" disabled={members.length === 0}>One member</option>
            </Select>
          </Field>
          {scope === "Individual" && (
            <Field label="Member" htmlFor="tg-member" required>
              <Select id="tg-member" name="partyId" required defaultValue="">
                <option value="" disabled>Choose</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </Select>
            </Field>
          )}
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Metric" htmlFor="tg-metric" required>
            <Select id="tg-metric" name="metric" required defaultValue="Outreach">
              {METRICS.map((m) => (
                <option key={m} value={m}>{METRIC_LABEL[m]}</option>
              ))}
            </Select>
          </Field>
          <Field label="Period" htmlFor="tg-period" required>
            <Select id="tg-period" value={period} onChange={(e) => setPeriod(e.target.value as "Daily" | "Weekly")}>
              <option value="Weekly">Weekly</option>
              <option value="Daily">Daily</option>
            </Select>
          </Field>
          <Field label="Target" htmlFor="tg-value" required>
            <Input id="tg-value" name="value" type="number" min={1} step={1} required />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={period === "Daily" ? "Day" : "From"} htmlFor="tg-start" required>
            <Input id="tg-start" name="start" type="date" required defaultValue={period === "Daily" ? todayIso() : thisMonday()} />
          </Field>
          {period === "Weekly" && (
            <Field label="To" htmlFor="tg-end" required>
              <Input id="tg-end" name="end" type="date" required />
            </Field>
          )}
        </div>
        <Field label="Reason for the change" htmlFor="tg-reason">
          <Input id="tg-reason" name="reason" maxLength={500} />
        </Field>
      </FormModal>

      <FormModal
        title="Assign territory"
        description="Gives a member responsibility for a domain, market group, track or geography."
        open={open === "assignment"}
        onClose={close}
        submitLabel="Assign"
        pending={command.pending}
        failure={command.failure}
        failureTitle="Could not create the assignment"
        onSubmit={(form) =>
          command.run(
            "verity.outreach.create_assignment",
            { teamId, partyId: formText(form, "partyId"), scope: formText(form, "scope"), value: formText(form, "value") },
            close,
          )
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Member" htmlFor="as-member" required>
            <Select id="as-member" name="partyId" required defaultValue="">
              <option value="" disabled>Choose</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Kind" htmlFor="as-scope" required>
            <Select id="as-scope" name="scope" required defaultValue="Domain">
              {SCOPES.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Which" htmlFor="as-value" required hint="The domain, group, track or region name.">
          <Input id="as-value" name="value" required maxLength={200} />
        </Field>
      </FormModal>

      <FormModal
        title="Weekly team assessment"
        description="Your read of the team's week, for the founder."
        open={open === "assessment"}
        onClose={close}
        width="lg"
        submitLabel="Submit assessment"
        pending={command.pending}
        failure={command.failure}
        failureTitle="Could not submit the assessment"
        onSubmit={(form) =>
          command.run(
            "verity.outreach.submit_team_weekly_assessment",
            {
              teamId,
              weekStart: dayStart(formText(form, "weekStart")),
              strongestPerformerId: formOptional(form, "strongestPerformerId"),
              strongestVertical: formOptional(form, "strongestVertical"),
              biggestProblem: formOptional(form, "biggestProblem"),
              biggestLearning: formOptional(form, "biggestLearning"),
              nextWeekPriority: formOptional(form, "nextWeekPriority"),
            },
            close,
          )
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Week starting" htmlFor="ta-week" required>
            <Input id="ta-week" name="weekStart" type="date" required defaultValue={thisMonday()} />
          </Field>
          <Field label="Strongest performer" htmlFor="ta-performer">
            <Select id="ta-performer" name="strongestPerformerId" defaultValue="">
              <option value="">Not chosen</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Strongest vertical" htmlFor="ta-vertical">
          <Input id="ta-vertical" name="strongestVertical" maxLength={200} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Biggest problem" htmlFor="ta-problem">
            <Textarea id="ta-problem" name="biggestProblem" rows={2} />
          </Field>
          <Field label="Biggest learning" htmlFor="ta-learning">
            <Textarea id="ta-learning" name="biggestLearning" rows={2} />
          </Field>
        </div>
        <Field label="Next week's priority" htmlFor="ta-priority">
          <Input id="ta-priority" name="nextWeekPriority" maxLength={500} />
        </Field>
      </FormModal>
    </div>
  );
}
