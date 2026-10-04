# Sales Order

## States
Draft → Confirmed → Partially Fulfilled → Fulfilled/Cancelled

## Transition rule
A permitted command + authorized actor + valid preconditions produces the next state and side effects. Invalid transitions do not mutate state.
