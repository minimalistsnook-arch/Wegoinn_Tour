-- Room "000" is for staff: they log in exactly like guests (dates, room 000, nickname, photo)
-- and get an ordinary guest account — not an operator (role stays 'guest').
-- Capacity is high so several staff can share the same dates.
insert into public.hostel_rooms (room_number, room_type, capacity) values ('000', 'Staff', 100)
on conflict (room_number) do update set room_type = excluded.room_type, capacity = excluded.capacity;
