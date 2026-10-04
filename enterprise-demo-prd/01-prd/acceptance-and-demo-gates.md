# Acceptance & Demo Gates

## P0 feature acceptance
A P0 capability passes only when:
1. data model exists and respects canonical identity/tenant boundaries;
2. valid commands/queries exist;
3. state changes are explicit;
4. authorization is enforced server-side;
5. audit/evidence is recorded where required;
6. UI supports happy, empty, loading, error and denied states;
7. automated tests cover positive and negative paths;
8. the capability is used by at least one seeded demo workflow.

## External-demo gate
No P0 screen with fake data, broken links, dead actions, missing loading/error states or manual DB setup is allowed.
