// Fired by a Postgres trigger (via pg_net) on ticket status changes and on
// staff replies - never called from the client. verify_jwt is off for this
// function (a pg_net trigger has no end-user JWT to present); instead it
// checks a shared secret header set identically in the trigger's pg_net call
// and here as WEBHOOK_SHARED_SECRET, so only our own DB trigger can invoke it.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts';

const corsHeaders = { 'Access-Control-Allow-Origin': '*' };

function subjectAndBody(type: string, ticketSubject: string, extra: Record<string, string>) {
  if (type === 'status_change') {
    return {
      subject: `Update on your ticket: ${ticketSubject}`,
      html: `<p>Your ticket "<strong>${ticketSubject}</strong>" status changed to <strong>${extra.status}</strong>.</p>`,
    };
  }
  return {
    subject: `New reply on your ticket: ${ticketSubject}`,
    html: `<p>An agent replied to your ticket "<strong>${ticketSubject}</strong>":</p><blockquote>${extra.body}</blockquote>`,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const secret = req.headers.get('x-webhook-secret');
    if (!secret || secret !== Deno.env.get('WEBHOOK_SHARED_SECRET')) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: corsHeaders });
    }

    const payload = await req.json();
    const { type, ticket_id, status, body } = payload;
    if (!type || !ticket_id) throw new Error('type and ticket_id required');

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    const { data: ticket, error: ticketErr } = await admin
      .from('tickets')
      .select('subject, customer_id, profiles:customer_id (email)')
      .eq('id', ticket_id)
      .single();
    if (ticketErr || !ticket) throw new Error('ticket not found');

    const customerEmail = (ticket as any).profiles?.email;
    if (!customerEmail) throw new Error('customer has no email on file');

    const { subject, html } = subjectAndBody(type, ticket.subject, { status, body });

    const gmailUser = Deno.env.get('GMAIL_USER');
    const gmailPass = Deno.env.get('GMAIL_APP_PASSWORD');
    if (!gmailUser || !gmailPass) throw new Error('GMAIL_USER / GMAIL_APP_PASSWORD not set');

    const client = new SMTPClient({
      connection: {
        hostname: 'smtp.gmail.com',
        port: 465,
        tls: true,
        auth: { username: gmailUser, password: gmailPass },
      },
    });

    await client.send({
      from: `SmartSupport <${gmailUser}>`,
      to: customerEmail,
      subject,
      html,
    });
    await client.close();

    return new Response(JSON.stringify({ sent: true, to: customerEmail }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
