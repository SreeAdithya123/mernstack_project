// Client-invoked, synchronous (the user is actively waiting to review the
// transcript before submitting). Uses ElevenLabs Speech-to-Text (scribe_v1) -
// verified live against this project's key (2026-07-18): a synthesized test
// clip (Windows System.Speech.Synthesis) transcribed with an exact
// word-for-word match. Client contract (audio_base64/mime_type in,
// {transcript} out) is unchanged from the prior Gemini-based version, so no
// frontend changes were needed to switch providers.
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const EXT_BY_MIME: Record<string, string> = {
  'audio/webm': 'webm',
  'audio/mp4': 'mp4',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/ogg': 'ogg',
};

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const authHeader = req.headers.get('Authorization')!;
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('unauthorized');

    const { audio_base64, mime_type } = await req.json();
    if (!audio_base64) throw new Error('audio_base64 required');
    if (!mime_type) throw new Error('mime_type required');

    // Cap payload size (~8MB base64 ~= ~6MB audio) - a support voice note has
    // no business being longer than a minute or two of compressed audio.
    if (audio_base64.length > 8_000_000) throw new Error('audio too large - please keep voice notes under ~1 minute');

    const key = Deno.env.get('ELEVENLABS_API_KEY');
    if (!key) throw new Error('ELEVENLABS_API_KEY not set');

    const bytes = base64ToBytes(audio_base64);
    const ext = EXT_BY_MIME[mime_type.split(';')[0]] ?? 'webm';
    const form = new FormData();
    form.append('model_id', 'scribe_v1');
    form.append('file', new Blob([bytes], { type: mime_type }), `voice-note.${ext}`);

    const res = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
      method: 'POST',
      headers: { 'xi-api-key': key },
      body: form,
    });
    const raw = await res.text();
    if (!res.ok) throw new Error(`transcription failed: ${res.status} ${raw.slice(0, 300)}`);

    const transcript = String(JSON.parse(raw).text ?? '').trim();
    if (!transcript) throw new Error('transcription returned no text - the audio may be silent or unclear');

    return new Response(JSON.stringify({ transcript }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
