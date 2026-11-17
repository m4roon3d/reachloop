// reachloop AI endpoint (Cloudflare Pages Function): the app sends a prompt and photos,
// this calls Gemini with the key kept as a Cloudflare secret, and returns the text.
//
// Secrets / variables (Cloudflare → reachloop project → Settings → Variables and Secrets):
//   GEMINI_API_KEY  (secret)   your Gemini API key
//   APP_PASSCODE    (secret)   a passcode you choose; the app sends it with every request
//   GEMINI_MODEL    (optional) a specific model id; defaults to Google's current Flash alias

const DEFAULT_MODEL = 'gemini-flash-latest';
const MAX_IMAGES = 12;
const MAX_PROMPT = 200_000;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

function sameSecret(a, b) {
  const x = new TextEncoder().encode(String(a));
  const y = new TextEncoder().encode(String(b));
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0;
}

async function callGemini(env, model, parts, wantJson) {
  return fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
    body: JSON.stringify({
      contents: [{ role: 'user', parts }],
      generationConfig: { maxOutputTokens: 16384, ...(wantJson ? { responseMimeType: 'application/json' } : {}) }
    })
  });
}

// If the default model name is not available to this key, ask Google which Flash models it can use.
let pickedModel = null;
async function pickAvailableModel(env) {
  if (pickedModel) return pickedModel;
  const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { headers: { 'x-goog-api-key': env.GEMINI_API_KEY } });
  if (!r.ok) return null;
  const d = await r.json().catch(() => ({}));
  const names = (d.models || [])
    .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map((m) => String(m.name || '').replace(/^models\//, ''))
    .filter((n) => /flash/.test(n) && !/(lite|tts|image|live|audio|embedding|robotics|preview|exp)/.test(n));
  const ver = (n) => (n.match(/(\d+(?:\.\d+)?)/) || [0, 0])[1] * 1;
  names.sort((a, b) => ver(b) - ver(a) || a.length - b.length);
  pickedModel = names[0] || null;
  return pickedModel;
}
const notFound = (status, data) => status === 404 || (status === 400 && /not (found|supported)|unknown model|is not available/i.test(String((data && data.error && data.error.message) || '')));

export async function onRequestGet({ env }) {
  return json({ ok: true, configured: Boolean(env.GEMINI_API_KEY && env.APP_PASSCODE) });
}

export async function onRequestPost({ request, env }) {
  if (!env.GEMINI_API_KEY || !env.APP_PASSCODE) return json({ error: 'not_configured' }, 503);
  if (!sameSecret(request.headers.get('x-passcode') || '', env.APP_PASSCODE)) {
    await new Promise((r) => setTimeout(r, 400)); // slow down guessing
    return json({ error: 'bad_passcode' }, 401);
  }

  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad_request' }, 400); }
  if (body && body.ping) return json({ ok: true, model: env.GEMINI_MODEL || DEFAULT_MODEL });

  const prompt = String((body && body.prompt) || '').slice(0, MAX_PROMPT);
  if (!prompt.trim()) return json({ error: 'bad_request' }, 400);
  const images = (Array.isArray(body.images) ? body.images : [])
    .filter((d) => typeof d === 'string' && d.length < 8_000_000)
    .slice(0, MAX_IMAGES);
  const parts = [...images.map((data) => ({ inline_data: { mime_type: 'image/jpeg', data } })), { text: prompt }];

  const started = Date.now();
  let model = env.GEMINI_MODEL || pickedModel || DEFAULT_MODEL;
  let res = await callGemini(env, model, parts, Boolean(body.json));
  let data = await res.json().catch(() => null);
  if (!res.ok && notFound(res.status, data)) {
    const alt = await pickAvailableModel(env);
    if (alt && alt !== model) { model = alt; res = await callGemini(env, model, parts, Boolean(body.json)); data = await res.json().catch(() => null); }
  }

  if (!res.ok) {
    const detail = String((data && data.error && data.error.message) || '').slice(0, 300);
    const info = { detail, status: res.status, model };
    if (res.status === 429) return json({ error: 'rate_limited', ...info }, 429);
    if (res.status === 400 || res.status === 403) return json({ error: 'upstream_rejected', ...info }, 502);
    return json({ error: 'upstream', ...info }, 502);
  }

  const cand = data && data.candidates && data.candidates[0];
  if (!cand) return json({ error: 'refused', model, detail: String((data && data.promptFeedback && data.promptFeedback.blockReason) || 'blocked') }, 422);
  const text = ((cand.content && cand.content.parts) || []).filter((p) => p.text && !p.thought).map((p) => p.text).join('');
  if (!text.trim()) return json({ error: cand.finishReason === 'SAFETY' ? 'refused' : 'empty', model, detail: `finished with ${cand.finishReason || 'no text'}` }, cand.finishReason === 'SAFETY' ? 422 : 502);
  return json({ text, model, ms: Date.now() - started, truncated: cand.finishReason === 'MAX_TOKENS' });
}
