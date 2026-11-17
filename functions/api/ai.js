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
      generationConfig: wantJson ? { responseMimeType: 'application/json' } : {}
    })
  });
}

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

  let model = env.GEMINI_MODEL || DEFAULT_MODEL;
  let res = await callGemini(env, model, parts, Boolean(body.json));
  if (res.status === 404 && model !== DEFAULT_MODEL) { model = DEFAULT_MODEL; res = await callGemini(env, model, parts, Boolean(body.json)); }

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const detail = String((data && data.error && data.error.message) || '').slice(0, 300);
    if (res.status === 429) return json({ error: 'rate_limited', detail }, 429);
    if (res.status === 400 || res.status === 403) return json({ error: 'upstream_rejected', detail }, 502);
    return json({ error: 'upstream', detail }, 502);
  }

  const cand = data && data.candidates && data.candidates[0];
  if (!cand) return json({ error: 'refused', detail: String((data && data.promptFeedback && data.promptFeedback.blockReason) || '') }, 422);
  const text = ((cand.content && cand.content.parts) || []).filter((p) => p.text && !p.thought).map((p) => p.text).join('');
  if (!text.trim()) return json({ error: cand.finishReason === 'SAFETY' ? 'refused' : 'empty', detail: cand.finishReason || '' }, cand.finishReason === 'SAFETY' ? 422 : 502);
  return json({ text, model, truncated: cand.finishReason === 'MAX_TOKENS' });
}
