# Verity on your own server: operations guide

For the person who looks after the server (Mode B: everything runs inside your network, nothing depends on an outside service).
Every command is run on the Verity server from the folder you installed into. Where a step needs a decision from the owner, it
says so.

**What was and was not tested.** This procedure was rehearsed end to end on a Linux machine with Docker: install, sign-in, file
upload from a browser, adding a person, backup, deleting everything and restoring, and running with all outside network access
blocked. It has **not** yet been run on your server. Windows Server 2019 cannot run Linux containers directly, so Verity needs
either a Linux virtual machine on that server (Hyper-V) or a small separate Linux machine. Do not call the installation
"validated" until section 9 has been completed on your hardware.

## 1. What runs, and what you must provide

Seven containers: the application, its scheduler, its database, Keycloak (sign-in) with its own database, the file store, and the
web proxy that gives everything a secure `https` address. All of them are on a private network with no route to the internet or to
the rest of your office network. Only the proxy accepts connections from your office.

You provide:

- A Linux machine or virtual machine with Docker Engine 24 or newer and the Compose plugin, 4 GB of memory and 20 GB of disk
  to start (more for photos), a fixed IP address, and a clock kept right (NTP).
- Three names that your office network resolves to that machine's address. Example for the name `dsew.lan`:
  `verity.dsew.lan` (what staff type), `idp.dsew.lan` (sign-in), `files.dsew.lan` (photos and documents). Add them to your router's
  DNS, or to each device's hosts file if there is no DNS server.
- A place **outside this machine** for backups, and a named person responsible for it.
- Someone able to install a certificate on staff PCs and phones (section 3).

## 2. Install

```bash
git clone <repository> verity && cd verity
VERITY_DEPLOYMENT_MODE=B VERITY_APP_HOST=verity.dsew.lan ./deploy/scripts/install.sh   # writes deploy/config/verity.env and stops
./deploy/scripts/install.sh                                                            # builds, migrates, starts, checks
```

The first run writes `deploy/config/verity.env` with strong generated passwords and stops. **Copy that file to a sealed, offline
place now (a USB stick in the owner's safe).** It cannot be recovered from the server, and a restore needs it.

The second run creates the certificate authority and server certificate, renders the sign-in settings, starts everything, applies
the database migrations and ends with "install complete". If it refuses, it says which check failed and why; fix that and run it
again, it is safe to repeat.

When it finishes, **move `deploy/config/tls/root.key` off the server** (to the same sealed place). Nothing needs it after the
certificate is made, and anyone holding it can create certificates your devices would trust.

## 3. Make PCs and phones trust the certificate

Give each device `deploy/config/tls/root.crt` (it is public; email is fine) and install it as a trusted root authority. See
`deploy/docs/trust-the-ca.md` for Windows, Android and iPhone. Until a device trusts it, its browser shows a warning for
`verity.dsew.lan`; do not teach staff to click through that warning.

## 4. Add a person, and remove one

```bash
./deploy/scripts/provision-oidc-user.sh "<workspace name>" "<role name>" person@example.com "Full Name"
```

It prints a one-time password for new people (they must change it at first sign-in). It refuses, creating nothing, if the workspace
or role name is wrong. Running it again for the same person changes nothing.

To remove someone **both** steps are needed, because they do different things:

1. Disable the account in Keycloak so they cannot sign in again (Keycloak is reachable only from this server, not from the office:
   `docker compose exec keycloak /opt/keycloak/bin/kcadm.sh ...`, or ask for the administrator console to be opened temporarily).
2. In Verity, disable their access. This ends any session they already have, at its next request. **There is no screen for this
   yet** (the command exists and is tested, ADR-049, but nothing in the application calls it); until one is added, Verity
   support runs it for you. Without this step an already signed-in person keeps working until their session expires (1 hour idle,
   8 hours at most).

## 5. Backups

```bash
./deploy/scripts/backup.sh
```

One run writes five files named with the same date and time into `deploy/backups/`: the Verity database, the Keycloak database,
the file store, the certificates, and a `.manifest` that records a checksum of each. The file store is stopped for a few seconds
while it is copied, so run backups in a quiet hour (nightly, outside shop hours). The script reads each dump back before it reports
success.

**A backup that stays on the same machine is not a backup.** Copy the whole set (all five files) to another machine or disk every
time, and keep the sealed `verity.env` from section 2 with it. Ask the owner to agree how much work can be lost (the interval
between backups) and how long you can be without the system; those numbers are not yet fixed and have not been measured on
your hardware.

## 6. Restore

Restoring **replaces** the database, sign-in accounts and files with the backup. It refuses to start unless every file in the set
is present and matches its checksum.

```bash
# on a rebuilt machine: install first (section 2), copy the sealed verity.env back to deploy/config/ BEFORE running install,
# copy the backup set into deploy/backups/, then:
VERITY_RESTORE_CONFIRM=yes ./deploy/scripts/restore.sh deploy/backups/verity-<date>.dump
```

A good restore ends with "restore complete and verified". Then open Verity, sign in and check a recent job and a photo. If the
script stops with an error, the application stays stopped on purpose; send the error text to Verity support, do not retry blindly.

## 7. Upgrade

```bash
./deploy/scripts/backup.sh          # always first
./deploy/scripts/upgrade.sh
```

Upgrades only move forward. If one fails after the database was changed, the way back is a restore of the backup you just took.

## 8. What happens when something is down

| If this stops | New sign-in | People already signed in | Photos and documents | Page `/api/ready` |
|---|---|---|---|---|
| Sign-in service (Keycloak) | fails with a clear message | keep working until their session ends | work | `degraded` |
| File store | works | works | upload and download fail with a clear message; checkpoints that need a photo wait | `degraded` |
| Scheduler | works | works | work | `degraded` after 15 minutes; background reminders stop |
| Database | fails | fail | fail | `not_ready` (503) |

Nothing in this table ever skips a permission check or lets a step pass without the evidence it requires.

## 9. Before anyone says "it is installed at DSEW"

All of these on **your** hardware, by you, with the owner present, written down with the date:

1. Clean install from section 2 on the intended machine, start to "install complete".
2. Sign in through Keycloak from a PC and from a phone on the office Wi-Fi, with the certificate installed.
3. Create a job and upload a photo from the phone.
4. Take a backup, copy it off the machine, delete everything (`docker compose down -v`), restore, and see the same job and photo.
5. Confirm the application has no route out. This must print `blocked`:
   `docker exec verity-web-1 node -e "fetch('http://1.1.1.1',{signal:AbortSignal.timeout(5000)}).then(()=>console.log('REACHED')).catch(()=>console.log('blocked'))"`

## 10. Not covered, so you are not surprised

Hindi screens on the shop floor, Tally integration, a customer-facing portal, and AI assistance are not part of this installation.
AI is **off** and the network is closed; if the owner later wants it, it is added as a separate, allow-listed outbound route for
one purpose only, never by opening the network. Windows Server 2019 compatibility, your real disk and memory, and recovery times
are unmeasured until section 9 is done.
