/**
 * Thin GitHub Contents API client.
 *
 * Only ever talks to api.github.com, and only about the one file that holds the
 * coffee list. The token is supplied by the caller on every request; this module
 * never reads or writes storage itself.
 */

const API = 'https://api.github.com';

/* ------------------------------------------------------------------ base64 */
/* A bare btoa() throws on any character above U+00FF, and flavour notes are full
   of them ("Café", "jalapeño", "piña"). Round-trip through UTF-8 bytes instead. */

export function encodeUtf8Base64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  // Chunked so a large list can't blow the argument limit on String.fromCharCode.
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export function decodeUtf8Base64(b64) {
  // The API wraps its base64 at 60 chars; atob rejects the newlines.
  const binary = atob(b64.replace(/\s/g, ''));
  const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/* ------------------------------------------------------------------ errors */

export class GitHubError extends Error {
  constructor(message, { status = 0, kind = 'unknown' } = {}) {
    super(message);
    this.name = 'GitHubError';
    this.status = status;
    this.kind = kind;          // 'auth' | 'notfound' | 'conflict' | 'ratelimit' | 'network' | 'unknown'
  }
}

function describe(status, body) {
  const detail = body && body.message ? body.message : '';
  switch (status) {
    case 401:
      return new GitHubError('Token expired or invalid — update it in Settings.', { status, kind: 'auth' });
    case 403:
      if (/rate limit/i.test(detail)) {
        return new GitHubError('GitHub rate limit reached. Try again in a few minutes.', { status, kind: 'ratelimit' });
      }
      return new GitHubError(
        'Token lacks permission. It needs "Contents: Read and write" on this repository.',
        { status, kind: 'auth' });
    case 404:
      return new GitHubError(
        'Repository or file not found. Check the owner/repo in Settings, and that the token can see it.',
        { status, kind: 'notfound' });
    case 409:
    case 422:
      return new GitHubError('The file changed on GitHub since it was loaded.', { status, kind: 'conflict' });
    default:
      return new GitHubError(detail || `GitHub returned ${status}.`, { status });
  }
}

async function request(path, { token, method = 'GET', body } = {}) {
  const headers = {
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (body) headers['Content-Type'] = 'application/json';

  let res;
  try {
    res = await fetch(API + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  } catch {
    throw new GitHubError('Could not reach GitHub. Check your connection.', { kind: 'network' });
  }

  let payload = null;
  try { payload = await res.json(); } catch { /* 204s and empty bodies are fine */ }

  if (!res.ok) throw describe(res.status, payload);
  return payload;
}

/* ------------------------------------------------------------------ repo id */

/** Accepts "owner/repo" or a full github.com URL; returns {owner, repo}. */
export function parseRepo(input) {
  const cleaned = String(input || '')
    .trim()
    .replace(/^https?:\/\/(www\.)?github\.com\//i, '')
    .replace(/\.git$/i, '')
    .replace(/^\/+|\/+$/g, '');
  const match = /^([\w.-]+)\/([\w.-]+)$/.exec(cleaned);
  if (!match) return null;
  return { owner: match[1], repo: match[2] };
}

/* ------------------------------------------------------------------ files */

/**
 * Read the file. Returns {text, sha} or {text: null, sha: null} when the file
 * does not exist yet — an empty repo is a normal first-run state, not an error.
 */
export async function getFile({ owner, repo, path, token, ref }) {
  const query = ref ? `?ref=${encodeURIComponent(ref)}` : '';
  try {
    const data = await request(`/repos/${owner}/${repo}/contents/${path}${query}`, { token });
    if (Array.isArray(data)) throw new GitHubError(`${path} is a directory, not a file.`, { status: 200 });
    return { text: decodeUtf8Base64(data.content || ''), sha: data.sha };
  } catch (err) {
    if (err instanceof GitHubError && err.kind === 'notfound') return { text: null, sha: null };
    throw err;
  }
}

/** Create or update the file. Pass the sha you last read to detect clobbering. */
export async function putFile({ owner, repo, path, token, text, sha, message }) {
  const body = { message, content: encodeUtf8Base64(text) };
  if (sha) body.sha = sha;
  const data = await request(`/repos/${owner}/${repo}/contents/${path}`, { token, method: 'PUT', body });
  return { sha: data.content.sha, commit: data.commit && data.commit.sha };
}

/**
 * Read-only probe used by the Settings "Test connection" button, so a bad token
 * or repo name surfaces immediately rather than at the first attempted save.
 */
export async function testAccess({ owner, repo, path, token }) {
  const meta = await request(`/repos/${owner}/${repo}`, { token });
  if (!meta.permissions || !meta.permissions.push) {
    throw new GitHubError(
      'This token can read the repository but not write to it. Grant "Contents: Read and write".',
      { status: 403, kind: 'auth' });
  }
  const file = await getFile({ owner, repo, path, token });
  return { fileExists: file.sha !== null, private: !!meta.private, fullName: meta.full_name };
}
