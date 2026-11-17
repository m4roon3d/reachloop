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

const GEMINI_TIMEOUT_MS = 150_000;
let thinkingSupported = true;
async function callGemini(env, model, parts, wantJson) {
  const send = (withThinking) => fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
    signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
    body: JSON.stringify({
      contents: [{ role: 'user', parts }],
      generationConfig: {
        maxOutputTokens: 8192,
        ...(wantJson ? { responseMimeType: 'application/json' } : {}),
        // captions don't need long deliberation; less thinking means much faster replies
        ...(withThinking ? { thinkingConfig: { thinkingLevel: 'low' } } : {})
      }
    })
  });
  let res = await send(thinkingSupported);
  if (thinkingSupported && res.status === 400) {
    const peek = await res.clone().json().catch(() => null);
    if (/thinking/i.test(String((peek && peek.error && peek.error.message) || ''))) { thinkingSupported = false; res = await send(false); }
  }
  return res;
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

  return keepAliveResponse(() => generate(env, body));
}

// Cloudflare ends a request with error 524 if no reply has started after ~100s. Start the reply
// at once, send a space every 10s while Gemini works, then the JSON (leading spaces are valid JSON).
// The real status travels inside the JSON as httpStatus.
function keepAliveResponse(work) {
  const { readable, writable } = new TransformStream();
  const w = writable.getWriter();
  const enc = new TextEncoder();
  w.write(enc.encode(' '));
  const ping = setInterval(() => { w.write(enc.encode(' ')).catch(() => {}); }, 10_000);
  (async () => {
    let result;
    try { result = await work(); } catch (e) { result = { httpStatus: 500, error: 'server', detail: String((e && e.message) || e).slice(0, 200) }; }
    clearInterval(ping);
    try { await w.write(enc.encode(JSON.stringify(result))); await w.close(); } catch (_) {}
  })();
  return new Response(readable, { status: 200, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
}

const out = (body, status = 200) => ({ ...body, httpStatus: status });

async function generate(env, body) {
  const prompt = String((body && body.prompt) || '').slice(0, MAX_PROMPT);
  if (!prompt.trim()) return out({ error: 'bad_request' }, 400);
  const images = (Array.isArray(body.images) ? body.images : [])
    .filter((d) => typeof d === 'string' && d.length < 8_000_000)
    .slice(0, MAX_IMAGES);
  const parts = [...images.map((data) => ({ inline_data: { mime_type: 'image/jpeg', data } })), { text: prompt }];

  const started = Date.now();
  let model = env.GEMINI_MODEL || pickedModel || DEFAULT_MODEL;
  let res, data;
  try {
    res = await callGemini(env, model, parts, Boolean(body.json));
    data = await res.json().catch(() => null);
    if (!res.ok && notFound(res.status, data)) {
      const alt = await pickAvailableModel(env);
      if (alt && alt !== model) { model = alt; res = await callGemini(env, model, parts, Boolean(body.json)); data = await res.json().catch(() => null); }
    }
  } catch (e) {
    const timedOut = e && (e.name === 'TimeoutError' || e.name === 'AbortError');
    return out({ error: timedOut ? 'timeout' : 'network', model, detail: timedOut ? `Gemini did not answer within ${GEMINI_TIMEOUT_MS / 1000}s` : String(e && e.message || e).slice(0, 200) }, 504);
  }

  if (!res.ok) {
    const detail = String((data && data.error && data.error.message) || '').slice(0, 300);
    const info = { detail, status: res.status, model };
    if (res.status === 429) return out({ error: 'rate_limited', ...info }, 429);
    if (res.status === 400 || res.status === 403) return out({ error: 'upstream_rejected', ...info }, 502);
    return out({ error: 'upstream', ...info }, 502);
  }

  const cand = data && data.candidates && data.candidates[0];
  if (!cand) return out({ error: 'refused', model, detail: String((data && data.promptFeedback && data.promptFeedback.blockReason) || 'blocked') }, 422);
  const text = ((cand.content && cand.content.parts) || []).filter((p) => p.text && !p.thought).map((p) => p.text).join('');
  if (!text.trim()) return out({ error: cand.finishReason === 'SAFETY' ? 'refused' : 'empty', model, detail: `finished with ${cand.finishReason || 'no text'}` }, cand.finishReason === 'SAFETY' ? 422 : 502);
  return out({ text, model, ms: Date.now() - started, truncated: cand.finishReason === 'MAX_TOKENS' });
}
