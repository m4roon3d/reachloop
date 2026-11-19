// reachloop AI endpoint (Cloudflare Pages Function): the app sends a prompt and photos,
// this calls Gemini with the key kept as a Cloudflare secret, and returns the text.
//
// Secrets / variables (Cloudflare → reachloop project → Settings → Variables and Secrets):
//   GEMINI_API_KEY     (secret)   your Gemini API key
//   APP_PASSCODE       (secret)   a passcode you choose; the app sends it with every request
//   GEMINI_MODEL       (optional) a specific Gemini model id; by default the newest available Flash
//   OPENROUTER_API_KEY (secret, optional) enables the free backup (NVIDIA Nemotron via OpenRouter),
//                      used only when Gemini fails and the app asks for it (per workspace setting)
//   OPENROUTER_MODEL   (optional) backup model id to try first

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
async function callGemini(env, model, parts, wantJson, timeoutMs = GEMINI_TIMEOUT_MS) {
  const send = (withThinking) => fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
    signal: AbortSignal.timeout(timeoutMs),
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

// Models this key can use, newest Flash first and Flash-Lite after (cached per server instance).
let modelList = null;
async function availableModels(env) {
  if (modelList) return modelList;
  const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { headers: { 'x-goog-api-key': env.GEMINI_API_KEY } }).catch(() => null);
  if (!r || !r.ok) return [];
  const d = await r.json().catch(() => ({}));
  const names = (d.models || [])
    .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map((m) => String(m.name || '').replace(/^models\//, ''))
    .filter((n) => /flash/.test(n) && !/(tts|image|live|audio|embedding|robotics|preview|exp|latest)/.test(n));
  const ver = (n) => (n.match(/(\d+(?:\.\d+)?)/) || [0, 0])[1] * 1;
  const byNewest = (a, b) => ver(b) - ver(a) || a.length - b.length;
  // alternate Flash and Flash-Lite: when the Flash models are overloaded together, Lite often is not
  const flash = names.filter((n) => !/lite/.test(n)).sort(byNewest);
  const lite = names.filter((n) => /lite/.test(n)).sort(byNewest);
  modelList = [];
  for (let i = 0; i < Math.max(flash.length, lite.length); i++) { if (flash[i]) modelList.push(flash[i]); if (lite[i]) modelList.push(lite[i]); }
  return modelList;
}
let workingModel = null; // last model that answered, tried first next time
const notFound = (status, data) => status === 404 || (status === 400 && /not (found|supported)|unknown model|is not available/i.test(String((data && data.error && data.error.message) || '')));

export async function onRequestGet({ env }) {
  return json({ ok: true, configured: Boolean((env.GEMINI_API_KEY || env.OPENROUTER_API_KEY) && env.APP_PASSCODE), backup: Boolean(env.OPENROUTER_API_KEY) });
}

export async function onRequestPost({ request, env }) {
  if (!(env.GEMINI_API_KEY || env.OPENROUTER_API_KEY) || !env.APP_PASSCODE) return json({ error: 'not_configured' }, 503);
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
  const wantJson = Boolean(body.json);
  const started = Date.now();
  const backupOK = Boolean(body.backup && env.OPENROUTER_API_KEY);

  const first = env.GEMINI_API_KEY
    ? await geminiGenerate(env, prompt, images, wantJson, backupOK ? 95_000 : 125_000)
    : out({ error: 'not_configured', detail: 'No Gemini key set' }, 503);
  if (first.httpStatus === 200 || !backupOK || first.error === 'refused') return first;

  // Gemini failed: try the free backup with the time that is left (everything stays under ~150s)
  const backup = await openRouterGenerate(env, prompt, images, 150_000 - (Date.now() - started));
  if (backup.httpStatus === 200) return { ...backup, ms: Date.now() - started, note: `Gemini failed (${first.error}); the free backup answered` };
  return { ...first, detail: `${first.detail || first.error}; backup: ${backup.detail || backup.error}` };
}

// Free backup through OpenRouter (NVIDIA Nemotron vision models). Free endpoints log prompts,
// so the app only asks for this where the workspace allows it.
const BACKUP_MODELS = ['nvidia/nemotron-3.5-super-vl:free', 'nvidia/nemotron-nano-12b-v2-vl:free'];
async function openRouterGenerate(env, prompt, images, budgetMs) {
  const models = [...new Set([env.OPENROUTER_MODEL, ...BACKUP_MODELS].filter(Boolean))];
  const started = Date.now(), notes = [];
  for (const model of models) {
    const left = budgetMs - (Date.now() - started);
    if (left < 8_000) { notes.push('out of time'); break; }
    try {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        signal: AbortSignal.timeout(Math.min(left, 60_000)),
        headers: { 'content-type': 'application/json', authorization: `Bearer ${env.OPENROUTER_API_KEY}`, 'x-title': 'reachloop' },
        body: JSON.stringify({
          model,
          max_tokens: 8192,
          reasoning: { effort: 'low', exclude: true },
          messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, ...images.map((d) => ({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${d}` } }))] }]
        })
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || (data && data.error)) {
        notes.push(`${model}: HTTP ${res.status}${data && data.error && data.error.message ? ' ' + String(data.error.message).slice(0, 90) : ''}`);
        continue;
      }
      const choice = data && data.choices && data.choices[0];
      let text = choice && choice.message && choice.message.content;
      if (Array.isArray(text)) text = text.map((p) => p.text || '').join('');
      text = String(text || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
      if (!text) { notes.push(`${model}: empty reply`); continue; }
      return out({ text, model: `backup:${model}`, backup: true, truncated: choice.finish_reason === 'length' });
    } catch (e) {
      notes.push(`${model}: ${e && (e.name === 'TimeoutError' || e.name === 'AbortError') ? 'no answer in time' : 'network error'}`);
    }
  }
  return out({ error: 'backup_failed', detail: notes.join('; ') || 'no backup model answered' }, 502);
}

async function geminiGenerate(env, prompt, images, wantJson, BUDGET_MS) {
  const parts = [...images.map((data) => ({ inline_data: { mime_type: 'image/jpeg', data } })), { text: prompt }];
  const started = Date.now();
  const PER_MODEL_MS = Number(env.AI_PER_MODEL_MS) || 40_000; // a model that has not answered by then is treated as busy
  const slow = (st) => st === 503 || st === 500 || st === 502 || st === 504 || st === 524 || st === 429;
  const listed = env.GEMINI_MODEL ? [] : await availableModels(env);
  const queue = [env.GEMINI_MODEL || workingModel || listed[0] || DEFAULT_MODEL, ...listed];
  const tried = [], notes = [];
  let model, res = null, data = null, triedList = Boolean(listed.length);

  while (queue.length && tried.length < 5) {
    const left = BUDGET_MS - (Date.now() - started);
    if (left < 8_000) break;
    model = queue.shift();
    if (tried.includes(model)) continue;
    tried.push(model);
    try {
      res = await callGemini(env, model, parts, wantJson, Math.min(PER_MODEL_MS, left));
      data = await res.json().catch(() => null);
    } catch (e) {
      const timedOut = e && (e.name === 'TimeoutError' || e.name === 'AbortError');
      notes.push(`${model}: ${timedOut ? 'no answer in ' + Math.round(Math.min(PER_MODEL_MS, left) / 1000) + 's' : 'network error'}`);
      res = null; data = null; continue;
    }
    if (res.ok) break;
    notes.push(`${model}: HTTP ${res.status}`);
    if (slow(res.status) || notFound(res.status, data)) {
      if (!triedList && !env.GEMINI_MODEL) { triedList = true; for (const m of await availableModels(env)) if (!tried.includes(m)) queue.push(m); }
      continue;
    }
    break; // bad key, bad request and the like: another model will not help
  }
  if (res && res.ok) workingModel = env.GEMINI_MODEL ? null : model;

  if (!res) {
    return out({ error: 'timeout', model, detail: `No model answered in time (${notes.join('; ')})` }, 504);
  }

  if (!res.ok) {
    const detail = (String((data && data.error && data.error.message) || '').slice(0, 240) + (notes.length > 1 ? ` (tried: ${notes.join('; ')})` : '')).trim();
    const info = { detail, status: res.status, model };
    if (res.status === 429) return out({ error: 'rate_limited', ...info }, 429);
    if (res.status === 400 || res.status === 403) return out({ error: 'upstream_rejected', ...info }, 502);
    return out({ error: 'upstream', ...info }, 502);
  }

  const cand = data && data.candidates && data.candidates[0];
  if (!cand) return out({ error: 'refused', model, detail: String((data && data.promptFeedback && data.promptFeedback.blockReason) || 'blocked') }, 422);
  const text = ((cand.content && cand.content.parts) || []).filter((p) => p.text && !p.thought).map((p) => p.text).join('');
  if (!text.trim()) return out({ error: cand.finishReason === 'SAFETY' ? 'refused' : 'empty', model, detail: `finished with ${cand.finishReason || 'no text'}` }, cand.finishReason === 'SAFETY' ? 422 : 502);
  return out({ text, model, tried: tried.length > 1 ? tried : undefined, ms: Date.now() - started, truncated: cand.finishReason === 'MAX_TOKENS' });
}
