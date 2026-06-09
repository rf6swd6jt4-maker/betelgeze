# Agency Onboarding

Private client onboarding portal for an agency. Admins create clients, assign
the services/modules they purchased, and share a tokenized onboarding link.
Clients use that link to complete the onboarding steps required for their
project.

## Current Features

- Password-protected admin area.
- Admin dashboard with active clients, assigned modules, progress, and activity.
- Manual client creation without opening Supabase.
- Client detail page with onboarding link, notes, timeline, progress, and
  danger-zone actions.
- Client editing for name, email, and assigned modules.
- Module-based client onboarding flow.
- Supabase-backed progress tracking.

## Tech Stack

- Next.js App Router
- React
- TypeScript
- Tailwind CSS
- Supabase
- Vercel deployment

## Local Development

Install dependencies:

```bash
npm install
```

Create a local env file:

```bash
cp .env.example .env.local
```

Fill in the Supabase and admin values, then run:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Environment Variables

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET_NAME=
R2_PUBLIC_BASE_URL=
ADMIN_PASSWORD=
ADMIN_SESSION_SECRET=
NEXT_PUBLIC_SITE_URL=
```

`ADMIN_SESSION_SECRET` should be a long random value. `SUPABASE_SERVICE_ROLE_KEY`
must only be used server-side.

## Supabase

The current schema is represented in
`supabase/migrations/20260601000000_initial_schema.sql`.

Tables used by the app:

- `clients`
- `client_modules`
- `client_progress`
- `client_notes`
- `client_activity`
- `client_form_responses`

Uploaded onboarding files are stored in a private Cloudflare R2 bucket. The
browser uploads directly to R2 with short-lived signed upload URLs, so large
videos do not pass through the Next.js server. Admin previews use signed
download URLs.

`R2_PUBLIC_BASE_URL` is optional and only affects admin/onboarding file links.
WhatsApp media sent to ClickUp uses stable app media URLs that stream files from
private R2 storage.

Important constraints:

- `clients.session_token` is unique.
- `client_progress` is unique per `client_id` and `step_key`.
- `client_modules` is unique per `client_id` and `module_key`.
- `client_form_responses` is unique per `client_id` and `step_key`.

## Admin Flow

1. Log in at `/admin/login`.
2. Add a client at `/admin/new`.
3. Assign the modules included in the client's project.
4. Copy the onboarding link from the client detail page.
5. Track progress, notes, and activity from the admin dashboard.

## Client Flow

Clients open `/session/[token]`, where `[token]` is their private session token.
The onboarding flow is generated from the modules assigned to that client.

Form steps save structured answers to `client_form_responses`. Image, video,
and document uploads are stored in Cloudflare R2 and referenced from the saved
response JSON.

## Scripts

```bash
npm run dev
npm run build
npm run start
npm run lint
npm run test
```

## Deployment

The project is designed for Vercel. Configure the same environment variables in
the Vercel project settings for the production deployment.

## Client Messages Bridge

The bridge routes client WhatsApp messages through Meta WhatsApp Cloud API into
ClickUp Chat, then lets a protected webhook send team replies back to WhatsApp.

Required environment variables:

- `CLICKUP_API_TOKEN`
- `CLICKUP_WORKSPACE_ID`
- `CLICKUP_CLIENTS_SPACE_ID`
- `CLICKUP_CLIENT_FOLDER_TEMPLATE_ID`
- `META_WHATSAPP_ACCESS_TOKEN`
- `META_WHATSAPP_PHONE_NUMBER_ID`
- `META_WHATSAPP_BUSINESS_ACCOUNT_ID`
- `META_WHATSAPP_WEBHOOK_VERIFY_TOKEN`
- `CLIENT_MESSAGES_BRIDGE_SECRET`
- `CLICKUP_BRIDGE_USER_NAME`, optional, defaults to `ScaylUp`
- `CLICKUP_BRIDGE_USER_ID`, optional, used to ignore bot-authored Chat messages

Setup:

1. Run the Supabase migrations.
2. Create a ClickUp Space for clients manually, then set
   `CLICKUP_CLIENTS_SPACE_ID` to that Space ID. Create a client Folder
   template with `Onboarding Information` and `Client Work` Lists, then set
   `CLICKUP_CLIENT_FOLDER_TEMPLATE_ID` to that template ID.
3. Add clients with their WhatsApp number as the primary contact. If ClickUp
   credentials are configured, the app creates a client Folder from the
   template inside the Clients Space, creates initial onboarding tasks, creates
   a ClickUp Chat channel for that Folder, and stores the WhatsApp bridge
   mapping.
4. In Meta, point the WhatsApp webhook callback URL to:
   `/api/client-messages/meta/whatsapp`
5. To send a team reply back to the client manually, post JSON to:
   `/api/client-messages/clickup/outbound`
6. To send team ClickUp Chat replies back to WhatsApp, create a ClickUp Chat
   webhook Automation for "Message is posted" and send it to:
   `/api/client-messages/clickup/chat`
7. If ClickUp Chat webhooks are not available on your plan, use an external
   scheduler to call:
   `/api/client-messages/clickup/poll`

For testing, the client admin page still lets you fill in or override the client
WhatsApp number and ClickUp Chat channel ID manually.

Outbound replies require either an `Authorization: Bearer ...` header or an
`x-bridge-secret` header matching `CLIENT_MESSAGES_BRIDGE_SECRET`.

Example outbound body:

```json
{
  "clientId": "CLIENT_UUID",
  "authorName": "Team",
  "body": "Thanks, we have this and will update you shortly."
}
```

Recommended ClickUp Chat Automation webhook body:

```json
{
  "clickupChannelId": "{{channel.id}}",
  "body": "{{message.text}}",
  "authorName": "{{user.name}}",
  "authorId": "{{user.id}}",
  "clickupMessageId": "{{message.id}}"
}
```

The bridge ignores messages posted by the bridge user, messages from
`CLICKUP_BRIDGE_USER_ID`, system-style messages that begin with `Update` or
`ERROR` formatting markers, and recent echoes of inbound client WhatsApp
messages.

Polling endpoint:

```text
GET /api/client-messages/clickup/poll
```

Authorize it with either:

```text
x-bridge-secret: CLIENT_MESSAGES_BRIDGE_SECRET
```

or, only when your scheduler cannot send headers:

```text
/api/client-messages/clickup/poll?secret=CLIENT_MESSAGES_BRIDGE_SECRET
```
