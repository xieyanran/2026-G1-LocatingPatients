-- PRD 4.1 (Must Have): "Patient's name (or 'XXXX' if they have a protected
-- identity)". The real name is still stored (staff who create/edit the
-- record need it); masking happens at render time in the app, not here.
alter table patients
add column protected_identity boolean not null default false;
