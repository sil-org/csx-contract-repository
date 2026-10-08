-- Scales the people pickers (run after 01; safe to re-run).
--
-- The shared project has thousands of profiles (license-manager imports staff), and
-- Supabase caps each request at a fixed number of rows, so "load everyone" silently
-- drops people. Instead:
--   * contract_admin_users()      -> only people who HAVE a contract role (a short list)
--   * contract_search_profiles()  -> server-side search for people to ADD (capped, admin only)
--   * contract_directory()        -> only people the app actually needs to show by name:
--                                    role holders, plus anyone referenced by a contract,
--                                    document, decision, access grant or audit entry.

create index if not exists contract_audit_log_profile_idx on contract_audit_log (profile_id);

create or replace function contract_admin_users()
returns table (profile_id uuid, display_name text, primary_email text, role contract_role)
language sql stable security definer set search_path = public as $$
  select p.id, p.display_name, p.primary_email, r.role
  from contract_roles r
  join profiles p on p.id = r.profile_id
  where contract_is_admin()
  order by p.display_name
$$;

-- People WITHOUT a contract role matching the text (name or email), for an admin to add.
-- LIKE wildcards in the query are escaped: staff addresses like scott_kohler@sil.org contain
-- "_", which would otherwise match any single character.
create or replace function contract_search_profiles(p_query text, p_limit int default 25)
returns table (profile_id uuid, display_name text, primary_email text)
language sql stable security definer set search_path = public as $$
  with q as (
    select '%' || replace(replace(replace(btrim(coalesce(p_query, '')), '\', '\\'), '%', '\%'), '_', '\_') || '%' as pat,
           length(btrim(coalesce(p_query, ''))) as len
  )
  select p.id, p.display_name, p.primary_email
  from profiles p, q
  where contract_is_admin()
    and q.len >= 2
    and not exists (select 1 from contract_roles r where r.profile_id = p.id)
    and (p.display_name ilike q.pat escape '\' or p.primary_email ilike q.pat escape '\')
  order by p.display_name, p.primary_email
  limit least(greatest(coalesce(p_limit, 25), 1), 50)
$$;

create or replace function contract_directory()
returns table (id uuid, display_name text, primary_email text)
language sql stable security definer set search_path = public as $$
  select p.id, p.display_name, p.primary_email
  from profiles p
  where contract_current_role() is not null
    and p.id in (
      select profile_id from contract_roles
      union select owner_id from contracts
      union select backup_owner_id from contracts where backup_owner_id is not null
      union select created_by from contracts where created_by is not null
      union select uploaded_by from contract_documents where uploaded_by is not null
      union select decided_by from contract_decisions where decided_by is not null
      union select profile_id from contract_access
      union select profile_id from contract_audit_log where profile_id is not null
    )
  order by p.display_name
$$;
