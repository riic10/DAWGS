// "Sign in with Hugging Face" from the browser (OAuth with PKCE, no backend).
// A signed-in user's generations count against their own ZeroGPU quota
// (2 min/day signed out, 5 min free account, 40 min PRO) instead of the
// shared anonymous one.
//
// Setup: create an OAuth app at https://huggingface.co/settings/applications/new
// *without* a client secret, scopes "openid profile", redirect URIs
// http://localhost/ (covers every dev port) plus your deployed URL. Its client
// ID is public, so it's fine in frontend code: put it in web/.env.local as
// VITE_HF_OAUTH_CLIENT_ID=... (or straight into clientId below).
import { oauthHandleRedirectIfPresent, oauthLoginUrl } from "@huggingface/hub";

export const HF_AUTH = {
  clientId: import.meta.env.VITE_HF_OAUTH_CLIENT_ID ?? "",
  // Least privilege: the token is sent to the TRELLIS Space with each call,
  // so it should only be able to identify the user.
  scopes: "openid profile",
  storageKey: "snoopygs.hf-session",
};

function readStored() {
  try {
    const s = JSON.parse(localStorage.getItem(HF_AUTH.storageKey) ?? "null");
    return s && s.accessToken && s.expiresAt > Date.now() ? s : null;
  } catch {
    return null;
  }
}

function writeStored(session) {
  try {
    if (session) localStorage.setItem(HF_AUTH.storageKey, JSON.stringify(session));
    else localStorage.removeItem(HF_AUTH.storageKey);
  } catch {
    // Storage blocked (private mode): the session lasts until reload.
  }
}

// Returns { configured, user, token, ready, signIn(state), signOut(), onChange(fn) }.
// `ready` resolves after a sign-in redirect (if any) is handled, with the
// `state` passed to signIn() or null; it never rejects.
export function createHfAuth() {
  let session = readStored();
  let error = null;
  const listeners = new Set();
  const notify = () => listeners.forEach((fn) => fn());

  function setSession(next) {
    session = next;
    writeStored(next);
    notify();
  }

  const ready = (async () => {
    const params = new URLSearchParams(location.search);
    if (!params.has("code") && !params.has("error")) return null;
    try {
      if (params.has("error")) {
        throw new Error(params.get("error_description") ?? params.get("error"));
      }
      const result = await oauthHandleRedirectIfPresent();
      if (!result) return null;
      const u = result.userInfo;
      setSession({
        accessToken: result.accessToken,
        expiresAt: new Date(result.accessTokenExpiresAt).getTime(),
        user: { username: u.preferred_username, name: u.name, avatar: u.picture, isPro: Boolean(u.isPro) },
      });
      return result.state ? JSON.parse(result.state) : null;
    } catch (err) {
      console.error("Hugging Face sign-in failed:", err);
      error = err.message ?? String(err);
      notify();
      return null;
    } finally {
      // Drop ?code=…&state=… so a reload doesn't try to reuse them.
      history.replaceState(null, "", location.pathname);
    }
  })();

  const auth = {
    configured: Boolean(HF_AUTH.clientId),
    get user() { return auth.token ? session.user : null; },
    // The access token, or null when signed out or expired.
    get token() {
      if (session && session.expiresAt <= Date.now()) setSession(null);
      return session?.accessToken ?? null;
    },
    // Last sign-in error, cleared on read.
    takeError() { const e = error; error = null; return e; },
    ready,
    // Leaves the page for huggingface.co and comes back to this one.
    // `state` (JSON-able) is handed back through `ready`.
    async signIn(state = null) {
      if (!HF_AUTH.clientId) throw new Error("Sign-in isn't set up: VITE_HF_OAUTH_CLIENT_ID is missing.");
      location.href = await oauthLoginUrl({
        clientId: HF_AUTH.clientId,
        scopes: HF_AUTH.scopes,
        redirectUrl: `${location.origin}${location.pathname}`,
        state: state ? JSON.stringify(state) : undefined,
      });
    },
    signOut() { setSession(null); },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
  return auth;
}
