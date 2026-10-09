-- ---------------------------------------------------------------------------
-- An expense can cover a period (Task 126 item 1.3)
-- ---------------------------------------------------------------------------
-- A monthly electricity bill pays for thirty days, not for the day it was paid. With
-- a period set, the outlet P&L spreads the amount across those days the way it
-- already spreads salaries. Without one, the expense belongs to its own date.

ALTER TABLE "expense"
  ADD COLUMN "period_from" DATE,
  ADD COLUMN "period_to" DATE;

ALTER TABLE "expense"
  ADD CONSTRAINT "expense_period_both_or_neither" CHECK (("period_from" IS NULL) = ("period_to" IS NULL)),
  ADD CONSTRAINT "expense_period_ordered" CHECK ("period_from" IS NULL OR "period_to" >= "period_from");
