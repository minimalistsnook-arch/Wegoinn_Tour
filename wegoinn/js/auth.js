import { supabase } from "./supabase.js";
import { uploadImage } from "./image-upload.js";

const NICKNAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,19}$/;

export function validateNickname(nickname) {
  return NICKNAME_PATTERN.test(nickname);
}

/**
 * Checks a reservation number before a guest may enter.
 * Prototype: any non-empty value passes.
 */
export async function verifyReservationNumber(reservationNumber) {
  // TODO: Connect reservation verification API
  // The real check must ALSO run on the server (Edge Function / register_guest),
  // because anything in the browser can be bypassed.
  return reservationNumber.trim().length > 0;
}

/**
 * Anonymous sign-in → links the anonymous auth user to a guest profile.
 * `reservation` is the booker's name or reservation number (not verified).
 * `avatarFile` is an optional, already-compressed face photo (compressAvatar()).
 */
export async function signInGuest(reservationNumber, nickname, avatarFile = null) {
  const reservation = reservationNumber.trim();
  const name = nickname.trim();

  if (!reservation || !name) throw new Error("Please enter the reservation name or number and a nickname.");
  if (!validateNickname(name)) throw new Error("Nickname: English letters, numbers, space, . _ - (max 20).");
  if (!(await verifyReservationNumber(reservation))) throw new Error("We couldn't verify that reservation number.");

  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    const { error } = await supabase.auth.signInAnonymously();
    if (error) throw error;
  }

  const { data, error } = await supabase
    .rpc("register_guest", { p_reservation_number: reservation, p_nickname: name })
    .single();
  if (error) throw error;

  // Upload needs the profile to exist (storage policy), so it runs after register_guest.
  let avatarUrl = await getMyAvatarUrl(data.id);
  if (avatarFile) {
    avatarUrl = await uploadImage(avatarFile);
    const { error: avatarError } = await supabase.rpc("set_my_avatar", { p_avatar_url: avatarUrl });
    if (avatarError) throw avatarError;
  }
  logGuestCheckIn(reservation, avatarUrl);
  return { ...data, avatar_url: avatarUrl }; // { id, nickname, role, avatar_url }
}

/** Sends the check-in to the staff Google Sheet. Failures never block entry. */
async function logGuestCheckIn(reservation, avatarUrl) {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const response = await fetch("/api/guest-log", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token ?? ""}` },
      body: JSON.stringify({ reservation, avatarUrl: avatarUrl ?? "" }),
    });
    if (!response.ok) console.warn("[guest-log]", response.status);
  } catch (err) {
    console.warn("[guest-log]", err);
  }
}

async function getMyAvatarUrl(profileId) {
  const { data } = await supabase.from("profiles").select("avatar_url").eq("id", profileId).maybeSingle();
  return data?.avatar_url ?? null;
}

/** Current user's profile from the database (role and photo included), or null. */
export async function getMyProfile() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;
  const { data, error } = await supabase.rpc("get_my_profile").maybeSingle();
  if (error) throw error;
  return data && { ...data, avatar_url: await getMyAvatarUrl(data.id) };
}
