/*
 * Runtime configuration — read once at boot, before the app bundle runs.
 *
 * This file is copied verbatim into `dist/`, so a built frontend can be
 * repointed without a rebuild.
 *
 *   apiBaseUrl: ''                         -> same origin, /api/fava/...
 *   apiBaseUrl: 'http://127.0.0.1:5188'    -> that origin's /api/fava/...
 *   slug: ''                               -> probe "beancount", then Fava's redirect
 *   slug: 'beancount'                      -> use this ledger and skip discovery
 *
 * The API origin must allow this page via the reverse proxy. Do not point
 * apiBaseUrl at a Fava port that is reachable from the public internet.
 */
window.__APP_CONFIG__ = {
  apiBaseUrl: '',
  slug: '',
}
