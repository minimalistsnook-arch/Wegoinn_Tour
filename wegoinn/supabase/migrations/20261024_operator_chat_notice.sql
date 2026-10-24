-- Operator messages in chat are shown as notices (bold red with a megaphone),
-- so every guest needs to know whether a message's author is an operator.
-- profiles.role is only 'admin' or 'guest'; it reveals nothing else about the account.
grant select (role) on public.profiles to authenticated;

notify pgrst, 'reload schema';
