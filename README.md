# Spaces
Spaces is a web app that creates secure cloud based development environments, accessible through a web browser. The goal of this project is to allow people to create amazing projects no matter what hardware they have access to. Spaces was developed by [Ivie Fonner](https://github.com/charmunks/), [Arnav](https://github.com/arnavravinder) and [Hack Club](https://github.com/hackclub/)

## How it works

- **Website and API** run on Vercel as two services from this repo ([vercel.json](vercel.json)):
  - `app`: the Express API in [src/](src/), served under `/api`.
  - `client`: the Svelte website in [client/](client/), served for every other path.
- **Each space is a Vercel Sandbox**, a small virtual machine named `space-<uuid>`. Sandboxes are persistent: when a space stops, Vercel saves a snapshot of its disk, and the next start resumes from it. Only the latest snapshot is kept, and it never expires.
  - Sandboxes run in Stockholm (`arn1`), with Frankfurt (`fra1`) as a fallback.
  - A session lasts at most 3 hours. A Vercel cron job calls `/api/v1/cron/auto-stop` every 5 minutes to stop spaces that have run longer and to fix the database for spaces that already stopped.
- **VS Code spaces** run [code-server](https://github.com/coder/code-server) directly in the sandbox, on Vercel's default `universal` image. code-server is installed on first start, and the user's files live in `/vercel/sandbox/<space name>`. New spaces get [in-space.md](in-space.md) as their `README.md`, which lists the tools the image includes and how to install more with `sudo apt`. Spaces copied from the old server get it as `WELCOME.md`, so their own README is left alone.
- **Blender, KiCad and FreeCAD spaces** run Docker inside the sandbox, with the [linuxserver.io](https://www.linuxserver.io/) image for each app. The app's files live in `/vercel/sandbox/config`. The browser logs in with HTTP basic auth: username `abc`, with the space's password.
- **JetBrains spaces** (IntelliJ IDEA, WebStorm, RubyMine and RustRover, in beta) run the same way, on the `linuxserver/webtop:debian-xfce` desktop with 4 vCPUs. Each has an image built from a pinned IDE release (checked against JetBrains' SHA-256) with the language's tools: a JDK and Maven, Node.js, Ruby, or rustup and a C toolchain. The WakaTime plugin is in the IDE's own plugins folder, so Hackatime works with the key from Settings. Users sign in with their own JetBrains account the first time; the IDEs are free for non-commercial use. To update an IDE, change its `url` and `build` in [src/utils/spaces.js](src/utils/spaces.js).
- **Database:** PostgreSQL, hosted on Hack Club's Orchard. Migrations run with knex on every deploy.
- **Login:** email codes (sent through an Airtable automation on the "Spaces Emails" table), Hack Club Auth (OAuth at auth.hackclub.com), or email and password for club members. Club membership and leader status come from the Clubs API.

## Local setup

### Prerequisites
- Node.js 22 or newer and npm
- A PostgreSQL database
- An Airtable base with the "Spaces Emails" table, and a token for it
- A Vercel access token, team and project to create sandboxes in. Use a separate project from production, because every space you create locally is a real sandbox.

### Installation
```bash
git clone https://github.com/hackclub/spaces.git
cd spaces

cp example.env .env # fill out the .env

npm install

npm run client-install

npm run migrate
```

### Running the API and website
```bash
# run both
npm run dev

# or run them separately
npm run serve:server   # API on http://localhost:3000
npm run serve:client   # website on http://localhost:5173, which forwards /api to the API
```

The local API also runs the auto-stop job every 5 minutes, since the Vercel cron job only exists in production.

### Dev account
```bash
npm run create-fake-user
```

That creates an admin account with the login token `w`. To log in as it, run this in the browser console on the local website and refresh:
```js
document.cookie = "auth_token=w; path=/"
```

### Environment variables

| Variable | Required | Description |
|---|---|---|
| `PG_CONNECTION_STRING` | yes | PostgreSQL connection URL |
| `AIRTABLE_API_KEY` | yes | Airtable token with access to the Spaces base |
| `AIRTABLE_BASE_ID` | yes | ID of the Airtable base with the "Spaces Emails" table |
| `HACKCLUB_CLIENT_ID` | yes | Hack Club Auth OAuth app ID |
| `HACKCLUB_CLIENT_SECRET` | yes | Hack Club Auth OAuth app secret |
| `HACKCLUB_REDIRECT_URI` | yes | OAuth callback, `<site>/api/v1/oauth/callback`. It must also be allowed in the OAuth app. |
| `HACKCLUB_CLUBS_API_KEY` | yes | Key for the Clubs API (club membership and leader lookups) |
| `FRONTEND_URL` | yes | The website's address, used for CORS |
| `CRON_SECRET` | production | Shared secret for the auto-stop cron job. Vercel sends it automatically. |
| `VERCEL_TOKEN`, `VERCEL_TEAM_ID`, `VERCEL_PROJECT_ID` | local only | Credentials for creating sandboxes outside Vercel. On Vercel, sandboxes use the deployment's built-in OIDC login, so leave these unset there. |
| `SANDBOX_VCPUS` | no | vCPUs for VS Code spaces (default 2) |
| `SPACES_CREATION_PAUSED` | no | Set to `true` to stop new spaces from being created |
| `PORT` | no | Local API port (default 3000) |
| `NODE_ENV` | no | `development` or `production` |

## Deploying

Vercel deploys the production branch automatically on every push. Production builds run `npm run migrate` first, so new migrations apply before the new code goes live. Preview builds skip it: they have no database, and unmerged migrations must never touch production. Production environment variables are set in the Vercel project's settings.

## Scripts

- [scripts/migrate-to-sandboxes.js](scripts/migrate-to-sandboxes.js): one-time copy of spaces from the old Docker server into sandboxes. Run it on the old server. Flags: `--dry-run`, `--link`, `--concurrency`, `--limit`, `--id`, `--redo-since <ISO time>`, `--log`.
- [scripts/spaces-backup.sh](scripts/spaces-backup.sh): nightly database backup on the old Docker server, until it's retired.

## API Documentation

The API is served at `/api/v1`.

### Authentication

Logging in sets an `auth_token` cookie, which the website sends automatically. Other clients can send the same token in the `Authorization` header instead. Each login gets its own token, so a user can be logged in on several devices at once. Tokens last 7 days, and signing out ends only that device's login. The database keeps only a SHA-256 hash of each token, in the `sessions` table, and the auto-stop job deletes expired ones. Each login is also added to the `logins` table (user, time and method: `hackclub`, `email` or `password`), which is kept for the admin stats.

### Users API (`/api/v1/users`)

| Method | Path | Description |
|---|---|---|
| POST | `/send` | Email a 6-digit login code. Body: `{ "email" }`. Limited to one per minute and five per hour per address. |
| POST | `/signup` | Create an account. Body: `{ "email", "username", "verificationCode" }` |
| POST | `/login` | Log in. Body: `{ "email", "verificationCode" }` |
| POST | `/signout` | Sign out and replace the login token |
| GET | `/me` | The logged-in user |
| PUT | `/update` | Change username, Hackatime API key or VS Code extensions. Body: any of `{ "username", "hackatime_api_key", "vscode_extensions" }` |
| POST | `/update` | Change email. Body: `{ "email", "oldEmailVerificationCode", "emailVerificationCode" }`, with codes sent to both the current and the new address |
| POST | `/club-member/check` | Whether an email is in a club. Body: `{ "email" }`. Returns `isMember`, `isLeader`, `hasExistingAccount` and `hasPasswordAuth`, but not the club's name. |
| POST | `/club-member/signup` | Create an account as a club member. Body: `{ "email", "username", "password", "verificationCode" }`. Club leaders must use Hack Club Auth. |
| POST | `/club-member/login` | Log in with email and password. Body: `{ "email", "password" }` |

Codes allow five wrong guesses, expire after 5 minutes and work once.

### Hack Club Auth (`/api/v1/oauth`)

| Method | Path | Description |
|---|---|---|
| GET | `/hackclub/login` | Start logging in with Hack Club |
| POST | `/hackclub/link` | Start linking a Hack Club account to the logged-in user. Returns `{ "url" }` to send the browser to. |
| GET | `/callback` | Where Hack Club sends the browser back. The `state` must match the cookie set by the request that started the flow. |
| GET | `/status` | Whether the user's Hack Club account is linked, and its verification status |
| POST | `/refresh-verification` | Re-check the verification status with Hack Club |
| POST | `/unlink` | Unlink the Hack Club account |

### Spaces API (`/api/v1/spaces`)

Creating a space needs a verified Hack Club account or a club membership. Each user can run one space at a time unless an admin raises their limit (`users.max_running`).

#### Create a space
- **POST** `/api/v1/spaces/create`
- **Body**:
  ```json
  {
    "type": "code-server",
    "name": "my-project"
  }
  ```
  `name` is required for VS Code spaces and ignored for the others. It names the project folder, which Hackatime uses as the project name. Spaces become `-`, and anything other than letters, numbers, `-`, `_` and `.` is removed. A name with nothing left after that is refused. Blender, KiCad and FreeCAD spaces are named after the app. Any space can be renamed later; that only changes the name on the dashboard, not the folder.
- **Response**:
  ```json
  {
    "message": "Space created successfully",
    "spaceId": 1,
    "containerId": "space-0b6c5f0e-1d6e-4c1a-9a43-3f1f2f0c9e27",
    "type": "code-server",
    "description": "VS Code Server",
    "image": "vercel/sandbox/universal",
    "port": 8080,
    "accessUrl": "https://sb-xxxx.vercel.run",
    "password": "generated-password"
  }
  ```
  `containerId` is the sandbox's name.

#### Other space routes

| Method | Path | Description |
|---|---|---|
| POST | `/start/:spaceId` | Start a space. Returns `{ "message", "spaceId", "containerId" }`. |
| POST | `/stop/:spaceId` | Stop a space. Vercel saves its snapshot. |
| GET | `/status/:spaceId` | `{ "spaceId", "containerId", "type", "description", "accessUrl", "status", "running", "startedAt" }` |
| GET | `/types` | The space types this user can create: `{ value, label, description, kind, beta }`. Beta types only show for users with beta access and superadmins. |
| GET | `/list` | The user's spaces, each with `id`, `type`, `name`, `folder` (VS Code spaces only), `access_url`, `password`, `running`, `is_favorite`, `last_opened_at` and `status` |
| POST | `/password/:spaceId` | Change a space's password. Body: `{ "password" }` (8 to 128 characters). A running space restarts its app. |
| DELETE | `/delete/:spaceId` | Delete a space and its sandbox |
| POST | `/:spaceId/favorite` | Toggle favourite |
| POST | `/:spaceId/rename` | Rename a space on the dashboard. Body: `{ "name" }` (1 to 64 characters). The folder inside the space keeps its name. |
| POST | `/:spaceId/open` | Record that the owner opened the space, for its "last opened" time |
| POST | `/:spaceId/share/club` | Share with or unshare from the user's club leaders. Body: `{ "share": true }` |
| GET | `/:spaceId/share/status` | Whether the space is shared |
| GET | `/shared-with-me` | For club leaders: spaces their members shared. Links are returned without passwords. |

### Space types

| Type | Description | Runs |
|---|---|---|
| `code-server` | VS Code | code-server in the sandbox |
| `blender` | Blender 3D | `linuxserver/blender` in Docker |
| `kicad` | KiCad PCB Design | `linuxserver/kicad` in Docker |
| `freecad` | CAD software | `linuxserver/freecad` in Docker |
| `intellij` (beta) | IntelliJ IDEA | IntelliJ IDEA on `linuxserver/webtop:debian-xfce` in Docker |
| `webstorm` (beta) | WebStorm | WebStorm on `linuxserver/webtop:debian-xfce` in Docker |
| `rubymine` (beta) | RubyMine | RubyMine on `linuxserver/webtop:debian-xfce` in Docker |
| `rustrover` (beta) | RustRover | RustRover on `linuxserver/webtop:debian-xfce` in Docker |

### Clubs API (`/api/v1/clubs`)

| Method | Path | Description |
|---|---|---|
| POST | `/link` | Link the user to their club, found by email. Linking as a leader needs a linked Hack Club account. |
| POST | `/unlink` | Unlink from the club |
| GET | `/me` | The user's club and role |
| GET | `/me/details` | More details about the club |
| GET | `/me/ships` | The club's shipped projects |
| GET | `/me/members` | For leaders with a linked Hack Club account: the club's members |

### Admin API (`/api/v1/admin`)

Admin only (admins and superadmins). Every route is a POST, and every change is written to the `admin_actions` audit log. Admins can only manage regular users; superadmins can manage everyone and are the only ones who can make admins or superadmins.

| Path | Description |
|---|---|
| `/analytics` | User and space counts |
| `/stats` | Daily growth for the last 7, 30 or 90 days (`{ "days": 30 }`): new users, logins, people using spaces, new spaces, starts and hours. Sign-up dates and the `logins` table start on 7 Nov 2026 and space use on 2 Nov 2026; earlier days come back as `null`, not 0. |
| `/usage` | Running time per user for the last 1, 7 or 30 days (`{ "days": 7 }`) |
| `/sandbox-stats` | Sandbox and snapshot storage stats from Vercel. Slow, since it lists every sandbox and snapshot. |
| `/users` | All users with their space counts, last activity, Hack Club status and club role |
| `/spaces` | All spaces with their name, owner, dates and sandbox name |
| `/users/:userId/update` | Change `max_spaces` (0–100) or `max_running` (spaces running at once, 0–10). Admins can only change regular users. |
| `/users/:userId/roles` | Superadmins only: set `is_admin` / `is_superadmin`. Superadmins are always admins too, and nobody can change their own roles. |
| `/users/:userId/beta` | Superadmins only: give or remove beta access. Body: `{ "beta_access": true }` |
| `/users/:userId/sign-out` | End all of a user's logins |
| `/users/:userId/stop-spaces` | Stop all of a user's running spaces |
| `/users/:userId/delete` | Delete a user and their spaces. Superadmins can't be deleted until their role is removed. |
| `/spaces/:spaceId/delete` | Delete a space |
| `/logs` | Superadmins only: the audit log of every admin action, newest first. Body: `{ "action", "search", "before", "limit" }` |

### Moderation API (`/api/v1/admin/moderation`)

Superadmins only. Every route is a POST and is written to the audit log. Owners are not told when their space is inspected or opened.

| Path | Description |
|---|---|
| `/spaces/:spaceId/lock` | Stop the space, change its password and block the owner from starting, deleting or changing it. Body: `{ "reason" }` (required, shown to the owner) |
| `/spaces/:spaceId/unlock` | Give the space back to its owner. Body: `{ "reason" }` (optional, for the log) |
| `/spaces/:spaceId/files` | List a folder in the space, as root. Body: `{ "path" }` (absolute, default `/vercel/sandbox`). A stopped space wakes up for this. |
| `/spaces/:spaceId/file` | Read a file. Body: `{ "path", "download" }`. Without `download`, returns text files up to 1 MB as JSON; with `"download": true`, sends the file itself, up to 4 MB (Vercel's response limit). |
| `/spaces/:spaceId/full-access` | Get the space's login to open it as its owner. Body: `{ "reason" }` (required). Joins the running session if the owner is using it; otherwise starts only the space's app, without marking the space as running. |
| `/spaces/:spaceId/release` | Stop a space that was woken up for moderation, unless its owner is using it |

### Playground API (`/api/v1/playground`)

| Method | Path | Description |
|---|---|---|
| POST | `/visit` | Record that the logged-in user opened the Playground (`{ "tool": null }`) or launched a tool (`"godot"` or `"love2d"`). Counted in the admin stats. |

### Other

| Method | Path | Description |
|---|---|---|
| GET | `/api/v1/up` | Health check |
| GET | `/api/v1/cron/auto-stop` | Auto-stop job. Needs `Authorization: Bearer <CRON_SECRET>`. |

### Errors

Errors come back as JSON, with `error` or `message` describing the problem. Unexpected failures return a generic message, and the details go to the server logs.

Common HTTP status codes:
- `400`: Bad Request (missing or invalid parameters)
- `401`: Unauthorized (missing or invalid login)
- `403`: Forbidden (not allowed, for example not verified)
- `404`: Not Found
- `409`: Conflict (email or username already taken)
- `429`: Too Many Requests (rate limited)
- `500`: Internal Server Error
- `503`: Space creation is paused

<div align="center">
  <a href="https://moonshot.hackclub.com" target="_blank">
    <img src="https://hc-cdn.hel1.your-objectstorage.com/s/v3/35ad2be8c916670f3e1ac63c1df04d76a4b337d1_moonshot.png" 
         alt="This project is part of Moonshot, a 4-day hackathon in Florida visiting Kennedy Space Center and Universal Studios!" 
         style="width: 100%;">
  </a>
</div>
