import { supabase } from "./supabase.js";
import { uploadImage } from "./image-upload.js";

export function validateNickname(nickname) {
  return typeof nickname === "string" && nickname.trim().length >= 1 && nickname.trim().length <= 20;
}

export function normalizeStayDate(value) {
  const raw = value.trim();
  if (raw === "999222") return raw;
  const match = /^(\d{2}|\d{4})[-./](\d{1,2})[-./](\d{1,2})$/.exec(raw);
  if (!match) throw new Error("날짜를 YYYY-MM-DD 또는 YY.MM.DD 형식으로 입력하세요.");
  const year = match[1].length === 2 ? 2000 + Number(match[1]) : Number(match[1]);
  const month = Number(match[2]), day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) throw new Error("올바른 날짜를 입력하세요.");
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export async function signInGuest(checkIn, checkOut, roomNumber, nickname, avatarFile = null) {
  const arrival = normalizeStayDate(checkIn), departure = normalizeStayDate(checkOut);
  const name = nickname.trim();
  const admin = arrival === "999222" && departure === "999222";
  if (!validateNickname(name)) throw new Error("닉네임은 1~20자로 입력하세요.");
  if (!admin && (!roomNumber.trim() || departure <= arrival || arrival === "999222" || departure === "999222")) throw new Error("객실 번호와 올바른 숙박 기간을 입력하세요.");
  const { data: { session } } = await supabase.auth.getSession();
  if (session) await supabase.auth.signOut({ scope: "local" });
  {
    const { error } = await supabase.auth.signInAnonymously();
    if (error) throw error;
  }

  const { data, error } = await supabase
    .rpc("register_stay_guest", { p_check_in: arrival, p_check_out: departure, p_room_number: roomNumber.trim(), p_nickname: name })
    .single();
  if (error) throw error;

  // Upload needs the profile to exist (storage policy), so it runs after register_stay_guest.
  let avatarUrl = await getMyAvatarUrl(data.id);
  if (avatarFile) {
    avatarUrl = await uploadImage(avatarFile);
    const { error: avatarError } = await supabase.rpc("set_my_avatar", { p_avatar_url: avatarUrl });
    if (avatarError) throw avatarError;
  }
  await logGuestCheckIn(avatarUrl);
  return { ...data, avatar_url: avatarUrl }; // { id, nickname, role, avatar_url }
}

/** Sends the check-in to the staff Google Sheet. Failures never block entry. */
async function logGuestCheckIn(avatarUrl) {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const response = await fetch("/api/guest-log", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token ?? ""}` },
      body: JSON.stringify({ avatarUrl: avatarUrl ?? "" }),
    });
    if (!response.ok) {
      const result = await response.json().catch(() => null);
      console.warn("[guest-log]", response.status, result?.reason || result?.error || "Unknown error");
    }
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
