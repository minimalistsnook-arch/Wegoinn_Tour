// Public configuration only.
// Publishable and anon keys are designed to be public — security comes from RLS.
// NEVER put the service_role key in this file or anywhere in the browser.
export const CONFIG = {
  SUPABASE_URL: "https://rnhnbuwbivqqqwngelid.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_cV5RQIOW0dpzJ5JBBHo0UQ_nuv0eKfP",  // Publishable or anon public key

  // Endpoint (e.g. a Cloudflare Worker) that receives the compressed image
  // and returns { url }. Leave empty until R2 is connected.
  R2_UPLOAD_ENDPOINT: "",

  // Endpoint that receives { text, target } and returns { translatedText }.
  // Leave empty until a translation API is connected.
  TRANSLATION_ENDPOINT: "",

  HOSTEL_TIME_ZONE: "Asia/Seoul",
};

export const isSupabaseConfigured = () =>
  Boolean(CONFIG.SUPABASE_URL && CONFIG.SUPABASE_ANON_KEY);
