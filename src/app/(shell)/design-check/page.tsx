import { Button, Field, Input, PageHeader, Panel, Row, RowList, Stat, StatRow, StateBadge, StatTile, StatTileRow } from "@/components/ui/primitives";

// TEMPORARY visual check page for the light-theme pass. Delete before commit.
export const dynamic = "force-dynamic";

export default function DesignCheck() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Jobs" description="Open work across the shop, most urgent first." actions={<Button variant="primary">New job</Button>} />
      <StatTileRow>
        <StatTile kind="production" label="In production" value="12" hint="3 due this week" href="#" />
        <StatTile kind="quote" label="Open quotes" value="7" hint="2 awaiting reply" href="#" />
        <StatTile state="blocked" icon="flag" label="Blocked" value="2" hint="waiting on stock" href="#" />
        <StatTile state="completed" icon="check" label="Dispatched" value="18" hint="this month" href="#" />
      </StatTileRow>
      <StatRow cols={3}>
        <Stat kind="asset" label="Assets in scope" value={24} />
        <Stat icon="check" state="completed" label="Inside fence" value={19} />
        <Stat icon="flag" state="pending" label="Outside fence" value={5} hint="needs a look" />
      </StatRow>
      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Panel title="Production queue">
          <RowList>
            {[
              ["TR-2041 · 500 kVA transformer", "Winding", "Active"],
              ["EM-1187 · Lifting electromagnet", "Testing", "Pending"],
              ["TR-2037 · 250 kVA transformer", "Core stacking", "Blocked"],
              ["CS-0912 · Control panel", "Dispatch", "Completed"],
            ].map(([n, s, c]) => (
              <Row key={n}>
                <div className="min-w-0 flex-1">
                  <p className="m-0 text-[15px] font-medium text-text">{n}</p>
                  <p className="m-0 text-[13px] text-text-secondary">{s}</p>
                </div>
                <StateBadge category={c as string} />
              </Row>
            ))}
          </RowList>
        </Panel>
        <Panel title="Quick add">
          <div className="flex flex-col gap-4">
            <Field label="Customer" htmlFor="c"><Input id="c" placeholder="Search customers" /></Field>
            <Field label="Item" htmlFor="i"><Input id="i" placeholder="500 kVA transformer" /></Field>
            <div className="flex gap-2"><Button variant="primary">Create</Button><Button>Cancel</Button><Button variant="ghost">Later</Button></div>
          </div>
        </Panel>
      </div>
    </div>
  );
}
