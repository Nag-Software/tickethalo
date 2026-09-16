-- The artist video is a showcase link, not necessarily a YouTube link.
-- Keep other social links unchanged and remove the misleading legacy key.
update public.artists
set social_links = (social_links - 'youtube') || case
  when social_links ? 'showcase' then '{}'::jsonb
  else jsonb_build_object('showcase', social_links -> 'youtube')
end
where social_links ? 'youtube';