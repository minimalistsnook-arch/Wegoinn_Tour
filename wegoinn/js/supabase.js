import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { CONFIG, isSupabaseConfigured } from "./config.js";

// Guest and admin pages keep separate sessions so an admin login never
// replaces a guest's anonymous session in the same browser (and vice versa).
const storageKey = document.body.dataset.app === "admin" ? "wegoinn-admin-auth" : "wegoinn-guest-auth";

export const supabase = isSupabaseConfigured()
  ? createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, {
      auth: { storageKey, persistSession: true, autoRefreshToken: true },
    })
  : null;

// Turns a Supabase/PostgREST error into a short, human message.
export function errorMessage(error, fallback = "Something went wrong. Please try again.") {
  if (!error) return fallback;
  const msg = String(error.message || error);
  if (/SLOW_DOWN/.test(msg)) return "You're sending messages too fast. Please wait a moment.";
  if (/FULL/.test(msg)) return "This community is already full.";
  if (/duplicate key|unique/i.test(msg)) return "You already sent a request.";
  if (/row-level security|permission denied|42501/i.test(msg)) return "You don't have permission to do that.";
  if (/nickname_check/.test(msg)) return "Please use English letters or numbers for your nickname.";
  if (/past/.test(msg)) return "Please choose today or a future date.";
  return msg.length < 120 ? msg : fallback;
}
