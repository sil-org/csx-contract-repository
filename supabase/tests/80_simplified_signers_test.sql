-- Tests for 11_simplified_signers.sql: no department / department manager, two-party signers.
begin;

create function t_eq(label text, got anyelement, want anyelement) returns void language plpgsql as $$
begin
  if got is distinct from want then
    raise exception 'FAIL [%]: got %, want %', label, got, want;
  end if;
  raise notice 'ok   %', label;
end $$;

insert into profiles (id, display_name, primary_email) values
  ('00000000-0000-0000-0000-00000000f1a1', 'Olive Owner', 'owner@sil.org');
insert into contract_counterparties (id, name) values ('00000000-0000-0000-0000-00000000f1c1', 'Acme Ltd');

-- A contract can be created with no department at all, and with the other party's signer + date.
\set c1 '00000000-0000-0000-0000-00000000f1d1'
insert into contracts (id, title, type_id, counterparty_id, owner_id, signatory_name, signatory_email, signed_date,
                       counterparty_signer_name, counterparty_signed_date)
values (:'c1', 'No department', (select id from contract_types where form_kind = 'vendor' limit 1),
        '00000000-0000-0000-0000-00000000f1c1', '00000000-0000-0000-0000-00000000f1a1',
        'Jo Signer', 'jo@sil.org', date '2025-01-02', 'Vee Vendor', date '2025-01-04');
select t_eq('department is optional', (select department from contracts where id = :'c1'), null::text);
select t_eq('other party signer + signed date round-trip',
  (select (counterparty_signer_name, counterparty_signed_date) from contracts where id = :'c1')::text, '("Vee Vendor",2025-01-04)');

-- Missing-data check: asks for the other party's signer/date, never for a department manager.
\set c2 '00000000-0000-0000-0000-00000000f1d2'
insert into contracts (id, title, type_id, counterparty_id, owner_id)
values (:'c2', 'Empty', (select id from contract_types where form_kind = 'vendor' limit 1),
        '00000000-0000-0000-0000-00000000f1c1', '00000000-0000-0000-0000-00000000f1a1');
select t_eq('asks for the other party signer + signed date, SIL signed date',
  (select contract_missing_attrs(c) @> array['Other party signer', 'Other party signed date', 'SIL signed date', 'SIL signer', 'SIL signer email'] from contracts c where id = :'c2'), true);
select t_eq('no longer asks for a department manager',
  (select array_to_string(contract_missing_attrs(c), ',') !~ 'epartment' from contracts c where id = :'c2'), true);
select t_eq('a filled-in record is not missing the new fields',
  (select contract_missing_attrs(c) && array['Other party signer', 'Other party signed date', 'SIL signed date'] from contracts c where id = :'c1'), false);

-- Going Active still needs the effective date and the SIL signed date (unchanged rule).
insert into contract_documents (contract_id, doc_key, version, role, filename, content_type, size_bytes,
                                sha256, s3_key, s3_version_id, change_note)
values (:'c1', gen_random_uuid(), 1, 'original', 'x.pdf', 'application/pdf', 10,
        repeat('a', 64), 'k/c1', 'v1', 'initial');
do $$ begin
  begin
    update contracts set status = 'active', expiration_date = date '2030-01-01' where id = '00000000-0000-0000-0000-00000000f1d1';
    raise exception 'FAIL [activation without an effective date should be refused]';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise notice 'ok   activation without an effective date is refused';
  end;
end $$;
update contracts set status = 'active', effective_date = date '2025-01-01', expiration_date = date '2030-01-01' where id = :'c1';
select t_eq('activation works with effective + SIL signed date (no department, no vendor dates needed)',
  (select status::text from contracts where id = :'c1'), 'active');

rollback;
