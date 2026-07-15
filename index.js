const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { SocksProxyAgent } = require('socks-proxy-agent');
const readline = require('readline');

const PROXIES_FILE = path.join(__dirname, 'proxies.txt');
const SETTINGS_FILE = path.join(__dirname, 'settings.json');
const RESULTS_DIR = path.join(__dirname, 'results');

const DEFAULT_SETTINGS = {
    webhookUrl: '',
    webhookContent: '`{name}` is available on {platform}!',
    webhookEmbedTitle: '',
    webhookEmbedDescription: '',
    webhookEmbedColor: '#00ff41',
    concurrency: 50,
    count: 100,
    length: 4,
    timeout: 10,
};

function loadSettings() {
    try {
        if (fs.existsSync(SETTINGS_FILE)) {
            const saved = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
            return { ...DEFAULT_SETTINGS, ...saved };
        }
    } catch {}
    return { ...DEFAULT_SETTINGS };
}

function saveSettings(s) {
    try { fs.writeFileSync(SETTINGS_FILE, JSON.stringify(s, null, 2)); return true; }
    catch { return false; }
}

const DISCORD_API = 'https://discord.com/api/v10/unique-username/username-attempt-unauthed';
const MC_API = 'https://api.mojang.com/users/profiles/minecraft/';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

const LETTERS = 'abcdefghijklmnopqrstuvwxyz';
const NUMBERS = '0123456789';
const ALNUM = LETTERS + NUMBERS;
const VOWELS = 'aeiou';
const CONS = 'bcdfghjklmnpqrstvwxyz';
const LEET = { a:'4', e:'3', i:'1', o:'0', s:'5', t:'7', b:'8', g:'9' };
const CHARS = LETTERS + NUMBERS + '_';

let dictLoaded = false;
async function ensureDict() {
    if (dictLoaded) return;
    try {
        const res = await axios.get('https://raw.githubusercontent.com/first20hours/google-10000-english/master/google-10000-english-no-swears.txt', { timeout: 3500, validateStatus: () => true });
        if (res.status >= 200 && res.status < 300 && typeof res.data === 'string') {
            const words = res.data.split(/\r?\n/).map(s => s.trim().toLowerCase()).filter(w => /^[a-z]{3,15}$/.test(w));
            if (words.length > 50) { DICT_WORDS.length = 0; DICT_WORDS.push(...words); }
        }
    } catch {}
    dictLoaded = true;
}

const DICT_WORDS = ['apple','stone','cloud','flame','frost','shade','crown','storm','ember','solar','nova','pixel','cyber','spark','vapor','blade','glow','drift','dawn','fox','lunar','mint','dusk','sage','bolt','ruby','onyx','ghost','raven','haze','veil','iris','echo','rift','flux','pale','ash','jade','opal','zinc','iron','void','clay','bore','tide','fume','glyph','wisp','bane','pyre','aether','vigor','ombre','rune','talon'];

function rand(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function pick(arr) { return rand(arr); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function shuffleInPlace(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

function nonEmptyLines(text, max) {
    const lines = [];
    for (const line of String(text || '').split(/\r?\n/)) {
        const t = line.trim();
        if (t) { lines.push(t); if (max && lines.length >= max) break; }
    }
    return lines;
}

function sampleLines(text, count, shuffle) {
    const maxCount = Math.max(1, Number(count) || 1000);
    if (!shuffle) return nonEmptyLines(text, maxCount);
    const result = [], lines = String(text || '').split(/\r?\n/);
    let totalSeen = 0;
    for (const raw of lines) {
        const line = raw.trim();
        if (!line) continue;
        totalSeen++;
        if (result.length < maxCount) result.push(line);
        else { const j = Math.floor(Math.random() * totalSeen); if (j < maxCount) result[j] = line; }
    }
    return shuffleInPlace(result);
}

function finalizeNames(names, opts, alreadyShuffled) {
    const limit = Number(opts.limit) > 0 ? Number(opts.limit) : 1000;
    const shouldShuffle = opts.shuffle === true && !alreadyShuffled;
    const seen = new Set(), result = [];
    for (const name of names) {
        const trimmed = String(name || '').trim();
        if (!trimmed || seen.has(trimmed)) continue;
        seen.add(trimmed);
        result.push(trimmed);
        if (!shouldShuffle && result.length >= limit) break;
    }
    if (shouldShuffle) shuffleInPlace(result);
    return limit > 0 ? result.slice(0, limit) : result;
}

function customPattern(pattern, count) {
    const unique = new Set(), pat = pattern || '??##_';
    let iter = 0;
    while (unique.size < count && iter < count * 50) {
        let result = '';
        for (const ch of pat) {
            if (ch === '?') result += rand(LETTERS);
            else if (ch === '#') result += rand(NUMBERS);
            else if (ch === '*') result += rand(ALNUM);
            else result += ch;
        }
        unique.add(result);
        iter++;
    }
    return [...unique];
}

function fmtNum(n) { return Number(n || 0).toLocaleString('en-US'); }

// proxy handling

function normalizeProxy(line) {
    line = (line || '').trim();
    if (!line) return null;
    if (/^(direct|none)$/i.test(line)) return null;
    if (/^[a-z0-9+.-]+:\/\//i.test(line)) return line;
    const parts = line.split(':');
    if (parts.length === 4 && /^\d+$/.test(parts[1]))
        return 'http://' + encodeURIComponent(parts[2]) + ':' + encodeURIComponent(parts[3]) + '@' + parts[0] + ':' + parts[1];
    if (parts.length === 4)
        return 'http://' + encodeURIComponent(parts[0]) + ':' + encodeURIComponent(parts[1]) + '@' + parts[2] + ':' + parts[3];
    return 'http://' + line;
}

function parseProxyList(raw, max = 50000) {
    const list = [], seen = new Set();
    for (const part of String(raw || '').split(/[\r\n,\t ]+/)) {
        if (!part) continue;
        let proxy = null;
        try { proxy = normalizeProxy(part); } catch { proxy = null; }
        if (!proxy || seen.has(proxy)) continue;
        seen.add(proxy);
        list.push(proxy);
        if (list.length >= max) break;
    }
    return list;
}

function agentFor(proxyUrl) {
    if (!proxyUrl) return null;
    if (proxyUrl.startsWith('socks')) return new SocksProxyAgent(proxyUrl);
    return new HttpsProxyAgent(proxyUrl, { rejectUnauthorized: false });
}

function requestConfig(proxyUrl, timeout, signal) {
    const agent = agentFor(proxyUrl);
    if (agent && signal) try {
        signal.addEventListener('abort', () => { try { agent.destroy(); } catch {} }, { once: true });
    } catch {}
    const cfg = {
        timeout, signal,
        httpAgent: agent || undefined,
        httpsAgent: agent || undefined,
        proxy: false,
        maxRedirects: 10,
        validateStatus: () => true,
        headers: { 'User-Agent': UA, 'Accept': '*/*' }
    };
    if (!agent) cfg.httpsAgent = new (require('https').Agent)({ rejectUnauthorized: false });
    return cfg;
}

function classifyError(err) {
    const code = (err && (err.code || '')).toLowerCase().trim();
    const msg = (err && (err.message || '') || '').toLowerCase();
    const status = err && err.response && err.response.status;
    if (msg.includes('hard-timeout') || code === 'ECONNABORTED' || msg.includes('timeout')) return 'timeout';
    if (msg.includes('maximum number of redirects') || msg.includes('redirect')) return 'redirect loop';
    if (code === 'ECONNREFUSED' || msg.includes('econnrefused')) return 'proxy refused';
    if (code === 'ECONNRESET' || msg.includes('econnreset')) return 'connection reset';
    if (code === 'ETIMEDOUT' || msg.includes('etimedout')) return 'proxy timeout';
    if (code === 'ENOTFOUND' || msg.includes('host not found') || msg.includes('eai_again')) return 'dns / host not found';
    if (code === 'EPROTO' || msg.includes('ssl') || msg.includes('tls')) return 'tls/ssl error';
    if (msg.includes('socket hang up')) return 'socket hang up';
    if (status >= 500) return 'server error ' + status;
    if (msg.includes('proxy')) return 'proxy error';
    if (msg.includes('network')) return 'network error';
    return err && err.message ? String(err.message).slice(0, 60) : 'request failed';
}

async function activeSleep(ms, shouldContinue) {
    const end = Date.now() + Math.max(0, ms);
    while (Date.now() < end) {
        if (shouldContinue && !shouldContinue()) return false;
        await sleep(Math.min(100, end - Date.now()));
    }
    return !shouldContinue || shouldContinue();
}

function pickProxy(lst, state, sticky = true, offset = 0) {
    if (!lst.length) return null;
    if (sticky) {
        for (let n = 0; n < lst.length; n++) {
            const idx = state.i % lst.length;
            state.i = (state.i + 1) % lst.length;
            const proxy = lst[idx];
            if (!state.bad || !state.bad.has(proxy)) return proxy;
        }
        return lst[state.i % lst.length];
    }
    return lst[(Math.floor(Math.random() * lst.length) + offset) % lst.length];
}

// platform check functions

function R(status, reason) { return reason ? { status, reason } : status; }

async function checkDiscord(username, proxy, timeout) {
    try {
        const cfg = requestConfig(proxy, timeout);
        cfg.headers['Content-Type'] = 'application/json';
        cfg.headers['Origin'] = 'https://discord.com';
        cfg.headers['Referer'] = 'https://discord.com/';
        const res = await axios.post(DISCORD_API, { username }, cfg);
        if (res.status === 429) return 'ratelimited';
        if (res.status !== 200) return 'invalid';
        const data = res.data;
        if (data && typeof data === 'object' && typeof data.taken === 'boolean') return data.taken ? 'taken' : 'available';
        return 'invalid';
    } catch (e) { return classifyError(e); }
}

async function checkMinecraft(username, proxy, timeout) {
    try {
        const cfg = requestConfig(proxy, timeout);
        const res = await axios.get(MC_API + encodeURIComponent(username), cfg);
        if (res.status === 204 || res.status === 404) return 'available';
        if (res.status === 200) {
            const data = res.data;
            if (data && typeof data === 'object' && data.id) return 'taken';
            return 'error';
        }
        if (res.status === 429) return 'ratelimited';
        return 'error';
    } catch (e) { return classifyError(e); }
}

async function checkGithub(username, proxy, timeout) {
    try {
        const cfg = requestConfig(proxy, timeout);
        cfg.headers['Accept'] = 'application/vnd.github+json';
        const res = await axios.get('https://api.github.com/users/' + encodeURIComponent(username), cfg);
        if (res.status === 404) return 'available';
        if (res.status === 200) {
            const data = res.data;
            if (data && typeof data === 'object' && data.login) return 'taken';
            return 'error';
        }
        if (res.status === 403) return 'ratelimited';
        return 'unknown';
    } catch (e) { return classifyError(e); }
}

async function checkRoblox(username, proxy, timeout) {
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(username) || username.startsWith('_') || username.endsWith('_') || (username.match(/_/g) || []).length > 1) return 'invalid';
    try {
        const cfg = requestConfig(proxy, timeout);
        cfg.headers['Content-Type'] = 'application/json';
        cfg.headers['Accept'] = 'application/json';
        const res = await axios.post('https://users.roblox.com/v1/usernames/users', { usernames: [username], excludeBannedUsers: false }, cfg);
        if (res.status === 429) return 'ratelimited';
        if (res.status >= 200 && res.status < 300) {
            const data = res.data;
            if (data && typeof data === 'object' && Array.isArray(data.data)) return data.data.length > 0 ? 'taken' : 'available';
            return 'error';
        }
        return 'unknown';
    } catch (e) { return classifyError(e); }
}

async function checkTiktok(username, proxy, timeout) {
    let oembedRes;
    try {
        oembedRes = await axios.get('https://www.tiktok.com/oembed?url=https://www.tiktok.com/@' + encodeURIComponent(username), {
            ...requestConfig(proxy, timeout), maxRedirects: 10,
            headers: { 'User-Agent': UA, 'Accept': 'text/html,*/*' }
        });
    } catch (e) { return R('unknown', 'oembed ' + classifyError(e)); }
    if (oembedRes.status === 429) return R('ratelimited', 'oembed 429');
    if (oembedRes.status === 404 || oembedRes.status === 400) return 'available';
    if (oembedRes.status >= 200 && oembedRes.status < 300) {
        const body = typeof oembedRes.data === 'string' ? oembedRes.data : JSON.stringify(oembedRes.data || '');
        if (/\"author_url\"|\"author_name\"|\"thumbnail_url\"/i.test(body)) return 'taken';
        if (/\"code\"\s*:\s*400|something went wrong/i.test(body)) return 'available';
    }
    let pageRes;
    try {
        pageRes = await axios.get('https://www.tiktok.com/@' + encodeURIComponent(username), {
            ...requestConfig(proxy, timeout), maxRedirects: 10,
            headers: { 'User-Agent': UA, 'Accept': 'text/html,*/*', 'Accept-Language': 'en-US,en;q=0.9' }
        });
    } catch (e) { return R('unknown', 'html ' + classifyError(e)); }
    if (pageRes.status === 429) return R('ratelimited', 'html 429');
    if (pageRes.status === 404) return 'available';
    if (pageRes.status === 403) return R('unknown', 'http 403 (blocked)');
    const body = typeof pageRes.data === 'string' ? pageRes.data : JSON.stringify(pageRes.data || '');
    const lower = body.toLowerCase();
    if (lower.includes('just a moment') || lower.includes('cf-browser-verification') || lower.includes('_cf_chl_')) return R('unknown', 'cloudflare challenge');
    if (lower.includes('"statuscode":10201') || lower.includes('"statuscode":10221') || lower.includes('"statuscode":10202')) return 'available';
    if (/"user"\s*:\s*\{[^}]*"id"\s*:\s*"\d{5,}"/i.test(body) || /"uniqueid"\s*:\s*"/i.test(lower)) return 'taken';
    return R('unknown', 'inconclusive');
}

async function checkDiscordVanity(code, proxy, timeout) {
    try {
        const cfg = requestConfig(proxy, timeout);
        cfg.headers['Accept'] = 'application/json,*/*';
        const res = await axios.get('https://discord.com/api/v1/invites/' + encodeURIComponent(code) + '?with_counts=false', cfg);
        if (res.status === 404) return 'available';
        if (res.status === 200) {
            const data = res.data;
            if (data && typeof data === 'object' && data.guild) return 'taken';
            return 'unknown';
        }
        if (res.status === 429) return 'ratelimited';
        return 'unknown';
    } catch (e) { return classifyError(e); }
}

async function checkGunsLol(username, proxy, timeout) {
    try {
        const cfg = requestConfig(proxy, timeout);
        cfg.headers['Accept'] = 'text/html,*/*';
        cfg.headers['Accept-Language'] = 'en-US,en;q=0.9';
        const res = await axios.get('https://guns.lol/' + encodeURIComponent(username), cfg);
        if (res.status === 429) return 'ratelimited';
        if (res.status === 404) return 'available';
        if (res.status >= 200 && res.status < 300) {
            const body = String(res.data || '').toLowerCase();
            if (body.includes('username not found') && body.includes('claim this username')) return 'available';
            if (body.includes("couldn't find this account") || body.includes("couldnt find this account")) return 'unknown';
            if (body.includes('uid') || body.includes('views') || body.includes('active') || body.includes('profile') || /<h[1-6]/.test(body)) return 'taken';
            return 'unknown';
        }
        return 'unknown';
    } catch (e) { return classifyError(e); }
}

async function checkOnlyfans(username, proxy, timeout) {
    try {
        const cfg = requestConfig(proxy, timeout);
        cfg.headers['Accept'] = 'text/html,*/*';
        cfg.headers['Accept-Language'] = 'en-US,en;q=0.9';
        const res = await axios.get('https://onlyfans.com/' + encodeURIComponent(username), cfg);
        if (res.status === 429) return 'ratelimited';
        if (res.status === 404) return 'available';
        if (res.status === 401 || res.status === 403) return 'unknown';
        if (res.status >= 200 && res.status < 300) {
            const body = String(res.data || '').toLowerCase();
            if (body.includes('just a moment') || body.includes('cf-browser-verification') || body.includes('_cf_chl_')) return 'unknown';
            if (body.includes("this page isn't available") || body.includes('page not found') || body.includes("this page doesn't exist")) return 'available';
            const lowerName = username.toLowerCase();
            if (body.includes('(@' + lowerName + ')') || new RegExp('"username"\\s*:\\s*"' + lowerName + '"', 'i').test(String(res.data || ''))) return 'taken';
            return 'unknown';
        }
        return 'unknown';
    } catch (e) { return classifyError(e); }
}

async function checkPage(url, proxy, timeout, opts = {}, signal) {
    try {
        const cfg = requestConfig(proxy, timeout, signal);
        cfg.headers['Accept'] = 'text/html,*/*';
        cfg.maxRedirects = 10;
        const res = await axios.get(url, cfg);
        if (res.status === 404) return 'available';
        if (res.status === 429) return 'ratelimited';
        if (res.status === 401 || res.status === 403) return 'unknown';
        if (res.status >= 300 && res.status < 400) return 'unknown';
        if (res.status >= 500) return 'unknown';
        if (res.status >= 200 && res.status < 300) {
            const body = String(res.data || '');
            const lower = body.toLowerCase();
            if (lower.includes('just a moment') || lower.includes('cf-browser-verification') || lower.includes('_cf_chl_')) return 'unknown';
            if (opts.availableIfContains && body.includes(opts.availableIfContains)) return 'available';
            if (opts.takenIfContains && body.includes(opts.takenIfContains)) return 'taken';
            if (/<html[\s>]/i.test(body) || /<!doctype/i.test(body)) return 'taken';
            return 'unknown';
        }
        return 'unknown';
    } catch (e) { return classifyError(e); }
}

async function checkSteam(username, proxy, timeout) {
    try {
        const cfg = requestConfig(proxy, timeout);
        cfg.headers['Accept'] = 'text/xml,*/*';
        const res = await axios.get('https://steamcommunity.com/id/' + encodeURIComponent(username) + '?xml=1', cfg);
        if (res.status === 429) return 'ratelimited';
        if (res.status === 404) return 'available';
        if (res.status >= 200 && res.status < 300) {
            const body = String(res.data || '').toLowerCase();
            if (body.includes('the specified profile could not be found')) return 'available';
            if (body.includes('<steamid64>') || body.includes('<steamid>')) return 'taken';
            return 'unknown';
        }
        return 'unknown';
    } catch (e) { return classifyError(e); }
}

async function checkTelegram(username, proxy, timeout) {
    try {
        const cfg = requestConfig(proxy, timeout);
        cfg.headers['Accept'] = 'text/html,*/*';
        const res = await axios.get('https://t.me/' + encodeURIComponent(username), cfg);
        if (res.status === 429) return 'ratelimited';
        if (res.status === 404) return 'available';
        if (res.status >= 200 && res.status < 300) {
            const body = String(res.data || '').toLowerCase();
            if (body.includes('tgme_page_title') || body.includes('tgme_page_photo')) return 'taken';
            if (body.includes('if you have telegram')) return 'available';
            return 'unknown';
        }
        return 'unknown';
    } catch (e) { return classifyError(e); }
}

async function checkSpotify(username, proxy, timeout) {
    try {
        const cfg = requestConfig(proxy, timeout);
        cfg.headers['Accept'] = 'text/html,*/*';
        const res = await axios.get('https://open.spotify.com/user/' + encodeURIComponent(username), cfg);
        if (res.status === 429) return 'ratelimited';
        if (res.status === 404) return 'available';
        if (res.status >= 200 && res.status < 300) {
            const body = String(res.data || '').toLowerCase();
            if (body.includes('page not found') || body.includes("couldn't find that page")) return 'available';
            if (body.includes('og:title') || body.includes('profile') || body.includes('spotify:user')) return 'taken';
            return 'unknown';
        }
        return 'unknown';
    } catch (e) { return classifyError(e); }
}

async function checkReddit(username, proxy, timeout) {
    try {
        const cfg = requestConfig(proxy, timeout);
        cfg.headers['Accept'] = 'text/html,*/*';
        const res = await axios.get('https://www.reddit.com/user/' + encodeURIComponent(username), { ...cfg, maxRedirects: 5, validateStatus: s => s < 500 });
        if (res.status === 404) return 'available';
        if (res.status === 429) return 'ratelimited';
        if (res.status >= 200 && res.status < 300) {
            const body = String(res.data || '').toLowerCase();
            if (body.includes('page not found') || (body.includes('sorry') && body.includes("doesn"))) return 'available';
            if (body.includes('karma') || body.includes('post karma') || body.includes('cake day')) return 'taken';
            return 'unknown';
        }
        return 'unknown';
    } catch (e) { return classifyError(e); }
}

async function checkTwitch(username, proxy, timeout) {
    try {
        const cfg = requestConfig(proxy, timeout);
        cfg.headers['Accept'] = 'text/html,*/*';
        const res = await axios.get('https://www.twitch.tv/' + encodeURIComponent(username), { ...cfg, maxRedirects: 10, validateStatus: () => true });
        if (res.status === 404) return 'available';
        if (res.status === 429) return 'ratelimited';
        if (res.status >= 200 && res.status < 300) {
            const body = String(res.data || '').toLowerCase();
            if (body.includes('page not found') || body.includes('does not exist') || body.includes("isn't available")) return 'available';
            if (body.includes('og:title') || body.includes('twitch.tv/' + username.toLowerCase())) return 'taken';
            return 'unknown';
        }
        return 'unknown';
    } catch (e) { return classifyError(e); }
}

async function checkPlatform(platform, username, proxy, timeout, signal) {
    const enc = encodeURIComponent(username);
    switch (platform) {
        case 'discord':    return checkDiscord(username, proxy, timeout);
        case 'minecraft':  return checkMinecraft(username, proxy, timeout);
        case 'github':     return checkGithub(username, proxy, timeout);
        case 'roblox':     return checkRoblox(username, proxy, timeout);
        case 'tiktok':     return checkTiktok(username, proxy, timeout);
        case 'vanity':     return checkDiscordVanity(username, proxy, timeout);
        case 'gunslol':    return checkGunsLol(username, proxy, timeout);
        case 'onlyfans':   return checkOnlyfans(username, proxy, timeout);
        case 'steam':      return checkSteam(username, proxy, timeout);
        case 'telegram':   return checkTelegram(username, proxy, timeout);
        case 'spotify':    return checkSpotify(username, proxy, timeout);
        case 'reddit':     return checkReddit(username, proxy, timeout);
        case 'twitch':     return checkTwitch(username, proxy, timeout);
        case 'youtube':    return checkPage('https://www.youtube.com/@' + enc, proxy, timeout, {}, signal);
        case 'pinterest':  return checkPage('https://www.pinterest.com/' + enc + '/', proxy, timeout, {}, signal);
        case 'instagram':  return checkPage('https://www.instagram.com/' + enc + '/', proxy, timeout, {}, signal);
        case 'kick':       return checkPage('https://kick.com/' + enc, proxy, timeout, {}, signal);
        case 'x':          return checkPage('https://x.com/' + enc, proxy, timeout, {}, signal);
        case 'linktree':   return checkPage('https://linktr.ee/' + enc, proxy, timeout, { availableIfContains: "The page you're looking for doesn't exist" }, signal);
        case 'snapchat':   return checkPage('https://www.snapchat.com/add/' + enc, proxy, timeout, { takenIfContains: 'tgme_page_photo' }, signal);
        case 'pornhub':    return checkPage('https://www.pornhub.com/pornstars/' + enc, proxy, timeout, { availableIfContains: 'Page Not Found' }, signal);
        default:           return 'unknown';
    }
}

// check one name with retries

const ERROR_STATUSES = new Set(['timeout','redirect loop','proxy refused','connection reset','proxy timeout','dns / host not found','tls/ssl error','socket hang up','proxy error','network error','invalid']);

async function checkOne(name, opts, proxies, cb, shouldContinue, state) {
    const sticky = opts.proxy !== false;
    const timeout = Math.max(1000, (Number(opts.timeout) || 10) * 1000);
    const retries = Math.max(0, Number(opts.retries) || 0);
    const maxRetries = retries > 0 ? Math.max(retries, 4) : 0;
    let errCount = 0, rlCount = 0;
    while (true) {
        if (!shouldContinue()) return { status: 'cancelled' };
        const proxy = pickProxy(proxies, state, sticky, errCount + rlCount);
        try {
            const result = await checkPlatform(opts.platform, name, proxy, timeout);
            const status = typeof result === 'string' ? result : result.status || 'unknown';
            const reason = typeof result === 'object' ? result.reason : undefined;
            if (status === 'ratelimited') {
                if (proxy) { state.bad.add(proxy); setTimeout(() => state.bad.delete(proxy), 10000); }
                if (rlCount < maxRetries) { rlCount++; continue; }
                return { status, proxy };
            }
            if (ERROR_STATUSES.has(status)) {
                if (proxy) { state.bad.add(proxy); setTimeout(() => state.bad.delete(proxy), 15000); }
                if (errCount < maxRetries) { errCount++; if (!await activeSleep(150 + Math.random() * 350, shouldContinue)) return { status: 'cancelled' }; continue; }
                return { status: 'error', proxy, reason: status };
            }
            return { status, proxy, reason };
        } catch (err) {
            if (proxy) { state.bad.add(proxy); setTimeout(() => state.bad.delete(proxy), 15000); }
            if (errCount >= maxRetries) return { status: 'error', error: String(err), reason: classifyError(err), proxy };
            errCount++;
            if (!await activeSleep(180 + Math.random() * 420, shouldContinue)) return { status: 'cancelled' };
        }
    }
}

// name generation

function randomWord(mode, length) {
    if (mode === 'cvcv') return Array.from({ length }, (_, i) => i % 2 === 0 ? rand(CONS) : rand(VOWELS)).join('');
    if (mode === 'cvc') return rand(CONS) + rand(VOWELS) + rand(CONS);
    if (mode === 'pronounceable') { let s = '', v = Math.random() > 0.5; for (let i = 0; i < length; i++) { s += v ? rand(VOWELS) : rand(CONS); v = !v; } return s; }
    if (mode === 'vowel_start') return rand(VOWELS) + Array.from({ length: length - 1 }, () => rand(LETTERS)).join('');
    if (mode === 'palindrome') { const half = Math.ceil(length / 2); const s = Array.from({ length: half }, () => rand(LETTERS)).join(''); return s + s.split('').reverse().join('').slice(length % 2); }
    if (mode === 'double_letter') { const s = Array.from({ length }, () => rand(LETTERS)).join(''); if (length > 1) { const pos = Math.floor(Math.random() * (length - 1)); return s.slice(0, pos) + s[pos] + s[pos] + s.slice(pos + 2); } return s; }
    if (mode === 'doubles') { const count = Math.max(1, Math.floor(length / 2)); return Array.from({ length: count }, () => { const c = Math.random() > 0.75 ? rand(NUMBERS) : rand(LETTERS); return c + c; }).join(''); }
    if (mode === 'readable') { const onset = ['b','c','d','f','g','h','j','k','l','m','n','p','r','s','t','v','w','z','br','cr','dr','fl','gr','pr','st','tr','bl','ch','sh','th']; const nucleus = ['a','e','i','o','u','ai','ea','ou','io','ei']; let s = ''; while (s.length < length) s += pick(onset) + pick(nucleus); return s.slice(0, length); }
    if (mode === 'triple_letter') { const c = rand(LETTERS); return c + c + c + Array.from({ length: length - 3 }, () => rand(LETTERS)).join(''); }
    if (mode === 'rep_letters') { let s = ''; while (s.length < length) { const c = rand(LETTERS); s += c + c; } return s.slice(0, length); }
    if (mode === 'rep_numbers') { let s = ''; while (s.length < length) { const c = rand(NUMBERS); s += c + c; } return s.slice(0, length); }
    if (mode === 'letters_numbers') { const split = Math.max(1, length - 2); return Array.from({ length: split }, () => rand(LETTERS)).join('') + Array.from({ length: length - split }, () => rand(NUMBERS)).join(''); }
    if (mode === 'numbers_letters') { const split = Math.max(1, Math.floor(length / 2)); return Array.from({ length: split }, () => rand(NUMBERS)).join('') + Array.from({ length: length - split }, () => rand(LETTERS)).join(''); }
    if (mode === 'letters_one_number') return Array.from({ length: Math.max(0, length - 1) }, () => rand(LETTERS)).join('') + rand(NUMBERS);
    if (mode === 'semi') return Array.from({ length: Math.max(0, length - 1) }, () => rand(NUMBERS)).join('') + rand(LETTERS);
    if (mode === 'leet') return pick(DICT_WORDS).split('').map(c => Math.random() > 0.5 ? (LEET[c] || c) : c).join('');
    if (mode === 'dict_word') return pick(DICT_WORDS);
    if (mode === 'dict_num') return pick(DICT_WORDS) + rand(NUMBERS) + rand(NUMBERS);
    if (mode === 'year_end') return pick(DICT_WORDS) + String(2000 + Math.floor(Math.random() * 27));
    if (mode === 'characters') return Array.from({ length }, () => rand(CHARS)).join('');
    if (mode === 'gamer') return rand(VOWELS) + '_' + Array.from({ length: Math.max(0, length - 2) }, () => rand(LETTERS)).join('') + rand(CONS);
    if (mode === 'dot_end') return Array.from({ length: Math.max(1, length - 1) }, () => rand(LETTERS)).join('.') + rand(LETTERS);
    if (mode === 'underscore_start') return '_' + Array.from({ length: Math.max(0, length - 1) }, () => rand(ALNUM)).join('');
    if (mode === 'underscore_end') return Array.from({ length: Math.max(0, length - 1) }, () => rand(ALNUM)).join('') + '_';
    return Array.from({ length }, () => rand(ALNUM)).join('');
}

function decodeCombo(index, length, chars) {
    let result = '', remaining = index;
    for (let i = 0; i < length; i++) { result += chars[remaining % chars.length]; remaining = Math.floor(remaining / chars.length); }
    return result;
}

function randomCombos(length, chars, count) {
    const total = chars.length ** length;
    const need = Math.min(count, total);
    if (total <= 50000 && need >= total * 0.5) return shuffleInPlace(Array.from({ length: total }, (_, i) => decodeCombo(i, length, chars))).slice(0, need);
    const seen = new Set(), result = [];
    let attempts = 0, maxAttempts = need * 20 + 1000;
    while (result.length < need && attempts < maxAttempts) { attempts++; const idx = Math.floor(Math.random() * total); if (seen.has(idx)) continue; seen.add(idx); result.push(decodeCombo(idx, length, chars)); }
    return result;
}

function buildNames(opts) {
    const mode = opts.mode || 'alnum';
    const length = Math.max(1, Math.min(Number(opts.length) || 4, 16));
    const count = Math.max(1, Math.min(Number(opts.count) || 1000, 1000000));
    const suffix = opts.suffix || '';
    const prefix = opts.prefix || '';
    const pattern = opts.pattern || '';
    const base = opts.base || '';

    if (mode === 'custom_pattern' && pattern) return finalizeNames(customPattern(pattern, count), opts);
    if (mode === 'wordlist' && base) return finalizeNames(sampleLines(base, count, opts.shuffle), opts, true);
    if (mode === 'numbers') return finalizeNames(randomCombos(length, NUMBERS, count), opts);
    if (mode === 'letters') return finalizeNames(randomCombos(length, LETTERS, count), opts);
    if (mode === 'alnum') return finalizeNames(randomCombos(length, ALNUM, count), opts);

    if (mode === 'underscore_pos') {
        const pos = Math.min(Math.max(0, parseInt(opts.usPos) || 0), length - 1);
        const nameSet = new Set();
        let attempts = 0, maxAttempts = count * 12 + 500;
        while (nameSet.size < count && attempts < maxAttempts) {
            attempts++;
            let name = '';
            for (let i = 0; i < length; i++) name += i === pos ? '_' : rand(ALNUM);
            if (name) nameSet.add(name);
        }
        return finalizeNames([...nameSet], opts);
    }

    if (mode === 'dot_pos') {
        const pos = Math.min(Math.max(0, parseInt(opts.dotPos) || 0), length - 1);
        const nameSet = new Set();
        let attempts = 0, maxAttempts = count * 12 + 500;
        while (nameSet.size < count && attempts < maxAttempts) {
            attempts++;
            let name = '';
            for (let i = 0; i < length; i++) name += i === pos ? '.' : rand(LETTERS);
            if (name) nameSet.add(name);
        }
        return finalizeNames([...nameSet], opts);
    }

    if (mode === 'suffix') {
        if (!suffix) return finalizeNames([], opts);
        const baseNames = randomCombos(Math.max(1, length - suffix.length), ALNUM, count * 2);
        const result = [], seen = new Set();
        for (const b of baseNames) {
            const name = b + suffix;
            if (!seen.has(name)) { seen.add(name); result.push(name); if (result.length >= count) break; }
        }
        return finalizeNames(result, opts);
    }

    if (mode === 'prefix') {
        if (!prefix) return finalizeNames([], opts);
        const tailNames = randomCombos(Math.max(1, length - prefix.length), ALNUM, count * 2);
        const result = [], seen = new Set();
        for (const t of tailNames) {
            const name = prefix + t;
            if (!seen.has(name)) { seen.add(name); result.push(name); if (result.length >= count) break; }
        }
        return finalizeNames(result, opts);
    }

    const nameSet = new Set();
    let attempts = 0, maxAttempts = count * 12 + 500;
    while (nameSet.size < count && attempts < maxAttempts) {
        attempts++;
        const name = prefix + randomWord(mode, length) + suffix;
        if (name) nameSet.add(name);
    }
    return finalizeNames([...nameSet], opts);
}

function snapshot(stats) {
    const elapsed = Math.max((Date.now() - stats.start), 0.001);
    return { ...stats, rate: stats.done / elapsed, elapsed, remaining: Math.max(0, stats.total - stats.done) };
}

// template engine

function applyVars(template, vars) {
    if (template === undefined || template === null) return template;
    let result = String(template);
    result = result.replace(/\{\?(\w+)\}([\s\S]*?)\{\/\1\}/g, (_, key, content) => vars[key] !== undefined && vars[key] !== null && vars[key] !== '' ? content : '');
    result = result.replace(/\{!(\w+)\}([\s\S]*?)\{\/\1\}/g, (_, key, content) => vars[key] === undefined || vars[key] === null || vars[key] === '' ? content : '');
    result = result.replace(/\{(\w+)\}/g, (_, key) => vars[key] !== undefined ? String(vars[key]) : '{' + key + '}');
    return result.replace(/\\n/g, '\n');
}

// webhook

function buildWebhookPayload(config, vars) {
    config = config || {};
    const payload = {};
    if (config.username) payload.username = applyVars(config.username, vars).slice(0, 80);
    if (config.avatar) payload.avatar_url = config.avatar;
    const content = applyVars(config.content || '', vars).trim();
    if (content) payload.content = content.slice(0, 2000);
    if (!payload.content) payload.content = '\u200b';
    return payload;
}

async function sendWebhook(urls, payload, timeout = 9000) {
    const urlList = String(urls || '').split(/[\s,]+/).map(s => s.trim()).filter(s => /^https?:\/\//i.test(s));
    if (!urlList.length) return false;
    const body = typeof payload === 'string' ? { content: String(payload).slice(0, 2000) } : payload;
    const results = await Promise.all(urlList.map(async url => {
        try {
            const res = await axios.post(url, body, { timeout, headers: { 'Content-Type': 'application/json', 'User-Agent': UA }, validateStatus: () => true });
            if (res.status === 429) {
                await sleep(Math.max(5000, Number(res.data && res.data.retry_after) * 1000 || 1000));
                const retry = await axios.post(url, body, { timeout, headers: { 'Content-Type': 'application/json' }, validateStatus: () => true });
                return retry.status >= 200 && retry.status < 300;
            }
            return res.status >= 200 && res.status < 300;
        } catch { return false; }
    }));
    return results.some(Boolean);
}

// main runner

let runToken = 0;

async function runCheck(opts, cb) {
    const token = ++runToken;
    const alive = () => runToken === token;
    const proxies = parseProxyList(opts.proxies, 50000);
    const state = { i: 0, bad: new Set() };
    const names = buildNames(opts);
    const concurrency = Math.max(1, Math.min(Number(opts.concurrency) || 80, 150));
    const hitGoal = Math.max(0, Number(opts.hitGoal) || 0);
    const adaptive = opts.adaptive !== false;
    const ADAPT_STEP = 300, ADAPT_MAX = 6000, ADAPT_DEC = 40;
    let adaptiveDelay = 0;
    const stats = { total: names.length, done: 0, available: 0, taken: 0, invalid: 0, unknown: 0, ratelimited: 0, errors: 0, proxies: proxies.length, hitGoal, start: Date.now() };
    if (cb.onLog) cb.onLog({ type: 'start', total: names.length, proxies: proxies.length });
    if (!names.length) { if (cb.onDone) cb.onDone({ ...stats, empty: true }); return stats; }
    let idx = 0, goalReached = false;
    async function worker() {
        while (idx < names.length && alive() && !goalReached) {
            const name = names[idx++];
            const result = await checkOne(name, opts, proxies, cb, alive, state);
            if (result.status === 'cancelled' || !alive()) break;
            stats.current = name; stats.done++;
            if (result.status === 'available') {
                stats.available++;
                if (cb.onHit) cb.onHit({ name, platform: opts.platform, mode: opts.mode, ts: Date.now() });
                if (cb.onLog) cb.onLog({ type: 'available', name, proxy: result.proxy });
                if (opts.webhookUrl) sendWebhook(opts.webhookUrl, buildWebhookPayload(opts.webhookConfig || {}, { name, platform: opts.platform, mode: opts.mode, count: stats.available, total: stats.total, time: new Date().toLocaleString() }));
                if (hitGoal > 0 && stats.available >= hitGoal) goalReached = true;
            } else if (result.status === 'taken') { stats.taken++; if (cb.onLog) cb.onLog({ type: 'taken', name, proxy: result.proxy }); }
            else if (result.status === 'ratelimited') { stats.ratelimited++; if (cb.onLog) cb.onLog({ type: 'ratelimited', name, proxy: result.proxy }); }
            else if (result.status === 'invalid') { stats.invalid++; if (cb.onLog) cb.onLog({ type: 'error', name, detail: 'invalid response', proxy: result.proxy }); }
            else { stats.errors++; if (cb.onLog) cb.onLog({ type: 'error', name, detail: result.reason || result.error || 'unknown', proxy: result.proxy }); }
            if (adaptive) { if (result.status === 'ratelimited') adaptiveDelay = Math.min(ADAPT_MAX, (adaptiveDelay + ADAPT_STEP) * 1.5); else adaptiveDelay = Math.max(0, adaptiveDelay - ADAPT_DEC); }
            if (cb.onProgress) cb.onProgress(snapshot(stats));
        }
    }
    const workers = [];
    for (let i = 0; i < Math.min(concurrency, Math.max(1, names.length)); i++) workers.push(worker());
    await Promise.all(workers);
    const final = snapshot(stats);
    if (cb.onProgress) cb.onProgress(final);
    if (cb.onDone) cb.onDone(final);
    return final;
}

// results

function saveAvailable(names, platform) {
    if (!names.length) return null;
    if (!fs.existsSync(RESULTS_DIR)) fs.mkdirSync(RESULTS_DIR, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const file = path.join(RESULTS_DIR, `available_${platform}_${ts}.txt`);
    fs.writeFileSync(file, names.join('\n') + '\n');
    return file;
}

function cleanOldResults() {
    try {
        if (!fs.existsSync(RESULTS_DIR)) return;
        const maxAge = 24 * 60 * 60 * 1000;
        const now = Date.now();
        for (const f of fs.readdirSync(RESULTS_DIR)) {
            const fp = path.join(RESULTS_DIR, f);
            const stat = fs.statSync(fp);
            if (now - stat.mtimeMs > maxAge) fs.unlinkSync(fp);
        }
    } catch {}
}

async function checkProxies(proxyList, timeout = 5000, concurrency = 100) {
    const proxies = parseProxyList(proxyList);
    if (!proxies.length) return { total: 0, alive: [], dead: [] };
    const alive = [], dead = [];
    let idx = 0;
    async function test() {
        while (idx < proxies.length) {
            const proxy = proxies[idx++];
            try {
                const agent = agentFor(proxy);
                const res = await axios.get('https://www.google.com/generate_204', {
                    timeout, proxy: false, httpAgent: agent || undefined, httpsAgent: agent || undefined,
                    validateStatus: () => true, headers: { 'User-Agent': UA }
                });
                if (res.status >= 100 && res.status < 500) alive.push(proxy); else dead.push(proxy);
            } catch { dead.push(proxy); }
        }
    }
    const workers = [];
    for (let i = 0; i < Math.min(concurrency, proxies.length); i++) workers.push(test());
    await Promise.all(workers);
    return { total: proxies.length, alive, dead };
}

// cli

const C = {
    reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
    red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
    cyan: '\x1b[36m', white: '\x1b[37m', gray: '\x1b[90m',
    brightGreen: '\x1b[92m', brightYellow: '\x1b[93m',
};
function clear() { process.stdout.write('\x1b[2J\x1b[H'); }

const GRADIENT = [
    '\x1b[38;2;0;255;65m', '\x1b[38;2;0;240;70m', '\x1b[38;2;0;225;75m',
    '\x1b[38;2;0;210;80m', '\x1b[38;2;0;195;85m', '\x1b[38;2;0;180;90m',
    '\x1b[38;2;0;165;95m', '\x1b[38;2;0;150;100m',
];

function gLine(len) {
    return Array.from({ length: len }, (_, i) => {
        const c = GRADIENT[i % GRADIENT.length];
        return `${c}─${C.reset}`;
    }).join('');
}

function gBox(lines, width) {
    const w = width || 46;
    const top = `${C.dim}┌${gLine(w)}┐${C.reset}`;
    const bot = `${C.dim}└${gLine(w)}┘${C.reset}`;
    const mid = lines.map(l => {
        const pad = w - l.replace(/\x1b\[[0-9;]*m/g, '').length;
        return `${C.dim}│${C.reset} ${l}${' '.repeat(Math.max(0, pad - 1))}${C.dim}│${C.reset}`;
    });
    return [top, ...mid, bot].join('\n');
}

const LOGO = [
    `${C.dim}  _________              .__          ________    ________ ${C.reset}`,
    `${C.dim} /   _____/ ____   _____ |__|         \\_____  \\  /  _____/ ${C.reset}`,
    `${C.dim} \\_____  \\_/ __ \\ /     \\|  |  ______  /   |   \\/   \\  ___ ${C.reset}`,
    `${C.dim} /        \\  ___/|  Y Y  \\  | /_____/ /    |    \\    \\_\\  \\ ${C.reset}`,
    `${C.dim}/_______  /\\___  >__|_|  /__|         \\_______  /\\______  / ${C.reset}`,
    `${C.dim}        \\/     \\/      \\/                     \\/        \\/  ${C.reset}`,
];

const PLATFORMS = [
    { label: 'Discord', value: 'discord' },
    { label: 'Minecraft', value: 'minecraft' },
    { label: 'GitHub', value: 'github' },
    { label: 'Roblox', value: 'roblox' },
    { label: 'TikTok', value: 'tiktok' },
    { label: 'YouTube', value: 'youtube' },
    { label: 'Instagram', value: 'instagram' },
    { label: 'X (Twitter)', value: 'x' },
    { label: 'Kick', value: 'kick' },
    { label: 'Pinterest', value: 'pinterest' },
    { label: 'Telegram', value: 'telegram' },
    { label: 'Spotify', value: 'spotify' },
    { label: 'Steam', value: 'steam' },
    { label: 'Linktree', value: 'linktree' },
    { label: 'Snapchat', value: 'snapchat' },
    { label: 'Guns.lol', value: 'gunslol' },
    { label: 'OnlyFans', value: 'onlyfans' },
    { label: 'Pornhub', value: 'pornhub' },
    { label: 'Discord Vanity', value: 'vanity' },
    { label: 'Reddit', value: 'reddit' },
    { label: 'Twitch', value: 'twitch' },
];

const MODES = [
    { label: 'Alphanumeric', value: 'alnum' },
    { label: 'Consonant-Vowel', value: 'cvcv' },
    { label: 'CVC Short', value: 'cvc' },
    { label: 'Pronounceable', value: 'pronounceable' },
    { label: 'Readable', value: 'readable' },
    { label: 'Vowel Start', value: 'vowel_start' },
    { label: 'Palindrome', value: 'palindrome' },
    { label: 'Double Letter', value: 'double_letter' },
    { label: 'Doubles', value: 'doubles' },
    { label: 'Triple Letter', value: 'triple_letter' },
    { label: 'Rep Letters', value: 'rep_letters' },
    { label: 'Rep Numbers', value: 'rep_numbers' },
    { label: 'Letters + Numbers', value: 'letters_numbers' },
    { label: 'Numbers + Letters', value: 'numbers_letters' },
    { label: 'Letters + 1 Number', value: 'letters_one_number' },
    { label: 'Semi', value: 'semi' },
    { label: 'Characters (a-z0-9_)', value: 'characters' },
    { label: 'Leet', value: 'leet' },
    { label: 'Dictionary Word', value: 'dict_word' },
    { label: 'Dictionary + Number', value: 'dict_num' },
    { label: 'Year End', value: 'year_end' },
    { label: 'Numbers Only', value: 'numbers' },
    { label: 'Letters Only', value: 'letters' },
    { label: 'Gamer Tag', value: 'gamer' },
    { label: 'Dot End', value: 'dot_end' },
    { label: 'Dot Position', value: 'dot_pos' },
    { label: 'Underscore Start', value: 'underscore_start' },
    { label: 'Underscore End', value: 'underscore_end' },
    { label: 'Underscore Position', value: 'underscore_pos' },
    { label: 'Suffix Base', value: 'suffix' },
    { label: 'Prefix Tail', value: 'prefix' },
    { label: 'Custom Pattern', value: 'custom_pattern' },
];

function prompt(q) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise(r => rl.question(`${C.cyan}?${C.reset} ${q}`, a => { rl.close(); r(a.trim()); }));
}

function stripAnsi(s) { return s.replace(/\x1b\[[0-9;]*m/g, ''); }
function visLen(s) { return stripAnsi(s).length; }
function padRight(s, len) { return s + ' '.repeat(Math.max(0, len - visLen(s))); }

async function pickVertical(title, options) {
    clear();
    const COL_WIDTH = 22;
    const lines = [`  ${C.bold}${C.brightGreen}  ${title}${C.reset}`, ''];
    const perCol = Math.ceil(options.length / 3);
    for (let row = 0; row < perCol; row++) {
        let cells = [];
        for (let col = 0; col < 3; col++) {
            const idx = col * perCol + row;
            if (idx < options.length) {
                const o = options[idx];
                const num = String(idx + 1).padStart(2);
                cells.push(`${C.green}${num}${C.reset} ${o.label}`);
            } else cells.push('');
        }
        lines.push('    ' + cells.map(c => padRight(c, COL_WIDTH)).join(''));
    }
    console.log(gBox(lines, 72));
    console.log('');
}

async function pickOption(title, options) {
    pickVertical(title, options);
    const ans = await prompt(`${C.green}>${C.reset} Pick (1-${options.length}): `);
    const idx = parseInt(ans) - 1;
    if (isNaN(idx) || idx < 0 || idx >= options.length) return null;
    return options[idx];
}

function openFolder(folder) {
    const cmd = process.platform === 'win32' ? `start "" "${folder}"` :
                process.platform === 'darwin' ? `open "${folder}"` : `xdg-open "${folder}"`;
    try { require('child_process').execSync(cmd, { stdio: 'ignore' }); } catch {}
}

async function showAvailable(names) {
    clear();
    const lines = [`  ${C.bold}${C.brightGreen}  available${C.reset}`, ''];
    if (!names.length) lines.push(`    ${C.dim}none found yet${C.reset}`);
    else {
        for (const n of names.slice(0, 50)) lines.push(`    ${C.green}+ ${n}${C.reset}`);
        if (names.length > 50) lines.push(`    ${C.dim}...and ${names.length - 50} more${C.reset}`);
    }
    lines.push('', `  ${C.dim}total: ${names.length}${C.reset}`);
    console.log(gBox(lines, 50));
    console.log('');
    await prompt(`  ${C.dim}press enter to return...${C.reset}`);
}

async function showErrors(errors) {
    clear();
    const lines = [`  ${C.bold}${C.brightYellow}  errors${C.reset}`, ''];
    if (!errors.length) lines.push(`    ${C.dim}no errors${C.reset}`);
    else {
        for (const e of errors.slice(-30)) {
            lines.push(`    ${C.dim}${e.time}${C.reset} ${C.red}${e.name || ''}${C.reset} ${C.dim}${e.msg || e.type || ''}${C.reset}`);
        }
        if (errors.length > 30) lines.push(`    ${C.dim}...${errors.length - 30} older errors${C.reset}`);
    }
    lines.push('', `  ${C.dim}total: ${errors.length}${C.reset}`);
    console.log(gBox(lines, 60));
    console.log('');
    await prompt(`  ${C.dim}press enter to return...${C.reset}`);
}

function printLogo(proxyCount) {
    clear();
    console.log('');
    for (const line of LOGO) console.log(`  ${line}`);
    console.log('');
    console.log(`  ${C.green}●${C.reset} ${proxyCount} proxies loaded`);
    console.log('');
}

function shortcutHint() {
    console.log(`  ${C.dim}[p] proxies  [t] available  [n] errors  [0] settings${C.reset}`);
    console.log('');
}

async function editSettings(settings) {
    while (true) {
        clear();
        const wh = settings.webhookUrl ? `${C.green}set${C.reset}` : `${C.red}not set${C.reset}`;
        const lines = [
            `  ${C.bold}${C.brightGreen}  settings${C.reset}`, '',
            `    ${C.green}1${C.reset}  webhook url       ${C.dim}current: ${wh}${C.reset}`,
            `    ${C.green}2${C.reset}  webhook content   ${C.dim}${settings.webhookContent || '(default)'}${C.reset}`,
            `    ${C.green}3${C.reset}  embed title       ${C.dim}${settings.webhookEmbedTitle || '(default)'}${C.reset}`,
            `    ${C.green}4${C.reset}  embed description ${C.dim}${(settings.webhookEmbedDescription || '').substring(0, 40)}...${C.reset}`,
            `    ${C.green}5${C.reset}  embed color       ${C.dim}${settings.webhookEmbedColor}${C.reset}`,
            `    ${C.green}6${C.reset}  default count     ${C.dim}${settings.count}${C.reset}`,
            `    ${C.green}7${C.reset}  default length    ${C.dim}${settings.length}${C.reset}`,
            `    ${C.green}8${C.reset}  default threads   ${C.dim}${settings.concurrency}${C.reset}`,
            `    ${C.green}9${C.reset}  default timeout   ${C.dim}${settings.timeout}s${C.reset}`,
            '', `    ${C.green}0${C.reset}  back`, '',
        ];
        console.log(gBox(lines, 62));
        console.log('');
        const choice = await prompt(`${C.green}>${C.reset} `);
        if (choice === '0' || choice === '') return settings;

        if (choice === '1') { clear(); settings.webhookUrl = (await prompt(`${C.bold}webhook url${C.reset} ${C.dim}(empty to clear)${C.reset}: `)).trim(); }
        else if (choice === '2') { clear(); const v = await prompt(`${C.bold}webhook content${C.reset} ${C.dim}vars: {name} {platform} {mode} {count} {total} {time}${C.reset}:\n> `); if (v.trim()) settings.webhookContent = v.trim(); }
        else if (choice === '3') { clear(); const v = await prompt(`${C.bold}embed title${C.reset}:\n> `); if (v.trim()) settings.webhookEmbedTitle = v.trim(); }
        else if (choice === '4') { clear(); const v = await prompt(`${C.bold}embed description${C.reset} ${C.dim}use \\n for newlines${C.reset}:\n> `); if (v.trim()) settings.webhookEmbedDescription = v.trim(); }
        else if (choice === '5') { clear(); const v = await prompt(`${C.bold}embed color${C.reset} ${C.dim}hex e.g. #00ff41${C.reset}: `); if (v.trim()) settings.webhookEmbedColor = v.trim(); }
        else if (choice === '6') { clear(); const v = parseInt(await prompt(`${C.bold}default count${C.reset}: `)); if (!isNaN(v) && v > 0) settings.count = v; }
        else if (choice === '7') { clear(); const v = parseInt(await prompt(`${C.bold}default length${C.reset}: `)); if (!isNaN(v) && v > 0) settings.length = v; }
        else if (choice === '8') { clear(); const v = parseInt(await prompt(`${C.bold}default threads${C.reset}: `)); if (!isNaN(v) && v > 0) settings.concurrency = v; }
        else if (choice === '9') { clear(); const v = parseInt(await prompt(`${C.bold}default timeout${C.reset} ${C.dim}seconds${C.reset}: `)); if (!isNaN(v) && v > 0) settings.timeout = v; }

        if (saveSettings(settings)) {
            printLogo(0);
            console.log(`  ${C.green}+ saved${C.reset}\n`);
            await prompt(`  ${C.dim}press enter...${C.reset}`);
        }
    }
}

async function main() {
    await ensureDict();
    cleanOldResults();
    let settings = loadSettings();
    let proxies = '';
    if (fs.existsSync(PROXIES_FILE)) proxies = fs.readFileSync(PROXIES_FILE, 'utf-8');
    let proxyCount = parseProxyList(proxies).length;

    const availableNames = [];
    const errorLog = [];

    while (true) {
        printLogo(proxyCount);
        shortcutHint();
        const whStatus = settings.webhookUrl ? `${C.green}on${C.reset}` : `${C.red}off${C.reset}`;
        console.log(`    ${C.green}1${C.reset}  Start Check`);
        console.log(`    ${C.green}2${C.reset}  Check Proxies`);
        console.log(`    ${C.green}3${C.reset}  Reload Proxies`);
        console.log(`    ${C.green}4${C.reset}  Exit`);
        console.log('');
        console.log(`  ${C.dim}Webhook: ${whStatus}${C.reset}`);
        console.log('');

        const action = await prompt(`${C.green}>${C.reset} `);

        if (action === '4' || action.toLowerCase() === 'q' || action.toLowerCase() === 'exit') {
            clear(); console.log(`\n  ${C.green}bye${C.reset}\n`); process.exit(0);
        }
        if (action === '0') { settings = await editSettings(settings); continue; }
        if (action === 'p' || action === 'P') { openFolder(path.dirname(PROXIES_FILE)); continue; }
        if (action === 't' || action === 'T') { await showAvailable(availableNames); continue; }
        if (action === 'n' || action === 'N') { await showErrors(errorLog); continue; }

        if (action === '3' || action.toLowerCase() === 'r') {
            if (fs.existsSync(PROXIES_FILE)) proxies = fs.readFileSync(PROXIES_FILE, 'utf-8');
            proxyCount = parseProxyList(proxies).length;
            printLogo(proxyCount);
            console.log(`  ${C.green}+ ${proxyCount} proxies loaded${C.reset}\n`);
            await prompt(`  ${C.dim}press enter...${C.reset}`);
            continue;
        }

        if (action === '2') {
            printLogo(proxyCount);
            console.log(`  ${C.bold}checking...${C.reset}\n`);
            const result = await checkProxies(proxies, 5000, 100);
            console.log(`  ${C.green}alive${C.reset} ${result.alive.length}  ${C.red}dead${C.reset} ${result.dead.length}  ${C.dim}total ${result.total}${C.reset}`);
            if (result.alive.length) {
                fs.writeFileSync(PROXIES_FILE, result.alive.join('\n') + '\n');
                proxies = result.alive.join('\n');
                proxyCount = result.alive.length;
                console.log(`  ${C.green}+ saved${C.reset}`);
            }
            console.log('');
            await prompt(`  ${C.dim}press enter...${C.reset}`);
            continue;
        }

        if (action !== '1') continue;

        const platformPick = await pickOption('Platform', PLATFORMS);
        if (!platformPick) continue;

        clear();
        const count = parseInt(await prompt(`${C.bold}Count${C.reset} ${C.dim}(default ${settings.count})${C.reset}: `)) || settings.count;
        const length = parseInt(await prompt(`${C.bold}Length${C.reset} ${C.dim}(default ${settings.length})${C.reset}: `)) || settings.length;

        const modePick = await pickOption('Mode', MODES);
        if (!modePick) continue;
        const mode = modePick.value;

        clear();
        let pattern = '', suffix = '', prefix = '', usPos = '', dotPos = '';
        if (mode === 'custom_pattern') { pattern = await prompt(`${C.bold}Pattern${C.reset} ${C.dim}(?=letter #=number *=any)${C.reset}: `); }
        if (mode === 'suffix') { suffix = await prompt(`${C.bold}Suffix${C.reset} ${C.dim}(chars appended to base)${C.reset}: `); }
        if (mode === 'prefix') { prefix = await prompt(`${C.bold}Prefix${C.reset} ${C.dim}(chars prepended to tail)${C.reset}: `); }
        if (mode === 'underscore_pos') { usPos = await prompt(`${C.bold}Underscore Position${C.reset} ${C.dim}(0-based index)${C.reset}: `); }
        if (mode === 'dot_pos') { dotPos = await prompt(`${C.bold}Dot Position${C.reset} ${C.dim}(0-based index)${C.reset}: `); }

        const concurrency = parseInt(await prompt(`${C.bold}Concurrency${C.reset} ${C.dim}(default ${settings.concurrency})${C.reset}: `)) || settings.concurrency;

        clear();
        console.log('');
        console.log(`  ${C.bold}${platformPick.label}${C.reset} check`);
        console.log(`  ${C.dim}${count} names · ${length}-char · ${mode} · ${concurrency} threads${C.reset}`);
        if (settings.webhookUrl) console.log(`  ${C.dim}webhook on${C.reset}`);
        console.log('');

        const opts = { platform: platformPick.value, count, length, mode, proxies, concurrency, timeout: settings.timeout, retries: 5, proxy: true, pattern, suffix, prefix, usPos, dotPos, webhookUrl: settings.webhookUrl };
        if (settings.webhookUrl) {
            opts.webhookConfig = { content: settings.webhookContent || '`{name}` is available on {platform}!' };
        }

        await runCheck(opts, {
            onLog(e) {
                const ts = C.dim + new Date().toLocaleTimeString() + C.reset;
                const px = e.proxy ? `${C.dim} [${e.proxy.substring(0, 25)}]${C.reset}` : '';
                if (e.type === 'available') {
                    console.log(`  ${ts}  ${C.green}${C.bold}✓ ${e.name}${C.reset} ${C.brightGreen}AVAILABLE${C.reset}${px}`);
                    availableNames.push(e.name);
                } else if (e.type === 'taken') {
                    console.log(`  ${ts}  ${C.red}✗ ${e.name}${C.reset} ${C.dim}taken${C.reset}${px}`);
                } else if (e.type === 'ratelimited') {
                    console.log(`  ${ts}  ${C.yellow}⚠ ${e.name}${C.reset} ${C.dim}rate limited${C.reset}${px}`);
                } else if (e.type !== 'start') {
                    console.log(`  ${ts}  ${C.yellow}~ ${e.name}${C.reset} ${C.yellow}trying${C.reset}${px}`);
                    errorLog.push({ time: new Date().toLocaleTimeString(), name: e.name, msg: e.detail || e.type });
                }
            },
            onDone(s) {
                console.log('');
                console.log(`  ${C.bold}done${C.reset}`);
                console.log(`  ${C.green}available${C.reset} ${C.bold}${s.available}${C.reset}  ${C.red}taken${C.reset} ${C.bold}${s.taken}${C.reset}  ${C.yellow}rl${C.reset} ${C.bold}${s.ratelimited}${C.reset}  ${C.yellow}trying${C.reset} ${C.bold}${s.errors}${C.reset}`);
                console.log(`  ${C.dim}${s.rate.toFixed(1)}/s${C.reset}`);
                console.log('');
                const savedFile = saveAvailable(availableNames.filter(n => !availableNames._saved?.has(n)), platformPick.value);
                if (savedFile) console.log(`  ${C.green}+ saved ${C.dim}${savedFile}${C.reset}`);
                console.log('');
            }
        });

        await prompt(`  ${C.dim}Press Enter to return to menu...${C.reset}`);
    }
}

main();
