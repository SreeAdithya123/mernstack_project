import { supabase } from './supabase.js';

function unwrap({ data, error }) {
  if (error) throw error;
  return data;
}

async function invoke(fn, body) {
  const { data, error } = await supabase.functions.invoke(fn, { body });
  if (error) {
    const context = await error.context?.json?.().catch(() => null);
    throw new Error(context?.error || error.message);
  }
  return data;
}

export const admin = {
  listProfiles() {
    return supabase.from('profiles').select('*').order('created_at', { ascending: false }).then(unwrap);
  },

  setRole(userId, role) {
    return supabase.from('profiles').update({ role }).eq('id', userId).select().single().then(unwrap);
  },

  listArticles() {
    return supabase.from('kb_articles').select('id, title, content, category, created_at').order('created_at', { ascending: false }).then(unwrap);
  },

  async createArticle({ title, content, category }) {
    const article = await supabase.from('kb_articles').insert({ title, content, category }).select().single().then(unwrap);
    await invoke('embed-kb-article', { article_id: article.id });
    return article;
  },

  async updateArticle(id, { title, content, category }) {
    const article = await supabase.from('kb_articles').update({ title, content, category }).eq('id', id).select().single().then(unwrap);
    await invoke('embed-kb-article', { article_id: article.id });
    return article;
  },

  deleteArticle(id) {
    return supabase.from('kb_articles').delete().eq('id', id).then(unwrap);
  },

  // Basic breakdown for the admin analytics view - small enough to compute
  // client-side from a single tickets fetch rather than a dedicated function.
  async ticketStats() {
    const rows = await supabase.from('tickets').select('status, sentiment, priority, category').then(unwrap);
    const count = (key) => rows.reduce((acc, r) => {
      const k = r[key] ?? 'unclassified';
      acc[k] = (acc[k] ?? 0) + 1;
      return acc;
    }, {});
    return {
      total: rows.length,
      byStatus: count('status'),
      bySentiment: count('sentiment'),
      byPriority: count('priority'),
      byCategory: count('category'),
    };
  },
};
