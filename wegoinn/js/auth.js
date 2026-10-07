import { supabase } from "./supabase.js";

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
 * The reservation number goes straight to the database and is not kept in memory.
 */
export async function signInGuest(reservationNumber, nickname) {
  const reservation = reservationNumber.trim();
  const name = nickname.trim();

  if (!reservation || !name) throw new Error("Please enter your reservation number and nickname.");
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
  return data; // { id, nickname, role }
}

/** Current user's profile from the database (role included), or null. */
export async function getMyProfile() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;
  const { data, error } = await supabase.rpc("get_my_profile").maybeSingle();
  if (error) throw error;
  return data;
}
