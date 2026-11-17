-- MSA isn't a contract type of its own -- it's the custom_msa flag + an attached 'msa'
-- document (migration 06). The seeded "Vendor contract / MSA" type name conflated the two
-- and confused people filling out the form. Renamed to plain "Vendor contract"; 01's insert
-- was updated to match (a no-op for anyone who already ran 01, same as 08's parent_id guard).
update contract_types set name = 'Vendor contract' where name = 'Vendor contract / MSA';
