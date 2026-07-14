// Phase 1: seed the knowledge base. Wipes and re-creates KB articles in
// MongoDB, then mirrors their embeddings into the Pinecone `kb-articles`
// namespace with metadata { mongoId, title, category }. Idempotent: safe to
// re-run. Mongo is seeded first so a Pinecone failure (e.g. blocked egress)
// still leaves a usable article collection; just re-run once Pinecone works.
import mongoose from 'mongoose';
import { connectDB } from '../src/db.js';
import KBArticle from '../src/models/KBArticle.js';
import { embedPassages } from '../src/lib/embeddings.js';
import { ensureIndex, getIndex, KB_NAMESPACE } from '../src/lib/pinecone.js';

const ARTICLES = [
  {
    title: 'How to reset your password',
    category: 'Account',
    body: `If you can't remember your password, go to the sign-in page and click "Forgot password?". Enter the email address on your account and we'll send a reset link within a couple of minutes.

The reset link expires after 30 minutes and can only be used once. If it has expired, just request a new one. If the email doesn't arrive, check your spam or junk folder, and confirm you entered the same address you signed up with — reset emails are only sent to registered addresses, and we don't reveal whether an address exists.

After clicking the link, choose a new password of at least 10 characters. You'll be signed out of all other devices when the change is saved. If you reset your password but still can't sign in, clear your browser cookies for our site and try again, or contact support and we'll verify your account manually.`,
  },
  {
    title: 'Troubleshooting login and account access issues',
    category: 'Account',
    body: `If your password is definitely correct but you still can't get in, work through these checks:

1. Make sure you're signing in with the right method. Accounts created with "Sign in with Google" don't have a separate password — use the Google button instead of the email form.
2. After 5 failed sign-in attempts your account locks for 15 minutes as a security measure. Wait out the cooldown before trying again; more attempts extend the lock.
3. Two-factor authentication problems: if your phone is lost or the authenticator app was deleted, use one of the backup codes you saved at setup. If you have no backup codes, contact support from your registered email and ask for a 2FA reset — expect an identity check that can take up to one business day.
4. Clear cookies for our domain or try a private/incognito window; a stale session cookie can cause an endless redirect loop back to the sign-in page.

If none of this works, tell support the exact error message you see and the time you tried — it helps us find the attempt in our logs.`,
  },
  {
    title: 'Fixing payment failures and declined cards',
    category: 'Billing',
    body: `The most common reasons a payment fails at checkout or on renewal:

- Insufficient funds or an expired card — check the card's expiry date and balance first.
- The bank declined the charge. Banks often block online or foreign transactions by default; a quick call to your bank to approve the merchant usually fixes repeated declines.
- 3-D Secure verification wasn't completed. If a bank popup appeared and was closed early, the charge is abandoned — retry and complete the verification step.
- Card details don't match your bank's records (billing address or postcode). Update them under Settings → Billing → Payment method.

After a failed subscription renewal we automatically retry the charge on day 1, day 3, and day 5, and email you before each attempt. Your plan stays active during a 7-day grace period. If every retry fails, the account drops to the free tier — nothing is deleted, and paying again restores the plan immediately. You can also switch to PayPal or a different card at any time under Settings → Billing.`,
  },
  {
    title: 'Understanding double charges and duplicate payments',
    category: 'Billing',
    body: `Seeing two charges for one purchase is almost always one of these two situations:

1. A pending authorization plus the real charge. When a first payment attempt fails or is interrupted (for example a 3-D Secure step wasn't finished), your bank may still hold the amount as "pending". That hold is not money we received — banks release it automatically within 5–7 business days. Only one line will appear on your final statement.

2. A genuine duplicate charge. If both charges have settled (neither is marked pending), send us the last 4 digits of the card, the amounts, and the dates of both charges. We verify duplicates against our payment processor within 1 business day and refund the extra charge immediately once confirmed. The refund reaches your card in 5–10 business days depending on the bank.

To prevent duplicates, avoid clicking "Pay" more than once if the page seems stuck — open your Billing history in a new tab first to see whether the first attempt actually went through.`,
  },
  {
    title: 'Refund policy',
    category: 'Billing',
    body: `Subscriptions: annual plans come with a 30-day money-back guarantee — cancel within 30 days of the first charge for a full refund, no questions asked. Monthly plans can be refunded within 14 days of the charge if you haven't used paid features in that period. Renewal charges outside those windows are generally not refundable, but we pro-rate in cases of documented billing errors on our side.

Physical orders: items can be returned within 30 days of delivery in original condition for a full refund of the item price; return shipping is free for defective items, otherwise deducted from the refund. Refunds are issued once the return is scanned by the carrier.

All refunds go back to the original payment method and typically appear in 5–10 business days; PayPal refunds are usually same-day. We can't redirect a refund to a different card or account. If a refund hasn't arrived after 10 business days, ask your bank about pending credits before contacting us — have the refund confirmation email handy.`,
  },
  {
    title: 'Managing your subscription: upgrade, downgrade, cancel',
    category: 'Billing',
    body: `Upgrades take effect immediately: the price difference for the remainder of the current period is charged right away (pro-rated), and new features unlock as soon as payment succeeds.

Downgrades take effect at the end of the current billing period — you keep the higher tier's features until then, and no partial refund is issued for the unused time. If your data exceeds the lower tier's limits, the app becomes read-only for the overage until you're back under the limit.

Cancelling: Settings → Billing → Cancel subscription. Your plan stays active until the end of the paid period, then the account moves to the free tier. We keep your data for 90 days after cancellation; export it any time from Settings → Data export. Deleting the account entirely is a separate action and is irreversible after the 14-day cool-off window.`,
  },
  {
    title: 'Updating billing details and downloading invoices',
    category: 'Billing',
    body: `Payment method, billing address, company name, and tax/VAT ID all live under Settings → Billing. Changes apply to the next invoice — we can't reissue past invoices with new details except for correcting a VAT ID within the same tax quarter.

Invoices are generated for every successful charge and emailed to the billing contact (which can differ from the account owner — set it under Billing → Invoice recipient). You can also download PDF invoices for the past 7 years from Billing → History.

If you need purchase orders referenced on invoices, add the PO number in the "Invoice notes" field before the renewal date. For bank transfer payment (annual plans over $1,000 only), contact sales and allow 2–3 business days for provisioning after the transfer clears.`,
  },
  {
    title: 'Shipping policy and delivery timeframes',
    category: 'Shipping',
    body: `Orders are processed and dispatched within 1–2 business days (orders placed after 2pm local warehouse time count from the next business day). You'll receive a dispatch confirmation with tracking as soon as the parcel leaves the warehouse.

Delivery estimates after dispatch:
- Standard domestic: 3–7 business days, free on orders over $75, otherwise $4.95.
- Express domestic: 1–2 business days, $12.95.
- International: 7–21 business days depending on destination. Import duties and customs fees are the recipient's responsibility and are not included at checkout.

During sale periods processing can take up to 4 business days. If an item in your order is back-ordered we ship the rest immediately and send the remainder separately at no extra cost. Address changes are only possible before dispatch — contact us as soon as possible with the order number.`,
  },
  {
    title: 'Tracking your order',
    category: 'Shipping',
    body: `A tracking link is emailed within 24 hours of dispatch. If you have an account, the same link is under Orders → Order details.

Common tracking situations:
- "Label created" for more than 2 business days: the carrier hasn't scanned the parcel yet. This usually resolves at the next depot scan; the parcel is often already moving.
- No movement for 5+ business days (domestic) or 10+ (international): contact us with your order number and we'll open a trace with the carrier. Traces take 3–5 business days; if the carrier confirms loss we reship or refund immediately.
- "Delivered" but nothing arrived: check with neighbours and around safe-drop spots first, then report it within 7 days. We investigate GPS scan data with the carrier before resolving.

Note that tracking emails sometimes land in spam, and international tracking can go quiet for several days while a parcel clears customs — that's normal.`,
  },
  {
    title: 'App running slowly or crashing: troubleshooting steps',
    category: 'Technical',
    body: `Before anything else, check status.example.com — if there's an active incident, the banner will say so and no local troubleshooting will help.

If the platform status is green:
1. Hard-refresh the page (Ctrl+Shift+R / Cmd+Shift+R) to bypass cached assets.
2. Clear the site's cached data: browser settings → site data → remove for our domain, then sign in again.
3. Disable browser extensions, especially ad blockers and privacy tools — they commonly block the websocket connection the dashboard needs, which shows up as spinners that never finish or live data that never updates.
4. Try a supported browser: the latest two versions of Chrome, Firefox, Edge, or Safari. Internet Explorer and very old WebViews are not supported.
5. On mobile, update the app; versions older than 12 months lose API compatibility.

If the problem persists, send support: the exact time it happened, your browser and version, what you clicked, and any red errors from the browser console (F12 → Console). A screenshot of the Network tab for the failing action speeds diagnosis up considerably.`,
  },
  {
    title: 'Screen display problems: blank, black, or garbled screen',
    category: 'Technical',
    body: `A black or blank screen after sign-in is nearly always a rendering issue on the device rather than an outage. Work through:

1. Test in a private/incognito window. If it renders there, clear the site's cached data in your normal window.
2. Toggle hardware acceleration: in Chrome, Settings → System → "Use graphics acceleration when available", flip it, restart the browser. Faulty GPU drivers are the top cause of black canvases and garbled charts.
3. Update your graphics driver / OS. On Windows laptops with dual GPUs, forcing the browser onto the integrated GPU often fixes it.
4. Check the browser zoom is 100% (Ctrl+0) — extreme zoom can blank complex dashboard layouts.
5. Safari 16 and older has a known compositing bug with our charts; update Safari or use Chrome/Firefox until you can.

If the screen is blank only for one specific page and every other page works, tell support which page plus your browser version and OS — include a screenshot of the browser console (F12) so we can see the rendering errors.`,
  },
  {
    title: 'How we handle feature requests',
    category: 'General',
    body: `We genuinely read every feature request. Here's what happens to yours:

1. Submit it as a ticket (or through Settings → Send feedback). Describe the problem you're trying to solve, not just the feature — "I need to export monthly cost per project for finance" is far more useful than "add export button".
2. The product team triages new requests monthly. Requests are grouped with similar ones and weighted by how many customers they affect, so a "duplicate" is a good thing — it adds a vote to the existing idea.
3. Accepted ideas appear on the public roadmap at roadmap.example.com with statuses Planned, In progress, and Shipped. You can vote and subscribe for updates there.

We deliberately don't promise dates or ETAs — priorities shift, and we'd rather not break promises. If a request is something we decide not to build, we say so on the roadmap rather than leaving it in limbo. Workarounds for common gaps are documented in the knowledge base in the meantime.`,
  },
];

const run = async () => {
  await connectDB();

  // --- MongoDB side ---
  await KBArticle.deleteMany({});
  const docs = await KBArticle.insertMany(ARTICLES);
  console.log(`MongoDB: seeded ${docs.length} KB articles.`);

  // --- Pinecone side ---
  await ensureIndex();
  const ns = getIndex().namespace(KB_NAMESPACE);
  try {
    await ns.deleteAll();
  } catch (err) {
    // A brand-new index has no namespace to clear yet.
    if (!/404|not found/i.test(err.message)) throw err;
  }

  const vectors = [];
  const batchSize = 32; // Pinecone inference caps batches well above this; keep requests small.
  for (let i = 0; i < docs.length; i += batchSize) {
    const batch = docs.slice(i, i + batchSize);
    const values = await embedPassages(batch.map((d) => `${d.title}\n\n${d.body}`));
    batch.forEach((doc, j) => {
      vectors.push({
        id: doc._id.toString(),
        values: values[j],
        metadata: { mongoId: doc._id.toString(), title: doc.title, category: doc.category },
      });
    });
  }
  await ns.upsert(vectors);
  console.log(`Pinecone: upserted ${vectors.length} vectors into namespace "${KB_NAMESPACE}".`);

  // Upserts are eventually consistent; poll stats until the count shows up.
  let pineconeCount = -1;
  for (let attempt = 0; attempt < 15; attempt++) {
    const stats = await getIndex().describeIndexStats();
    pineconeCount = stats.namespaces?.[KB_NAMESPACE]?.recordCount ?? 0;
    if (pineconeCount === docs.length) break;
    await new Promise((r) => setTimeout(r, 2000));
  }

  const mongoCount = await KBArticle.countDocuments();
  console.log(`\nVerification: MongoDB count = ${mongoCount}, Pinecone count = ${pineconeCount}`);
  if (mongoCount !== pineconeCount) {
    console.error('COUNT MISMATCH — investigate before continuing.');
    process.exitCode = 1;
  } else {
    console.log('Counts match.');
  }
  await mongoose.disconnect();
};

run().catch((err) => {
  console.error(`Seed failed: ${err.message}`);
  process.exit(1);
});
