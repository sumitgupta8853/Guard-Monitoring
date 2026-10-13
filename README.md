# Guard Monitor: attendance + geofence backend (Node.js + MongoDB)

## Folder-wise layout

```
src/
  app.js                  # express app factory
  server.js               # bootstrap: connectDB -> seedAdmin -> listen + watchdog
  config/index.js         # env config (MONGO_URI, JWT, rules, UPLOAD_DIR)
  db/connect.js           # mongoose connect/close
  db/seed.js              # creates admin on first run
  models/                 # User, Site, Guard, Attendance, Alert, Location
  controllers/            # auth, admin.sites/guards/reports, guard.profile/attendance/location, files
  routes/                 # auth.routes, admin.routes, guard.routes, files.routes
  middlewares/            # auth, uploadAuth (?token= + socket auth), errorHandler
  services/               # token, notify, monitor, evaluate (geofence)
  utils/                  # date, geo, coords, fileUrl, asyncHandler
  uploads/                # folders constants + multer uploader
  sockets/                # socket.io join logic
  jobs/                   # watchdog interval
scripts/migrate-json-to-mongo.js   # one-shot import from old ./data/db.json
```

## The flow

1. **Admin** logs in, creates a **site** (center point + radius) and **guard profiles** (name, phone, CNIC, address, emergency contact, shift, profile photo, login).
2. **Guard** logs in and sees their own profile and assigned site.
3. **Attendance starts only when the guard sends a live photo and a GPS position inside the radius.** Outside the radius, check-in is refused.
4. While on duty the guard **must upload a live photo every hour inside a STRICT slot window** (`POST /api/guard/attendance/hourly-photo` multipart: `photo` + `lat,lng,accuracy`). Slots are wall-clock top-of-hour strictly after check-in (check-in 10:13 → slot 1 due 11:00). The N:00 photo is accepted ONLY inside [N:00−5min, N:00+5min] (e.g. 10:55–11:05; tunable via `HOURLY_EARLY_MIN`/`HOURLY_LATE_MIN`) — uploads outside the window are rejected `425` with `nextOpenAt`, duplicates `409`. A closed window with no photo is a permanent miss (`MISSING_HOURLY_PHOTO` alert, `missed` counter). Every accepted photo is marked on that day's attendance (`hourlyPhotos[]` + `hourly.activeSlot/activeWindow` status); the guard app must enable the camera button only when `hourly.activeSlot != null` and show `hourly.message`. Checkout stays allowed (never blocked by misses; compliance shows as `uploaded/expected`).
5. While on duty the guard's app records GPS every ~20 s locally and uploads the buffered array every 15 min (`POST /api/guard/location` with `{points: [...]}`). Points replay oldest-first; if any leave the radius:
   - a `LEFT_AREA` alert goes to the admin (Socket.IO, plus optional webhook) when the batch arrives — up to ~15 min after the guard actually left
   - the guard gets a live `warning` and every batch response says "return immediately"
   - the time spent outside is recorded on that day's attendance as a violation
   - `STILL_OUTSIDE` is raised if they stay out for 5 minutes (configurable)
   - `RETURNED` is raised when they come back
5. The guard can only **check out** when back inside the area (admin can force-close).
6. Admin sees the attendance report: photos, late flag, hours worked, time outside, every violation, and the location trail.

## Run (MongoDB)

```bash
npm install
# start local mongo first:
#   mongod --dbpath /data/db
#   or: docker run -d -p 27017:27017 --name mongo mongo:7
cp .env.example .env   # then set JWT_SECRET + ADMIN_PASS
MONGO_URI=mongodb://localhost:27017/guard-monitor \
JWT_SECRET=long-random-string ADMIN_USER=admin ADMIN_PASS=strong-pass \
TZ=Asia/Karachi npm start

npm test        # full end-to-end test (needs MONGO_URI reachable; uses guard-monitor-test)
```

The admin account is created automatically on first start.
Data lives in **MongoDB**; only uploaded photos stay on disk under `UPLOAD_DIR/uploads/{profiles,attendance}`.

Migrating from the old JSON file?
```bash
node scripts/migrate-json-to-mongo.js ./data
```

| Env var | Default | Meaning |
|---|---|---|
| `PORT` | 3000 | |
| `MONGO_URI` | mongodb://localhost:27017/guard-monitor | |
| `JWT_SECRET`, `ADMIN_USER`, `ADMIN_PASS` | dev defaults | **change these** |
| `TZ` | server zone | used for "today" and shift times |
| `UPLOAD_DIR` | `./data` | photos stored under `<UPLOAD_DIR>/uploads` |
| `WEBHOOK_URL` | none | every alert is POSTed here |
| `OUTSIDE_READINGS_TO_ALERT` | 2 | consecutive outside points (inside one batch counts) before a violation |
| `NO_SIGNAL_AFTER_SEC` | 1200 | `NO_SIGNAL` alert if on-duty guard stops uploading batches (15 min + 5 min grace) |
| `LOCATION_BATCH_MAX` | 200 | max GPS points per `POST /location` batch |
| `LOCATION_INTERVAL_SEC` | 900 | expected app upload cadence (informational) |
| `ESCALATE_AFTER_SEC` | 300 | `STILL_OUTSIDE` alert |
| `MAX_ACCURACY_M` | 100 | pings with worse GPS accuracy are ignored |
| `LATE_GRACE_MIN` | 10 | minutes after shift start before "late" |
| `HOURLY_EARLY_MIN` | 5 | mins before top-of-hour the slot window opens (11:00 photo from 10:55) |
| `HOURLY_LATE_MIN` | 5 | mins after top-of-hour the window closes (11:00 photo until 11:05; uploads outside rejected) |
| `CORS_ORIGIN` | * | set to your admin web app's URL |
| `PUSH_ENABLED` | true | set false to disable FCM push (Socket.IO still works) |
| `FCM_PROJECT_ID`, `FCM_CLIENT_EMAIL`, `FCM_PRIVATE_KEY` | none | from Firebase Console -> Project Settings -> Service Accounts; if empty, push is disabled but API still works |

## API

All routes except login need `Authorization: Bearer <token>`.

### Auth
- `POST /api/auth/login` `{username, password}` -> `{token, role}` (same endpoint for admin and guards)

### Push notifications (FCM) (`/api/push` + `/api/admin/push`)
- `POST /api/push/token` `{token, platform: "android"|"ios"|"web", deviceId?, appVersion?}` — register/refresh this device (guard AND admin, role from JWT). Re-POST on FCM token refresh.
- `DELETE /api/push/token` `{token}` or `{deviceId}` — remove on logout.
- `GET /api/push/status` — `{pushEnabled, devices, platforms}` for current user.
- `POST /api/admin/push/test` `{title?, body?, guardId?}` — test push to self (or one guard).
- `POST /api/admin/push/send` `{title, body, guardIds?}` — announcement to listed guards (or all admins if no guardIds).
- Automatic: every `raiseAlert` also FCM-pushes to all admin devices; `LEFT_AREA` + `MISSING_HOURLY_PHOTO` also push to the guard. Fire-and-forget — push never blocks alerts/sockets.
- Without `FCM_*` keys the API still works and reports `pushEnabled: false`; mobile integration: get FCM token (`@react-native-firebase/messaging` / `expo-notifications`) -> `POST /api/push/token` after login.

### Admin (`/api/admin`)
- Sites: `POST/GET /sites`, `PUT/DELETE /sites/:id`. Body: `{name, lat, lng, radiusMeters, address?}`
- Guards: `POST /guards`, `GET /guards` (with live on-duty status), `GET/PUT/DELETE /guards/:id`
  - create body: `{name, username, password, phone, cnic, address, emergencyContact, siteId, shift: {start:"08:00", end:"20:00"}}`
  - `POST /guards/:id/photo` multipart, field `photo`
  - `DELETE` deactivates (history is kept); `PUT` can set `active`, `password`, `siteId`, ...
- `GET /live`: guards currently on duty (zone, signal, last position)
- `GET /dashboard`: counts (on duty, outside now, signal lost, not checked in, unacknowledged alerts)
- `GET /attendance?guardId=&from=YYYY-MM-DD&to=` and `GET /attendance/:id`, `GET /attendance/:id/trail`
- `POST /attendance/:id/close`: force check-out
- `GET /alerts?guardId=&type=&unacknowledged=1`, `POST /alerts/:id/ack`

### Guard (`/api/guard`)
- `GET /me`: profile, site, today's attendance
- `POST /attendance/check-in`: **multipart**: `photo` (file), `lat`, `lng`, `accuracy`, optional `mocked`
- `POST /attendance/hourly-photo`: **STRICT** hourly proof-of-presence: `photo` + `lat`, `lng`, `accuracy` (same geofence/fake-GPS rules as check-in). Accepted ONLY inside the slot window [due−early, due+late] (425 outside window with `nextOpenAt` + `nextDueAtLocal/nextWindowLabel`, 409 duplicate). Response: `{ok, slotIndex, overdue, hourly:{activeSlot, activeWindow, uploadedActive, currentSlot, nextOpenAt(+Local), nextDueAt(+Local), nextCloseAt(+Local), nextWindowLabel, tz, uploaded, expected, missed, message}, attendance}` — guard app must show `hourly.message` / `*Local` fields (ISO is UTC; never render raw ISO) and enable camera only when `activeSlot != null` (null after upload → show ✅ received state).
- `POST /location` single ping `{lat, lng, accuracy, mocked?}` **or** 15-min batch `{points: [{lat, lng, accuracy?, at?, mocked?}, ...]}` (`locations` also accepted; max 200 pts): returns `{zone, distanceMeters, warning?, processed?, saved?}`
- `POST /attendance/check-out`: multipart: `lat`, `lng`, `accuracy`, optional `photo`
- `GET /attendance`: own history; `POST /change-password`

### Photos
`GET /api/files/<profiles|attendance>/<name>` with a Bearer token (or `?token=` for `<img>` tags). Admin sees all; a guard sees only their own.

### Realtime (Socket.IO)
Connect with `auth: { token }`.
- Admin receives: `alert`, `guard:update`, `attendance:start`, `attendance:end`
- Guard receives: `warning`

Alert types: `LEFT_AREA`, `STILL_OUTSIDE`, `RETURNED`, `NO_SIGNAL`, `NOT_CHECKED_IN`, `FAKE_GPS`, `MISSING_HOURLY_PHOTO`.

## What the backend can and cannot enforce

A server cannot physically stop someone walking away. What it does enforce: no attendance outside the area, no check-out outside the area, instant alerts and warnings, a permanent record of time spent outside, and alerts when the phone goes silent. The mobile app must do its part:

- Take the check-in photo with the **live camera only** (no gallery picker).
- Keep sending location in the **background** (foreground service on Android).
- Send `mocked: true` when the OS reports a mock location (Android `Location.isMock`). The server rejects it and alerts the admin.
- Check-in does not verify that the face matches the profile photo. Admin can compare the two photos; automatic face matching can be added later.

## Before production

Use HTTPS (put it behind nginx or a host with TLS), replace the JSON file with PostgreSQL, and give guards a privacy notice: tracking applies during duty hours only.
# Guard-Monitoring
