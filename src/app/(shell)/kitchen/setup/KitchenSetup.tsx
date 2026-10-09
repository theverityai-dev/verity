"use client";

import { useState } from "react";
import { CommandButton } from "@/components/ui/CommandAccess";
import { CommandFailure, useCommand } from "@/components/ui/CommandForm";
import { Checkbox, EmptyState, Field, Input, Panel } from "@/components/ui/primitives";
import type { KitchenSetup as Setup } from "@/server/capabilities/dinein";

/**
 * Stations and courses (ADR-041). A station names the menu categories it cooks; a
 * dish goes to its category's station when it is ordered, and to the outlet's
 * default station when no station claims the category. A course orders the pass:
 * lower numbers come first.
 */
export function KitchenSetup({ setup }: { setup: Setup }) {
  const station = useCommand("/kitchen/setup");
  const course = useCommand("/kitchen/setup");
  const [editingStation, setEditingStation] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-6">
      <CommandFailure failure={station.failure} title="Could not save the station" />
      <CommandFailure failure={course.failure} title="Could not save the course" />

      <Panel title="Courses" action={<span className="text-[12px] text-text-tertiary">Lower numbers are served first</span>}>
        <ul className="m-0 mb-4 flex list-none flex-col gap-2 p-0">
          {setup.courses.length === 0 && <li className="text-[14px] text-text-secondary">No courses yet. Add Starters, Mains, Desserts, then give each dish its course on the Menu.</li>}
          {setup.courses.map((c) => (
            <li key={c.id}>
              <form
                className="flex flex-wrap items-end gap-3"
                action={(formData) =>
                  course.run("verity.dinein.save_menu_course", {
                    courseId: c.id,
                    name: String(formData.get("name") ?? ""),
                    priority: Number(formData.get("priority") ?? 0),
                    active: formData.get("active") === "on",
                  })
                }
              >
                <div className="min-w-[200px] flex-1">
                  <Field label="Course" htmlFor={`course-${c.id}`}>
                    <Input id={`course-${c.id}`} name="name" required defaultValue={c.name} maxLength={60} />
                  </Field>
                </div>
                <div className="w-[100px]">
                  <Field label="Order" htmlFor={`prio-${c.id}`}>
                    <Input id={`prio-${c.id}`} name="priority" type="number" min={0} max={99} defaultValue={c.priority} />
                  </Field>
                </div>
                <Checkbox name="active" label="In use" defaultChecked={c.active} className="min-h-11" />
                <CommandButton commands={"verity.dinein.save_menu_course"} type="submit" disabled={course.pending}>Save</CommandButton>
              </form>
            </li>
          ))}
        </ul>
        <form
          className="flex flex-wrap items-end gap-3 border-t border-line pt-4"
          action={(formData) =>
            course.run("verity.dinein.save_menu_course", {
              name: String(formData.get("name") ?? ""),
              priority: Number(formData.get("priority") ?? 0),
              active: true,
            })
          }
        >
          <div className="min-w-[200px] flex-1">
            <Field label="New course" htmlFor="course-new">
              <Input id="course-new" name="name" required maxLength={60} placeholder="Starters" />
            </Field>
          </div>
          <div className="w-[100px]">
            <Field label="Order" htmlFor="prio-new">
              <Input id="prio-new" name="priority" type="number" min={0} max={99} defaultValue={setup.courses.length + 1} />
            </Field>
          </div>
          <CommandButton commands={"verity.dinein.save_menu_course"} type="submit" variant="primary" disabled={course.pending}>Add course</CommandButton>
        </form>
      </Panel>

      {setup.outlets.length === 0 && <EmptyState title="No outlets in your scope" description="Stations belong to an outlet." />}
      {setup.outlets.map((outlet) => (
        <Panel key={outlet.locationId} title={`${outlet.locationName}: stations`}>
          {outlet.stations.length === 0 ? (
            <p className="m-0 mb-4 text-[14px] text-text-secondary">
              No stations yet, so one kitchen queue serves the whole outlet. Add a default station, then a Bar or Grill that takes certain categories.
            </p>
          ) : (
            <ul className="m-0 mb-4 flex list-none flex-col gap-4 p-0">
              {outlet.stations.map((s) => {
                const open = editingStation === s.id;
                return (
                  <li key={s.id} className="rounded-lg border border-line p-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <span className="text-[15px] font-medium text-text">
                        {s.name}
                        {s.isDefault && <span className="ml-2 text-[12px] text-text-tertiary">default, takes any category no station claims</span>}
                        {!s.active && <span className="ml-2 text-[12px] text-text-tertiary">not in use</span>}
                      </span>
                      <CommandButton commands={"verity.dinein.set_station_categories"} size="sm" onClick={() => setEditingStation(open ? null : s.id)}>
                        {open ? "Close" : "Edit"}
                      </CommandButton>
                    </div>
                    <p className="mb-0 mt-1 text-[13px] text-text-secondary">
                      {s.categoryIds.length === 0
                        ? "No categories claimed"
                        : s.categoryIds.map((id) => setup.categories.find((c) => c.id === id)?.name ?? "").filter(Boolean).join(", ")}
                    </p>
                    {open && (
                      <form
                        className="mt-3 flex flex-col gap-3 border-t border-line pt-3"
                        action={(formData) => {
                          station.run(
                            "verity.dinein.save_kitchen_station",
                            {
                              stationId: s.id,
                              locationId: outlet.locationId,
                              name: String(formData.get("name") ?? ""),
                              isDefault: formData.get("isDefault") === "on",
                              active: formData.get("active") === "on",
                            },
                            () =>
                              station.run(
                                "verity.dinein.set_station_categories",
                                { stationId: s.id, categoryIds: formData.getAll("category").map(String) },
                                () => setEditingStation(null),
                              ),
                          );
                        }}
                      >
                        <Field label="Station name" htmlFor={`sn-${s.id}`}>
                          <Input id={`sn-${s.id}`} name="name" required defaultValue={s.name} maxLength={60} />
                        </Field>
                        <div className="flex flex-wrap gap-4">
                          <Checkbox name="isDefault" label="Default station" defaultChecked={s.isDefault} className="min-h-11" />
                          <Checkbox name="active" label="In use" defaultChecked={s.active} className="min-h-11" />
                        </div>
                        <fieldset className="m-0 flex flex-wrap gap-x-5 gap-y-1 border-0 p-0">
                          <legend className="mb-1 text-[13px] text-text-secondary">Categories cooked here (taken from any other station)</legend>
                          {setup.categories.map((c) => (
                            <Checkbox key={c.id} name="category" value={c.id} label={c.name} defaultChecked={s.categoryIds.includes(c.id)} className="min-h-11" />
                          ))}
                        </fieldset>
                        <div>
                          <CommandButton commands={"verity.dinein.set_station_categories"} type="submit" variant="primary" disabled={station.pending}>
                            Save station
                          </CommandButton>
                        </div>
                      </form>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          <form
            className="flex flex-wrap items-end gap-3 border-t border-line pt-4"
            action={(formData) =>
              station.run("verity.dinein.save_kitchen_station", {
                locationId: outlet.locationId,
                name: String(formData.get("name") ?? ""),
                isDefault: formData.get("isDefault") === "on" || outlet.stations.length === 0,
                active: true,
              })
            }
          >
            <div className="min-w-[200px] flex-1">
              <Field label="New station" htmlFor={`new-${outlet.locationId}`}>
                <Input id={`new-${outlet.locationId}`} name="name" required maxLength={60} placeholder={outlet.stations.length === 0 ? "Kitchen" : "Bar"} />
              </Field>
            </div>
            {outlet.stations.length > 0 && <Checkbox name="isDefault" label="Make it the default" className="min-h-11" />}
            <CommandButton commands={"verity.dinein.save_kitchen_station"} type="submit" variant="primary" disabled={station.pending}>
              Add station
            </CommandButton>
          </form>
        </Panel>
      ))}
    </div>
  );
}
