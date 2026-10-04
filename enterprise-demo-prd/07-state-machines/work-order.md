# Work Order

## States
Draft → Scheduled → Assigned → In Progress → Blocked/Completed/Cancelled

## Transition rule
A permitted command + authorized actor + valid preconditions produces the next state and side effects. Invalid transitions do not mutate state.
