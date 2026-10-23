# Test logins: DSEW and Stylified

One local environment, both demos, every user, one password. Local only: it opens nothing outside this computer.

```
bash scripts/demo-env.sh up            start everything (first time about 8 minutes: database, logins, both seeds, build)
bash scripts/demo-env.sh up --reset    throw the demo database away and seed both tenants again
bash scripts/demo-env.sh logins        print the table below
bash scripts/demo-env.sh down          stop the app
```

Then open **http://localhost:3000**, press **Continue with organization sign-in**, and type a username and the password.

**Password for every login: `Demo-1234`**

## DSEW (D & S Electric Works, electrical manufacturer, Indore)

| Username | Role | What it sees |
|---|---|---|
| `dsew-owner` | Owner | Everything: jobs, quotes, production orders, stock, accounting, HR, documents, reports |
| `dsew-supervisor` | Supervisor | The shop floor plus manufacturing orders, routes, bills of materials and batches. No money, jobs or customers |
| `dsew-worker` | Floor worker | Shop-floor stages only (winding). Built for a phone: open it at 390 px |

## Stylified (shirt factory, Ludhiana)

| Username | Role | What it sees |
|---|---|---|
| `stylified-owner` | Owner | Everything: factory dashboard, approvals above the manager limit, team and limits, wages |
| `stylified-manager` | Manager | Approvals inbox within the owner's limits; lots, karigars, wages |
| `stylified-supervisor-a` | Supervisor | Floor screens at Collar and Stitching (a late outside unit, Karigar A holds 37 pieces). No money anywhere |
| `stylified-supervisor-b` | Supervisor | Floor screens at Pasting, Kaj and Finishing; has a closed day with a Hindi handover note |
| `stylified-munshi` | Munshi | Daily entry in Hindi or English, lots, bundles, karigars, wages |

The email of each login also works as the username (`dsew-owner@dsew.demo`, `stylified-manager@stylified.demo`, and so on).

## Good first moves

- **Stylified, phone width (390 px):** sign in as `stylified-supervisor-a`, open **My floor**, press **Take back**, pick B-0002, count with plus and minus.
  Switch to **हिंदी** at the top. Then sign in as `stylified-manager` and open **Approvals**.
- **Stylified, above the limit:** `stylified-manager` cannot approve the ₹2,500 deduction (it is above the ₹1,000 limit); `stylified-owner` can.
- **Stylified, no money for a supervisor:** as `stylified-supervisor-a`, open **Karigars**: refused.
- **DSEW:** `dsew-owner` opens **Jobs** and the finished 100 kVA transformer job; `dsew-worker` sees only the shop floor.

## Photographs

The script starts a local S3-compatible server when the Docker container `sty-minio` exists, so a defect photograph taken on the supervisor's
screen or a lot cover uploaded from a lot page is really stored. Without that container the photo step says file storage is not set up and
everything else works.

## What this is and is not

- It runs on this machine only: its own database (`verity_local_demo`), the local Keycloak realm `dsew`, and the application started with every
  Supabase and production variable blank and without the repository's `.env` files.
- The password is a throwaway for local logins and is the same for every user so it is easy to type. It is **not** a pattern for any hosted
  workspace: a hosted login gets its own generated password through the seed, shared privately.
- The earlier local login called `owner` (`owner@dsew.demo`) is left alone and unused by this environment.
- Every name, price and figure in both tenants is fictional.
