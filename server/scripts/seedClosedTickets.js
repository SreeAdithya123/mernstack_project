// Phase 5: seed realistic resolved tickets and index their problem+resolution
// into the Pinecone `closed-tickets` namespace. Idempotent: seeded tickets use
// the @seed.example.com email domain and are wiped before re-inserting; the
// namespace is cleared and rebuilt from what's inserted.
import mongoose from 'mongoose';
import { connectDB } from '../src/db.js';
import Ticket from '../src/models/Ticket.js';
import { embedPassages } from '../src/lib/embeddings.js';
import { ensureIndex, getIndex, CLOSED_TICKETS_NAMESPACE } from '../src/lib/pinecone.js';
import { ticketQueryText } from '../src/lib/retrieval.js';

const SEED_DOMAIN = 'seed.example.com';

const CLOSED_TICKETS = [
  {
    submitterName: 'Marta Kowalska',
    subject: 'Locked out — lost phone with authenticator app',
    sentiment: 'Negative',
    priority: 'High',
    category: 'Technical',
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
    sentiment: 'Negative',
    priority: 'Medium',
    category: 'Technical',
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
    sentiment: 'Negative',
    priority: 'Medium',
    category: 'Billing',
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
    sentiment: 'Angry',
    priority: 'High',
    category: 'Billing',
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
    sentiment: 'Neutral',
    priority: 'Low',
    category: 'Billing',
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
    sentiment: 'Neutral',
    priority: 'Medium',
    category: 'Billing',
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
    sentiment: 'Negative',
    priority: 'Medium',
    category: 'Technical',
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
    sentiment: 'Negative',
    priority: 'Medium',
    category: 'Technical',
    userMessage:
      'I have requested a password reset four times today and no email ever shows up. Not in spam either. I am locked out of my account.',
    agentReply:
      'Thanks for checking spam already. The most common cause is requesting the reset for a different address than the registered one — many people have two similar addresses. I checked our logs: the requests were sent to an address that is not on any account. Please try your other email address.',
    resolutionSummary:
      'Reset emails "not arriving" because requests used an unregistered email address (typo variant of the real one). Customer retried with the registered address and reset succeeded. No mail delivery fault on our side.',
  },
];

const run = async () => {
  await connectDB();

  // --- MongoDB side ---
  const wiped = await Ticket.deleteMany({ submitterEmail: new RegExp(`@${SEED_DOMAIN}$`) });
  if (wiped.deletedCount) console.log(`MongoDB: removed ${wiped.deletedCount} previously seeded closed tickets.`);

  const now = Date.now();
  const docs = await Ticket.insertMany(
    CLOSED_TICKETS.map((t, i) => ({
      submitterName: t.submitterName,
      submitterEmail: `${t.submitterName.toLowerCase().replace(/[^a-z]+/g, '.')}@${SEED_DOMAIN}`,
      subject: t.subject,
      messages: [
        { author: 'user', text: t.userMessage, timestamp: new Date(now - (20 - i) * 864e5) },
        { author: 'agent', text: t.agentReply, timestamp: new Date(now - (20 - i) * 864e5 + 36e5) },
      ],
      status: 'Resolved',
      sentiment: t.sentiment,
      priority: t.priority,
      category: t.category,
      resolutionSummary: t.resolutionSummary,
    }))
  );
  console.log(`MongoDB: seeded ${docs.length} resolved tickets.`);

  // --- Pinecone side ---
  await ensureIndex();
  const ns = getIndex().namespace(CLOSED_TICKETS_NAMESPACE);
  try {
    await ns.deleteAll();
  } catch (err) {
    if (!/404|not found/i.test(err.message)) throw err;
  }

  const passages = docs.map((d) => `${ticketQueryText(d)}\n\nResolution: ${d.resolutionSummary}`);
  const values = await embedPassages(passages);
  await ns.upsert(
    docs.map((d, i) => ({
      id: d._id.toString(),
      values: values[i],
      metadata: { mongoId: d._id.toString(), subject: d.subject, resolutionSummary: d.resolutionSummary },
    }))
  );
  console.log(`Pinecone: upserted ${docs.length} vectors into namespace "${CLOSED_TICKETS_NAMESPACE}".`);

  let count = -1;
  for (let attempt = 0; attempt < 15; attempt++) {
    const stats = await getIndex().describeIndexStats();
    count = stats.namespaces?.[CLOSED_TICKETS_NAMESPACE]?.recordCount ?? 0;
    if (count === docs.length) break;
    await new Promise((r) => setTimeout(r, 2000));
  }
  console.log(`\nVerification: MongoDB seeded ${docs.length}, Pinecone namespace count = ${count}`);
  if (count !== docs.length) {
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
