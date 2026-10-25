"use client";

import { useRouter } from "next/navigation";
import { DateField } from "@/components/ui/DateTimePicker";

/** The day shown on Today: the same calendar every form uses; picking a day opens that day. */
export function DayPicker({ date, today }: { date: string; today: string }) {
  const router = useRouter();
  return (
    <div className="w-44">
      <DateField id="today-day" value={date} onChange={(v) => v && router.push(v === today ? "/lots/today" : `/lots/today?date=${v}`)} required />
    </div>
  );
}
