// Client-invoked, synchronous (the user is actively waiting to review the
// transcript before submitting). Uses a multimodal Gemini model - the
// text-chat GEMINI_MODEL default (gemma-4-31b-it) is text-only and can't do
// this. No OpenRouter fallback: OpenRouter's free-tier text models don't take
// audio input either, and this is a synchronous user-facing call where a long
// fallback chain would just mean a longer wait before failing - better to
// fail fast and let the user type instead.
//
// Model choice verified live against this project's key (2026-07-17):
// gemini-2.0-flash / gemini-2.0-flash-lite returned 429 (quota exhausted on
// this key specifically), gemini-2.5-flash / gemini-2.5-flash-lite returned
// 404 ("no longer available to new users"). gemini-flash-latest works and
// transcribed a test clip correctly.
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const TRANSCRIBE_MODEL = Deno.env.get('GEMINI_TRANSCRIBE_MODEL') || 'gemini-flash-latest';

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

    const key = Deno.env.get('GEMINI_API_KEY');
    if (!key) throw new Error('GEMINI_API_KEY not set');

    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${TRANSCRIBE_MODEL}:generateContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              { text: 'Transcribe this audio verbatim. Respond with ONLY the transcript text - no commentary, no markdown, no quotation marks around it.' },
              { inlineData: { mimeType: mime_type, data: audio_base64 } },
            ],
          },
        ],
        generationConfig: { temperature: 0 },
      }),
    });
    const raw = await res.text();
    if (!res.ok) throw new Error(`transcription failed: ${res.status} ${raw.slice(0, 300)}`);

    const parts = JSON.parse(raw).candidates?.[0]?.content?.parts;
    const transcript = (parts ?? []).map((p: { text?: string }) => p.text ?? '').join('').trim();
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
