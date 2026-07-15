// (Re)computes and stores the embedding for a KB article after the admin UI
// creates or edits it, so it's immediately findable via kb-search. Staff-only.
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

async function embed(text: string): Promise<number[]> {
  const key = Deno.env.get('GEMINI_API_KEY');
  if (!key) throw new Error('GEMINI_API_KEY not set');
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${key}`,
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
  return body.embedding.values;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const { article_id } = await req.json();
    if (!article_id) throw new Error('article_id required');

    const authHeader = req.headers.get('Authorization')!;
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('unauthorized');

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    const { data: profile } = await admin.from('profiles').select('role').eq('id', user.id).single();
    if (profile?.role !== 'salesperson' && profile?.role !== 'admin') throw new Error('forbidden');

    const { data: article, error: articleErr } = await admin
      .from('kb_articles')
      .select('id, title, content')
      .eq('id', article_id)
      .single();
    if (articleErr || !article) throw new Error('article not found');

    const vector = await embed(`${article.title}\n\n${article.content}`);

    const { error: updateErr } = await admin.from('kb_articles').update({ embedding: vector }).eq('id', article_id);
    if (updateErr) throw new Error(`failed to save embedding: ${updateErr.message}`);

    return new Response(JSON.stringify({ embedded: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
