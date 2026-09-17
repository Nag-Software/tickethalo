-- Add poster_mode to shows
-- 'framed'        = apply lineup text/images onto a template design (current behaviour)
-- 'ai_generated'  = generate a fully new image with AI (no server-side image editing)

alter table shows
  add column if not exists poster_mode text not null default 'ai_generated'
    check (poster_mode in ('framed', 'ai_generated'));
