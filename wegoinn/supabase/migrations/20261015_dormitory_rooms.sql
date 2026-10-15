-- Dormitory rooms 806 and 807 (up to 6 guests each).
insert into public.hostel_rooms values
('806','Dormitory',6),
('807','Dormitory',6)
on conflict(room_number) do update set room_type=excluded.room_type, capacity=excluded.capacity;
