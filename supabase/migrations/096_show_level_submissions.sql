-- ============================================================
-- Migrasjon 096: søknad per kveld, ikke per plass
--
-- Komikerne søkte på hver lineup-plass for seg. Med åtte plasser på en
-- kveld søkte de fleste på alle åtte for sikkerhets skyld, og klubben fikk
-- 93 søknader fra 17 komikere. Nå søker komikeren én gang per show, og
-- klubben velger plassen når den godkjenner (prosjektleder, 2026-11-15).
--
--  - `show_requirement_id` er valgfri. Den er null mens søknaden venter, og
--    settes til plassen bookeren valgte når søknaden godkjennes.
--  - Én søknad per komiker per show i stedet for per plass.
--  - Rader som fantes fra før slås sammen til én per komiker og show:
--    den mest avgjorte vinner (godtatt > ventende > avslått > trukket),
--    eldste først. Den sammenslåtte søknaden får den eldste
--    søknadstiden, så plassen i køen ikke går tapt, og tar med notatet og
--    invitasjonen om en av de andre radene hadde dem.
-- ============================================================

with ranked as (
  select
    id,
    show_id,
    artist_id,
    row_number() over (
      partition by show_id, artist_id
      order by
        case status
          when 'accepted' then 0
          when 'shortlisted' then 1
          when 'pending' then 2
          when 'declined' then 3
          else 4
        end,
        created_at
    ) as rank
  from show_submissions
),
merged as (
  select
    show_id,
    artist_id,
    min(created_at) as first_created_at,
    (array_agg(message order by created_at) filter (where message is not null))[1] as first_message,
    (array_agg(invitation_id order by created_at) filter (where invitation_id is not null))[1] as first_invitation_id
  from show_submissions
  group by show_id, artist_id
  having count(*) > 1
)
update show_submissions s
set
  created_at = m.first_created_at,
  message = coalesce(s.message, m.first_message),
  invitation_id = coalesce(s.invitation_id, m.first_invitation_id),
  source = case when coalesce(s.invitation_id, m.first_invitation_id) is not null then 'invitation' else s.source end
from ranked r
join merged m on m.show_id = r.show_id and m.artist_id = r.artist_id
where s.id = r.id
  and r.rank = 1;

delete from show_submissions s
using (
  select
    id,
    row_number() over (
      partition by show_id, artist_id
      order by
        case status
          when 'accepted' then 0
          when 'shortlisted' then 1
          when 'pending' then 2
          when 'declined' then 3
          else 4
        end,
        created_at
    ) as rank
  from show_submissions
) r
where s.id = r.id
  and r.rank > 1;

alter table show_submissions
  alter column show_requirement_id drop not null;

-- Bare en godtatt søknad har en plass. De andre gjaldt én av plassene
-- komikeren tilfeldigvis trykket på, og den betyr ikke noe lenger.
update show_submissions
set show_requirement_id = null
where status <> 'accepted';

-- Slettes plassen, står søknaden fortsatt på showet.
alter table show_submissions
  drop constraint if exists show_submissions_show_requirement_id_fkey;
alter table show_submissions
  add constraint show_submissions_show_requirement_id_fkey
  foreign key (show_requirement_id) references show_requirements(id) on delete set null;

alter table show_submissions
  drop constraint if exists show_submissions_show_requirement_id_artist_id_key;
alter table show_submissions
  add constraint show_submissions_show_id_artist_id_key unique (show_id, artist_id);

comment on column show_submissions.show_requirement_id is
  'Plassen bookeren ga komikeren da søknaden ble godtatt. Null så lenge '
  'søknaden venter — komikeren søker på showet, klubben velger plassen.';

comment on table show_submissions is
  'Komikeren har søkt på et show med åpne lineup-plasser. Én søknad per '
  'komiker per show. Ikke bindende for noen: bookeren godtar, velger '
  'plassen, og da går et vanlig booking_offer ut.';
