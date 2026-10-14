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

async function loginStep(stage, run) {
  try {
    const result = await run();
    if (result?.error) throw result.error;
    return result;
  } catch (cause) {
    const error = new Error(cause?.message || String(cause));
    error.code = cause?.code;
    error.status = cause?.status;
    error.loginStage = stage;
    throw error;
  }
}

export async function signInGuest(checkIn, checkOut, roomNumber, nickname, avatarFile = null) {
  let arrival, departure;
  try { arrival = normalizeStayDate(checkIn); } catch (error) { throw new Error(`체크인 날짜: ${error.message}`); }
  try { departure = normalizeStayDate(checkOut); } catch (error) { throw new Error(`체크아웃 날짜: ${error.message}`); }
  const name = nickname.trim();
  const admin = arrival === "999222" && departure === "999222";
  if (!validateNickname(name)) throw new Error("닉네임은 1~20자로 입력하세요.");
  if (!admin && (arrival === "999222" || departure === "999222")) throw new Error("운영자 로그인은 체크인과 체크아웃 날짜에 모두 999222를 입력해야 합니다.");
  if (!admin && !roomNumber.trim()) throw new Error("객실 번호를 입력하세요.");
  if (!admin && departure <= arrival) throw new Error("체크아웃 날짜는 체크인 날짜보다 이후여야 합니다.");
  // Every guest needs a profile photo; checked before any server call so no photo-less account is created.
  if (!admin && !avatarFile) throw new Error(PHOTO_REQUIRED_MESSAGE);
  const sessionResult = await loginStep("session", () => supabase.auth.getSession());
  const session = sessionResult.data.session;
  if (session) await loginStep("session", () => supabase.auth.signOut({ scope: "local" }));
  await loginStep("auth", () => supabase.auth.signInAnonymously());

  const { data } = await loginStep("profile", () => supabase
    .rpc("register_stay_guest", { p_check_in: arrival, p_check_out: departure, p_room_number: roomNumber.trim(), p_nickname: name })
    .single());

  // Upload needs the profile to exist (storage policy), so it runs after register_stay_guest.
  let avatarUrl = await getMyAvatarUrl(data.id);
  if (avatarFile) {
    avatarUrl = await loginStep("avatar", () => uploadImage(avatarFile));
    await loginStep("avatar", () => supabase.rpc("set_my_avatar", { p_avatar_url: avatarUrl }));
  }
  // Staff may already have checked this guest out in the Guest Log sheet (column M = "x").
  if ((await checkStayStatus())?.active === false) {
    await supabase.auth.signOut({ scope: "local" });
    throw new Error(CHECKED_OUT_MESSAGE);
  }
  await logGuestCheckIn(avatarUrl);
  return { ...data, avatar_url: avatarUrl }; // { id, nickname, role, avatar_url }
}

export const PHOTO_REQUIRED_MESSAGE = "프로필 사진을 추가해 주세요. 아무 사진이나 괜찮습니다.";
export const CHECKED_OUT_MESSAGE = "체크아웃 처리된 손님은 다시 로그인할 수 없습니다.";

/**
 * Asks the server whether the stay is still active (check-out date not passed, not marked "x" in the
 * Guest Log sheet). Returns { active } or null when the check itself is unavailable.
 */
export async function checkStayStatus() {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return null;
    const response = await fetch("/api/stay-status", {
      method: "POST",
      headers: { Authorization: `Bearer ${session.access_token}` },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) return null;
    const result = await response.json().catch(() => null);
    return typeof result?.active === "boolean" ? result : null;
  } catch {
    return null;
  }
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
