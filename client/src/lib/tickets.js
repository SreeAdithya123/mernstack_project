import { supabase } from './supabase.js';

async function invoke(fn, body) {
  const { data, error } = await supabase.functions.invoke(fn, { body });
  if (error) {
    // FunctionsHttpError carries the actual response body with the real message.
    const context = await error.context?.json?.().catch(() => null);
    throw new Error(context?.error || error.message);
  }
  return data;
}

export const tickets = {
  // Creates the ticket + its opening message, then triggers classification.
  // Mirrors the old Express flow's single "submit -> triage" round trip.
  // Language detection/translation happens automatically server-side (DB
  // trigger -> translate-message), not here.
  async create({ customerId, subject, message, isVoiceTranscript = false }) {
    const { data: ticket, error: ticketErr } = await supabase
      .from('tickets')
      .insert({ customer_id: customerId, subject })
      .select()
      .single();
    if (ticketErr) throw ticketErr;

    const { error: messageErr } = await supabase
      .from('ticket_messages')
      .insert({ ticket_id: ticket.id, sender_id: customerId, body: message, is_voice_transcript: isVoiceTranscript });
    if (messageErr) throw messageErr;

    let classificationError = null;
    let classified = ticket;
    try {
      const result = await invoke('classify-ticket', { ticket_id: ticket.id });
      classified = { ...ticket, ...result };
    } catch (err) {
      classificationError = err.message;
    }
    return { ticket: classified, classificationError };
  },

  listMine() {
    return supabase.from('tickets').select('*').order('created_at', { ascending: false }).then(unwrap);
  },

  listAll() {
    return supabase.from('tickets').select('*').order('created_at', { ascending: false }).then(unwrap);
  },

  get(id) {
    return supabase.from('tickets').select('*').eq('id', id).single().then(unwrap);
  },

  // internalOnly=false (default) hides AI-draft rows from the customer view.
  messages(ticketId, { includeInternal = false } = {}) {
    let query = supabase.from('ticket_messages').select('*').eq('ticket_id', ticketId).order('created_at', { ascending: true });
    if (!includeInternal) query = query.eq('internal_only', false);
    return query.then(unwrap);
  },

  reply(ticketId, senderId, body) {
    return supabase.from('ticket_messages').insert({ ticket_id: ticketId, sender_id: senderId, body }).select().single().then(unwrap);
  },

  // "Send" on an AI draft: mark it no longer draft/internal so it becomes a
  // normal visible message (edited text goes through `finalBody`).
  sendDraft(messageId, finalBody) {
    return supabase
      .from('ticket_messages')
      .update({ body: finalBody, is_ai_draft: false, internal_only: false })
      .eq('id', messageId)
      .select()
      .single()
      .then(unwrap);
  },

  updateStatus(ticketId, patch) {
    return supabase.from('tickets').update(patch).eq('id', ticketId).select().single().then(unwrap);
  },

  classify: (ticketId) => invoke('classify-ticket', { ticket_id: ticketId }),
  kbMatches: (ticketId) => invoke('kb-search', { ticket_id: ticketId }),
  similar: (ticketId) => invoke('similar-tickets', { ticket_id: ticketId }),
  draft: (ticketId) => invoke('draft-reply', { ticket_id: ticketId }),
  summarize: (ticketId) => invoke('summarize-ticket', { ticket_id: ticketId }),
  transcribeVoice: (audioBase64, mimeType) => invoke('transcribe-voice-note', { audio_base64: audioBase64, mime_type: mimeType }),
};

function unwrap({ data, error }) {
  if (error) throw error;
  return data;
}
