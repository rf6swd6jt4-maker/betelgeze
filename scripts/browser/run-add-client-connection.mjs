// Production components with synthetic API/provider boundaries; no live accounts.
import { spawn } from 'node:child_process'
import assert from 'node:assert/strict'
import { chromium, webkit } from 'playwright'
const selected = process.argv.slice(2)
assert.ok(selected.every(name => ['chromium', 'webkit'].includes(name)))
const server = spawn(process.execPath, ['scripts/serve-client-connections-fixture.mjs'], { stdio: ['ignore', 'pipe', 'inherit'] })
const firstId = '00000000-0000-4000-8000-000000000011', secondId = '00000000-0000-4000-8000-000000000012'
const account = { relationshipId: firstId, clientName: 'Current Client', businessName: 'Current Business', archived: false, connected: false, accountType: 'client_account', revision: null, locationId: null, locationName: null, refreshedAt: null, readyAt: null, error: null, busy: false }
const second = { ...account, relationshipId: secondId, clientName: 'Paged Client', businessName: 'Paged Business' }
try {
 const url = await new Promise((resolve, reject) => { let log = ''; server.stdout.on('data', chunk => { log += chunk; const match = log.match(/http:\/\/127\.0\.0\.1:\d+\//); if (match) resolve(match[0]) }); server.once('exit', code => reject(Error(`Fixture exited ${code}`))) })
 for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]].filter(([name]) => !selected.length || selected.includes(name))) {
  const browser = await engine.launch()
  try { for (const width of [1280, 390]) {
   const page = await browser.newPage({ viewport: { width, height: 900 } }), errors = [], requests = [], mutations = []
   page.on('pageerror', error => errors.push(error.message))
   await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.fallback() : route.abort())
   let mode = 'ok', releaseHeld, heldStarted, saved = null, metaReads = 0, verificationFailed = false, googleMetadataFailed = false, chooseExistingGhl = false, calendarRevision = null
   const held = new Promise(resolve => { releaseHeld = resolve })
   const started = new Promise(resolve => { heldStarted = resolve })
   await page.route('**/client-connections/relationships?*', async route => {
    const query = new URL(route.request().url()).searchParams; requests.push(Object.fromEntries(query))
    if (mode === 'hold') { mode = 'ok'; heldStarted(); await held; return route.fulfill({ json: { accounts: [{ ...account, clientName: 'Stale Client' }], nextCursor: null } }).catch(() => {}) }
    if (mode === 'fail') return route.fulfill({ status: 503, json: { error: 'Synthetic relationship outage' } })
    if (mode === 'denied') return route.fulfill({ status: 403, json: { error: 'Client connection access changed.' } })
    if (chooseExistingGhl && query.get('provider') === 'ghl') return route.fulfill({ json: { accounts: [{ ...account, relationshipId: 'relationship', clientName: 'Synthetic Client', businessName: 'Fixture Business', connected: true, locationId: 'location123456789', locationName: 'Latest Fixture Location', revision: '00000000-0000-4000-8000-000000000002', calendarId: 'calendar123456789', calendarName: 'Visits' }], nextCursor: null } })
    if (query.has('relationship')) { assert.equal(query.get('relationship'), firstId); return route.fulfill({ json: { accounts: [account], nextCursor: null } }) }
    return route.fulfill({ json: query.has('after') ? { accounts: [second], nextCursor: null } : query.has('query') ? { accounts: [second], nextCursor: null } : { accounts: [account, { ...account, relationshipId: 'archived-choice', clientName: 'Archived Choice', archived: true }, { ...account, relationshipId: 'retired-choice', clientName: 'Retired Choice', historyId: 'old-revision' }], nextCursor: firstId } })
   })
   await page.route('**/client-connections/google-ads*', async route => {
    if (route.request().method() === 'GET') {
     requests.push({ googleRelationship: new URL(route.request().url()).searchParams.get('relationship') })
     if (googleMetadataFailed) { googleMetadataFailed = false; return route.fulfill({ status: 503, json: { error: 'Synthetic saved-status outage' } }) }
     return route.fulfill({ json: { connection: saved, managerId: '9876543210', managerName: 'Synthetic Agency', satisfied: saved?.status === 'connected' } })
    }
    const body = route.request().postDataJSON(); mutations.push(body)
    assert.equal(body.relationshipId, secondId); assert.equal(body.customerId.replaceAll('-', ''), '1234567890')
    if (body.action === 'request') assert.equal(body.consented, true)
    if (verificationFailed) { verificationFailed = false; saved = { ...saved, status: 'needs_attention', verifiedAt: null }; return route.fulfill({ status: 400, json: { error: 'Synthetic Google access failure' } }) }
    saved = { customerId: '1234567890', managerId: '9876543210', managerName: 'Synthetic Agency', accountName: 'Synthetic Ads account', status: body.action === 'request' ? 'pending' : 'connected', verifiedAt: body.action === 'verify' ? '2026-10-27T12:00:00Z' : null }
    return route.fulfill({ json: { connection: saved } })
   })
   await page.route('**/client-connections/meta-ads?*', route => { metaReads++; assert.equal(new URL(route.request().url()).searchParams.get('relationship'), firstId); return route.fulfill({ json: { connection: null, candidateId: null, history: [] } }) })
   await page.route('**/client-connections/oauth*', route => {
    assert.equal(route.request().method(), 'GET', 'Selecting a provider or relationship must not start authorization')
    const query = new URL(route.request().url()).searchParams
    if (query.get('action') === 'notification_status') { assert.equal(query.get('expectedRevision'), '00000000-0000-4000-8000-000000000002'); return route.fulfill({ json: { ready: true, sendingEnabled: false, consentReady: true, reminderMinutes: 60 } }) }
    return route.fulfill({ json: { relationshipId: firstId, phase: 'selected', locations: [], locationId: 'location123456789', calendars: [{ id: 'calendar123456789', name: 'Visits' }] } })
   })
   await page.route('**/client-connections/calendars', route => { calendarRevision = route.request().postDataJSON().expectedRevision; return route.fulfill({ json: { calendars: [{ id: 'calendar123456789', name: 'Visits' }] } }) })
   const open = async provider => { await page.getByRole('button', { name: 'Add connection', exact: true }).click(); await page.getByRole('group', { name: 'Connection providers' }).getByRole('button', { name: new RegExp(`^${provider} `) }).click() }
   const choose = async label => { await page.getByRole('button', { name: 'Active relationship', exact: true }).click(); await page.getByRole('option', { name: label, exact: true }).click(); await page.getByRole('button', { name: 'Continue', exact: true }).click() }
   const close = async () => { await page.getByRole('button', { name: 'Close popup', exact: true }).click(); await page.getByRole('dialog').waitFor({ state: 'hidden' }) }
   await page.goto(url)
   await page.getByRole('button', { name: 'Add connection', exact: true }).waitFor()
   assert.equal(requests.length, 0); assert.equal(metaReads, 0); assert.deepEqual(mutations, [])
   assert.equal(await page.getByText(/Archived Client|Unconfigured Client|Retired Client/).count(), 0)
   await page.getByRole('button', { name: 'Add connection', exact: true }).click()
   await page.getByRole('group', { name: 'Connection providers' }).waitFor()
   const thumbnails = await page.getByRole('group', { name: 'Connection providers' }).locator('img').evaluateAll(images => Promise.all(images.map(image => image.decode().then(() => image.naturalWidth > 0))))
   assert.deepEqual(thumbnails, [true, true]); assert.equal(await page.getByRole('group', { name: 'Connection providers' }).locator('svg').count(), 1)
   assert.equal(requests.length, 0, 'Provider cards are local and do not preload relationship records')
   await page.getByRole('dialog').locator('section').evaluate(node => Promise.all(node.getAnimations().map(animation => animation.finished.catch(() => {}))))
   await page.screenshot({ path: `/tmp/add-connection-cards-${name}-${width}.png` })
   mode = 'hold'; await page.getByRole('button', { name: /^GHL / }).click(); await started
   await page.getByRole('status').filter({ hasText: 'Loading relationships…' }).waitFor()
   await page.getByRole('button', { name: 'Back to providers', exact: true }).click()
   mode = 'fail'; await page.getByRole('button', { name: /^Google Ads / }).click()
   await page.getByRole('alert').filter({ hasText: 'Synthetic relationship outage' }).waitFor()
   releaseHeld(); mode = 'ok'; await page.getByRole('button', { name: 'Retry relationships', exact: true }).click()
   await page.getByRole('button', { name: 'Load more relationships', exact: true }).waitFor()
   await page.getByRole('button', { name: 'Active relationship', exact: true }).click()
   assert.equal(await page.getByRole('option').count(), 1); assert.equal(await page.getByRole('option', { name: /Stale|Archived|Retired/ }).count(), 0)
   await page.getByRole('option', { name: 'Current Client – Current Business', exact: true }).click()
   const beforeType = requests.length
   await page.getByRole('textbox', { name: 'Find relationship' }).fill('Paged')
   assert.equal(requests.length, beforeType, 'Typing is local until explicit Search')
   await page.getByRole('button', { name: 'Search', exact: true }).click()
   await page.getByRole('button', { name: 'Active relationship', exact: true }).click()
   await page.getByRole('option', { name: 'Paged Client – Paged Business', exact: true }).waitFor()
   await page.keyboard.press('Escape')
   await page.getByRole('textbox', { name: 'Find relationship' }).fill('')
   await page.getByRole('button', { name: 'Search', exact: true }).click()
   await page.getByRole('button', { name: 'Load more relationships', exact: true }).click()
   await choose('Paged Client – Paged Business')
   const google = page.getByRole('dialog', { name: 'Google Ads connection', exact: true })
   await google.getByRole('textbox', { name: 'Customer ID' }).waitFor()
   assert.equal(mutations.length, 0)
   assert.ok(requests.some(request => request.googleRelationship === secondId))
   await google.getByRole('textbox', { name: 'Customer ID' }).fill('123-456-7890')
   await google.getByRole('button', { name: 'Send invitation', exact: true }).click()
   await google.getByText('Invitation pending', { exact: true }).waitFor()
   assert.equal(mutations.length, 1)
   await google.getByRole('button', { name: 'Check connection', exact: true }).click()
   await google.getByText('Connected', { exact: true }).waitFor()
   assert.deepEqual(mutations.map(value => value.action), ['request', 'verify'])
   const metadataReadsBeforeFailure = requests.filter(request => request.googleRelationship).length
   verificationFailed = true
   await google.getByRole('button', { name: 'Check connection', exact: true }).click()
   await google.getByText('Needs attention', { exact: true }).waitFor()
   await google.getByRole('alert').filter({ hasText: 'Synthetic Google access failure' }).waitFor()
   assert.equal(await google.getByText('Connected', { exact: true }).count(), 0, 'Failed verification must not retain stale green status')
   assert.equal(await google.getByRole('textbox', { name: 'Customer ID' }).inputValue(), '123-456-7890')
   assert.equal(await google.getByRole('textbox', { name: 'Customer ID' }).evaluate(input => input.readOnly), true, 'Reconciliation locks the saved customer ID')
   assert.equal(requests.filter(request => request.googleRelationship).length, metadataReadsBeforeFailure + 1, 'A failed provider write reconciles the selected account once')
   await google.getByRole('button', { name: 'Check connection', exact: true }).click()
   await google.getByText('Connected', { exact: true }).waitFor()
   verificationFailed = true; googleMetadataFailed = true
   await google.getByRole('button', { name: 'Check connection', exact: true }).click()
   await google.getByRole('alert').filter({ hasText: 'Synthetic saved-status outage' }).waitFor()
   assert.equal(await google.getByText('Connected', { exact: true }).count(), 0, 'Unknown verification outcome cannot show the previously connected status')
   assert.equal(await google.getByRole('button', { name: 'Check connection', exact: true }).count(), 0, 'Further writes wait for saved-state reconciliation')
   await google.getByRole('button', { name: 'Reload saved status', exact: true }).click()
   await google.getByText('Needs attention', { exact: true }).waitFor()
   await close()
   await open('Meta Ads'); await choose('Current Client – Current Business')
   await page.getByRole('dialog', { name: 'Meta Ads reporting', exact: true }).getByText('No reporting account has been selected.', { exact: true }).waitFor()
   assert.equal(metaReads, 1); await close()
   await open('GHL'); await choose('Current Client – Current Business')
   await page.getByRole('dialog', { name: 'Connect HighLevel', exact: true }).getByText('Current Client – Current Business', { exact: true }).waitFor()
   await page.getByRole('button', { name: 'Manual connection', exact: true }).click()
   await page.getByRole('dialog', { name: 'Manual connection', exact: true }).waitFor()
   assert.equal(await page.locator('input[name="relationshipId"]').inputValue(), firstId)
   await close()
   chooseExistingGhl = true
   await open('GHL')
   await page.getByRole('button', { name: 'Active relationship', exact: true }).click()
   await page.getByRole('option', { name: 'Synthetic Client – Fixture Business GHL already connected', exact: true }).click()
   await page.getByRole('button', { name: 'Manage connection', exact: true }).click()
   await page.getByRole('button', { name: 'Manual connection and retirement', exact: true }).click()
   await page.getByRole('button', { name: 'Load calendars', exact: true }).click()
   await page.getByRole('button', { name: 'Client portal calendar', exact: true }).waitFor()
   assert.equal(calendarRevision, '00000000-0000-4000-8000-000000000002', 'Fresh chooser metadata must override the older mounted GHL row')
   await close(); chooseExistingGhl = false
   await open('Google Ads')
   await page.getByRole('button', { name: 'Active relationship', exact: true }).click(); await page.getByRole('option', { name: 'Current Client – Current Business', exact: true }).click()
   mode = 'denied'; await page.getByRole('button', { name: 'Load more relationships', exact: true }).click()
   await page.getByRole('alert').filter({ hasText: 'Client connection access changed.' }).waitFor()
   assert.equal(await page.getByRole('button', { name: 'Continue', exact: true }).isDisabled(), true)
   await page.getByRole('button', { name: 'Active relationship', exact: true }).click(); assert.equal(await page.getByRole('option').count(), 0)
   await page.keyboard.press('Escape'); await close(); mode = 'ok'
   await page.goto(url + '?ghl=selected')
   await page.getByRole('button', { name: 'HighLevel calendars', exact: true }).waitFor()
   assert.ok(requests.some(request => request.provider === 'ghl' && request.relationship === firstId), 'Callback recovery hydrates only the missing relationship')
   assert.equal(await page.getByRole('dialog').getByText('Current Client – Current Business', { exact: true }).count(), 1)
   assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
   assert.deepEqual(errors, [])
   console.log(`${name} ${width}: provider logos, lazy current choices, paging/search, failure/retry, stale response, explicit Google invite/check and failure reconciliation, fresh GHL revision, Meta/GHL setup, access loss and callback recovery passed`)
   await page.close()
  }} finally { await browser.close() }
 }
} finally { server.kill('SIGTERM') }
