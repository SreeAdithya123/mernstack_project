// One-time seed for the Supabase-backed SmartSupport: 12 KB articles and 8
// resolved tickets (with their 2-message threads), each embedded via Gemini's
// text-embedding-004 (768 dims, matching the kb_articles/ticket_embeddings
// vector(768) columns). Ported verbatim from the old
// server/scripts/seedKB.js / seedClosedTickets.js content.
//
// Seeded tickets need a real profiles.id (FK), so this first signs up one
// synthetic "seed data" account via the normal Auth signup endpoint (no
// service_role key needed) and attributes all 8 historical tickets to it.
//
// Prints ready-to-run SQL (INSERT statements) to stdout — this script does
// NOT touch the database itself; the SQL it prints is applied separately via
// the Supabase MCP's execute_sql/apply_migration.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const envPath = new URL('../server/.env', import.meta.url);
const env = Object.fromEntries(
  readFileSync(envPath, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i), l.slice(i + 1)];
    })
);

const SEED_USER_ID = process.argv[2];
const GEMINI_API_KEY = env.GEMINI_API_KEY;

if (!SEED_USER_ID || !GEMINI_API_KEY) {
  console.error('Usage: node seed-supabase.mjs <SEED_PROFILE_UUID>');
  process.exit(1);
}

async function embed(text) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'models/gemini-embedding-001',
        content: { parts: [{ text }] },
        outputDimensionality: 768,
      }),
    }
  );
  if (!res.ok) throw new Error(`embed failed: ${res.status} ${await res.text()}`);
  const body = await res.json();
  const values = body.embedding.values;
  if (values.length !== 768) throw new Error(`expected 768 dims, got ${values.length}`);
  return values;
}

function vecLiteral(values) {
  // 6 decimals is well beyond pgvector's float4 storage precision (~7 sig
  // figs) - full float64 precision just bloats the SQL text for no benefit.
  return `'[${values.map((v) => v.toFixed(6)).join(',')}]'::vector(768)`;
}

function sqlStr(s) {
  return `'${s.replace(/'/g, "''")}'`;
}

const KB_ARTICLES = [
  {
    title: 'How to reset your password',
    category: 'Account',
    body: `If you can't remember your password, go to the sign-in page and click "Forgot password?". Enter the email address on your account and we'll send a reset link within a couple of minutes.\n\nThe reset link expires after 30 minutes and can only be used once. If it has expired, just request a new one. If the email doesn't arrive, check your spam or junk folder, and confirm you entered the same address you signed up with — reset emails are only sent to registered addresses, and we don't reveal whether an address exists.\n\nAfter clicking the link, choose a new password of at least 10 characters. You'll be signed out of all other devices when the change is saved. If you reset your password but still can't sign in, clear your browser cookies for our site and try again, or contact support and we'll verify your account manually.`,
  },
  {
    title: 'Troubleshooting login and account access issues',
    category: 'Account',
    body: `If your password is definitely correct but you still can't get in, work through these checks:\n\n1. Make sure you're signing in with the right method. Accounts created with "Sign in with Google" don't have a separate password — use the Google button instead of the email form.\n2. After 5 failed sign-in attempts your account locks for 15 minutes as a security measure. Wait out the cooldown before trying again; more attempts extend the lock.\n3. Two-factor authentication problems: if your phone is lost or the authenticator app was deleted, use one of the backup codes you saved at setup. If you have no backup codes, contact support from your registered email and ask for a 2FA reset — expect an identity check that can take up to one business day.\n4. Clear cookies for our domain or try a private/incognito window; a stale session cookie can cause an endless redirect loop back to the sign-in page.\n\nIf none of this works, tell support the exact error message you see and the time you tried — it helps us find the attempt in our logs.`,
  },
  {
    title: 'Fixing payment failures and declined cards',
    category: 'Billing',
    body: `The most common reasons a payment fails at checkout or on renewal:\n\n- Insufficient funds or an expired card — check the card's expiry date and balance first.\n- The bank declined the charge. Banks often block online or foreign transactions by default; a quick call to your bank to approve the merchant usually fixes repeated declines.\n- 3-D Secure verification wasn't completed. If a bank popup appeared and was closed early, the charge is abandoned — retry and complete the verification step.\n- Card details don't match your bank's records (billing address or postcode). Update them under Settings → Billing → Payment method.\n\nAfter a failed subscription renewal we automatically retry the charge on day 1, day 3, and day 5, and email you before each attempt. Your plan stays active during a 7-day grace period. If every retry fails, the account drops to the free tier — nothing is deleted, and paying again restores the plan immediately. You can also switch to PayPal or a different card at any time under Settings → Billing.`,
  },
  {
    title: 'Understanding double charges and duplicate payments',
    category: 'Billing',
    body: `Seeing two charges for one purchase is almost always one of these two situations:\n\n1. A pending authorization plus the real charge. When a first payment attempt fails or is interrupted (for example a 3-D Secure step wasn't finished), your bank may still hold the amount as "pending". That hold is not money we received — banks release it automatically within 5–7 business days. Only one line will appear on your final statement.\n\n2. A genuine duplicate charge. If both charges have settled (neither is marked pending), send us the last 4 digits of the card, the amounts, and the dates of both charges. We verify duplicates against our payment processor within 1 business day and refund the extra charge immediately once confirmed. The refund reaches your card in 5–10 business days depending on the bank.\n\nTo prevent duplicates, avoid clicking "Pay" more than once if the page seems stuck — open your Billing history in a new tab first to see whether the first attempt actually went through.`,
  },
  {
    title: 'Refund policy',
    category: 'Billing',
    body: `Subscriptions: annual plans come with a 30-day money-back guarantee — cancel within 30 days of the first charge for a full refund, no questions asked. Monthly plans can be refunded within 14 days of the charge if you haven't used paid features in that period. Renewal charges outside those windows are generally not refundable, but we pro-rate in cases of documented billing errors on our side.\n\nPhysical orders: items can be returned within 30 days of delivery in original condition for a full refund of the item price; return shipping is free for defective items, otherwise deducted from the refund. Refunds are issued once the return is scanned by the carrier.\n\nAll refunds go back to the original payment method and typically appear in 5–10 business days; PayPal refunds are usually same-day. We can't redirect a refund to a different card or account. If a refund hasn't arrived after 10 business days, ask your bank about pending credits before contacting us — have the refund confirmation email handy.`,
  },
  {
    title: 'Managing your subscription: upgrade, downgrade, cancel',
    category: 'Billing',
    body: `Upgrades take effect immediately: the price difference for the remainder of the current period is charged right away (pro-rated), and new features unlock as soon as payment succeeds.\n\nDowngrades take effect at the end of the current billing period — you keep the higher tier's features until then, and no partial refund is issued for the unused time. If your data exceeds the lower tier's limits, the app becomes read-only for the overage until you're back under the limit.\n\nCancelling: Settings → Billing → Cancel subscription. Your plan stays active until the end of the paid period, then the account moves to the free tier. We keep your data for 90 days after cancellation; export it any time from Settings → Data export. Deleting the account entirely is a separate action and is irreversible after the 14-day cool-off window.`,
  },
  {
    title: 'Updating billing details and downloading invoices',
    category: 'Billing',
    body: `Payment method, billing address, company name, and tax/VAT ID all live under Settings → Billing. Changes apply to the next invoice — we can't reissue past invoices with new details except for correcting a VAT ID within the same tax quarter.\n\nInvoices are generated for every successful charge and emailed to the billing contact (which can differ from the account owner — set it under Billing → Invoice recipient). You can also download PDF invoices for the past 7 years from Billing → History.\n\nIf you need purchase orders referenced on invoices, add the PO number in the "Invoice notes" field before the renewal date. For bank transfer payment (annual plans over $1,000 only), contact sales and allow 2–3 business days for provisioning after the transfer clears.`,
  },
  {
    title: 'Shipping policy and delivery timeframes',
    category: 'Shipping',
    body: `Orders are processed and dispatched within 1–2 business days (orders placed after 2pm local warehouse time count from the next business day). You'll receive a dispatch confirmation with tracking as soon as the parcel leaves the warehouse.\n\nDelivery estimates after dispatch:\n- Standard domestic: 3–7 business days, free on orders over $75, otherwise $4.95.\n- Express domestic: 1–2 business days, $12.95.\n- International: 7–21 business days depending on destination. Import duties and customs fees are the recipient's responsibility and are not included at checkout.\n\nDuring sale periods processing can take up to 4 business days. If an item in your order is back-ordered we ship the rest immediately and send the remainder separately at no extra cost. Address changes are only possible before dispatch — contact us as soon as possible with the order number.`,
  },
  {
    title: 'Tracking your order',
    category: 'Shipping',
    body: `A tracking link is emailed within 24 hours of dispatch. If you have an account, the same link is under Orders → Order details.\n\nCommon tracking situations:\n- "Label created" for more than 2 business days: the carrier hasn't scanned the parcel yet. This usually resolves at the next depot scan; the parcel is often already moving.\n- No movement for 5+ business days (domestic) or 10+ (international): contact us with your order number and we'll open a trace with the carrier. Traces take 3–5 business days; if the carrier confirms loss we reship or refund immediately.\n- "Delivered" but nothing arrived: check with neighbours and around safe-drop spots first, then report it within 7 days. We investigate GPS scan data with the carrier before resolving.\n\nNote that tracking emails sometimes land in spam, and international tracking can go quiet for several days while a parcel clears customs — that's normal.`,
  },
  {
    title: 'App running slowly or crashing: troubleshooting steps',
    category: 'Technical',
    body: `Before anything else, check status.example.com — if there's an active incident, the banner will say so and no local troubleshooting will help.\n\nIf the platform status is green:\n1. Hard-refresh the page (Ctrl+Shift+R / Cmd+Shift+R) to bypass cached assets.\n2. Clear the site's cached data: browser settings → site data → remove for our domain, then sign in again.\n3. Disable browser extensions, especially ad blockers and privacy tools — they commonly block the websocket connection the dashboard needs, which shows up as spinners that never finish or live data that never updates.\n4. Try a supported browser: the latest two versions of Chrome, Firefox, Edge, or Safari. Internet Explorer and very old WebViews are not supported.\n5. On mobile, update the app; versions older than 12 months lose API compatibility.\n\nIf the problem persists, send support: the exact time it happened, your browser and version, what you clicked, and any red errors from the browser console (F12 → Console). A screenshot of the Network tab for the failing action speeds diagnosis up considerably.`,
  },
  {
    title: 'Screen display problems: blank, black, or garbled screen',
    category: 'Technical',
    body: `A black or blank screen after sign-in is nearly always a rendering issue on the device rather than an outage. Work through:\n\n1. Test in a private/incognito window. If it renders there, clear the site's cached data in your normal window.\n2. Toggle hardware acceleration: in Chrome, Settings → System → "Use graphics acceleration when available", flip it, restart the browser. Faulty GPU drivers are the top cause of black canvases and garbled charts.\n3. Update your graphics driver / OS. On Windows laptops with dual GPUs, forcing the browser onto the integrated GPU often fixes it.\n4. Check the browser zoom is 100% (Ctrl+0) — extreme zoom can blank complex dashboard layouts.\n5. Safari 16 and older has a known compositing bug with our charts; update Safari or use Chrome/Firefox until you can.\n\nIf the screen is blank only for one specific page and every other page works, tell support which page plus your browser version and OS — include a screenshot of the browser console (F12) so we can see the rendering errors.`,
  },
  {
    title: 'How we handle feature requests',
    category: 'General',
    body: `We genuinely read every feature request. Here's what happens to yours:\n\n1. Submit it as a ticket (or through Settings → Send feedback). Describe the problem you're trying to solve, not just the feature — "I need to export monthly cost per project for finance" is far more useful than "add export button".\n2. The product team triages new requests monthly. Requests are grouped with similar ones and weighted by how many customers they affect, so a "duplicate" is a good thing — it adds a vote to the existing idea.\n3. Accepted ideas appear on the public roadmap at roadmap.example.com with statuses Planned, In progress, and Shipped. You can vote and subscribe for updates there.\n\nWe deliberately don't promise dates or ETAs — priorities shift, and we'd rather not break promises. If a request is something we decide not to build, we say so on the roadmap rather than leaving it in limbo. Workarounds for common gaps are documented in the knowledge base in the meantime.`,
  },
];

const CLOSED_TICKETS = [
  {
    submitterName: 'Marta Kowalska',
    subject: 'Locked out — lost phone with authenticator app',
    sentiment: 'negative',
    priority: 'high',
    category: 'technical',
    userMessage:
      "My phone was stolen over the weekend and my authenticator app is gone. I can't get past the 2FA prompt and I never saved the backup codes. How do I get back into my account?",
    agentReply:
      'I can help with that. Since there are no backup codes, we need to verify your identity manually: please reply from your registered email with your account creation month and the last invoice amount. Once verified, we will reset 2FA within one business day.',
    resolutionSummary:
      'Customer lost 2FA device with no backup codes. Verified identity via registered email (account creation date + last invoice amount), then reset 2FA server-side. Advised customer to re-enrol an authenticator and store fresh backup codes.',
  },
  {
    submitterName: 'Jules Baptiste',
    subject: 'Dashboard is a black screen after logging in',
    sentiment: 'negative',
    priority: 'medium',
    category: 'technical',
    userMessage:
      'Since yesterday my dashboard loads as a completely black screen right after login. The login page itself looks fine. I am on Chrome on a Windows laptop.',
    agentReply:
      'That is almost always a GPU rendering issue rather than an outage. Please toggle hardware acceleration in Chrome (Settings → System), restart the browser, and if it persists try an incognito window to rule out cached assets.',
    resolutionSummary:
      'Black dashboard after login on Chrome/Windows. Root cause: faulty GPU acceleration. Fixed by disabling "Use graphics acceleration when available" in Chrome and restarting the browser; also recommended updating the graphics driver.',
  },
  {
    submitterName: 'Ana Duarte',
    subject: 'Order stuck on "label created" for a week',
    sentiment: 'negative',
    priority: 'medium',
    category: 'other',
    userMessage:
      'I ordered on the 3rd and the tracking has said "label created" ever since. It has been 7 days with no movement. Where is my parcel?',
    agentReply:
      'Sorry about the wait. "Label created" for this long means the carrier missed the first scan. I have opened a trace with the carrier; traces take 3–5 business days, and if the parcel is confirmed lost we reship immediately at no cost.',
    resolutionSummary:
      'Tracking frozen at "label created" for 7 days. Opened carrier trace; carrier located the parcel at the origin depot and it resumed movement. Delivered 4 days later. Advised customer traces take 3–5 business days and lost parcels are reshipped free.',
  },
  {
    submitterName: 'Viktor Hansen',
    subject: 'Billed twice this month for the same subscription',
    sentiment: 'angry',
    priority: 'high',
    category: 'billing',
    userMessage:
      'Check your records — there are TWO identical charges from you on my Mastercard this month. I want one refunded right now.',
    agentReply:
      'Understood, and sorry for the alarm. Both charges show as settled on our side too, so this is a genuine duplicate. I have refunded the second charge; it should appear on your statement within 5–10 business days.',
    resolutionSummary:
      'Two settled identical subscription charges in one month — confirmed duplicate against processor records. Refunded the duplicate charge to the original card (5–10 business days). Root cause was a double-submitted payment form.',
  },
  {
    submitterName: 'Chen Wei',
    subject: 'Need VAT number added to invoices',
    sentiment: 'neutral',
    priority: 'low',
    category: 'billing',
    userMessage:
      'Our finance team rejected your invoice because it is missing our VAT ID. Can you add it and reissue the last invoice?',
    agentReply:
      'You can add the VAT ID under Settings → Billing; it applies to future invoices automatically. Since your last invoice is from this tax quarter, I have reissued it with the VAT ID included — the corrected PDF is in Billing → History.',
    resolutionSummary:
      'Invoice missing customer VAT ID. Customer added VAT ID under Settings → Billing; we reissued the current-quarter invoice with the corrected details. Noted that past-quarter invoices cannot be reissued.',
  },
  {
    submitterName: 'Sofia Marino',
    subject: 'Want to cancel annual plan bought last week',
    sentiment: 'neutral',
    priority: 'medium',
    category: 'billing',
    userMessage:
      'I upgraded to the annual plan 6 days ago but my circumstances changed. Can I cancel and get my money back?',
    agentReply:
      'Yes — annual plans have a 30-day money-back guarantee, and you are well within it. I have cancelled the subscription and issued a full refund to your original payment method; expect it in 5–10 business days.',
    resolutionSummary:
      'Cancellation of an annual plan 6 days after purchase. Covered by the 30-day money-back guarantee: subscription cancelled, full refund issued to original payment method. Account moved to free tier at cancellation.',
  },
  {
    submitterName: 'Ravi Shankar',
    subject: 'App painfully slow, spinners never finish',
    sentiment: 'negative',
    priority: 'medium',
    category: 'technical',
    userMessage:
      'For the past few days every page takes ages and half the widgets just show endless loading spinners. My internet is fine — other sites are fast.',
    agentReply:
      'Endless spinners with an otherwise fast connection usually means a browser extension is blocking our websocket connection. Could you try disabling ad-block/privacy extensions for our domain, or test in an incognito window with extensions off?',
    resolutionSummary:
      'Endless loading spinners caused by an ad-block extension blocking the dashboard websocket. Fixed by allowlisting the app domain in the extension. Advised checking status page first for future slowness.',
  },
  {
    submitterName: 'Leila Haddad',
    subject: 'Password reset email never arrives',
    sentiment: 'negative',
    priority: 'medium',
    category: 'technical',
    userMessage:
      'I have requested a password reset four times today and no email ever shows up. Not in spam either. I am locked out of my account.',
    agentReply:
      'Thanks for checking spam already. The most common cause is requesting the reset for a different address than the registered one — many people have two similar addresses. I checked our logs: the requests were sent to an address that is not on any account. Please try your other email address.',
    resolutionSummary:
      'Reset emails "not arriving" because requests used an unregistered email address (typo variant of the real one). Customer retried with the registered address and reset succeeded. No mail delivery fault on our side.',
  },
];

async function run() {
  const seedUserId = SEED_USER_ID;
  console.error(`Using seed profile id: ${seedUserId}`);

  const outDir = new URL('../scratchpad/seed-sql/', import.meta.url);
  mkdirSync(outDir, { recursive: true });

  console.error('Embedding KB articles...');
  for (let i = 0; i < KB_ARTICLES.length; i++) {
    const a = KB_ARTICLES[i];
    const values = await embed(`${a.title}\n\n${a.body}`);
    const stmt = `insert into public.kb_articles (title, content, category, embedding) values\n(${sqlStr(a.title)}, ${sqlStr(a.body)}, ${sqlStr(a.category)}, ${vecLiteral(values)});\n`;
    writeFileSync(new URL(`kb-${String(i + 1).padStart(2, '0')}.sql`, outDir), stmt);
    console.error(`  embedded + wrote: ${a.title}`);
  }

  console.error('Embedding closed tickets...');
  const now = Date.now();
  for (let i = 0; i < CLOSED_TICKETS.length; i++) {
    const t = CLOSED_TICKETS[i];
    const queryText = `${t.subject}\n\n${t.userMessage}`;
    const values = await embed(`${queryText}\n\nResolution: ${t.resolutionSummary}`);
    const createdAt = new Date(now - (20 - i) * 864e5).toISOString();
    const replyAt = new Date(now - (20 - i) * 864e5 + 36e5).toISOString();
    const stmt = `do $seed$
declare
  v_ticket_id uuid;
begin
  insert into public.tickets (customer_id, subject, status, priority, sentiment, category, resolution_summary, created_at, updated_at)
  values ('${seedUserId}', ${sqlStr(t.subject)}, 'resolved', '${t.priority}', '${t.sentiment}', '${t.category}', ${sqlStr(t.resolutionSummary)}, '${createdAt}', '${createdAt}')
  returning id into v_ticket_id;

  insert into public.ticket_messages (ticket_id, sender_id, sender_role, body, created_at)
  values (v_ticket_id, '${seedUserId}', 'user', ${sqlStr(t.userMessage)}, '${createdAt}');

  insert into public.ticket_messages (ticket_id, sender_id, sender_role, body, created_at)
  values (v_ticket_id, null, 'salesperson', ${sqlStr(t.agentReply)}, '${replyAt}');

  insert into public.ticket_embeddings (ticket_id, embedding)
  values (v_ticket_id, ${vecLiteral(values)});
end $seed$;
`;
    writeFileSync(new URL(`ticket-${String(i + 1).padStart(2, '0')}.sql`, outDir), stmt);
    console.error(`  embedded + wrote: ${t.subject}`);
  }

  console.error(`Done. SQL files written under ${outDir.pathname}`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
