ALTER TABLE `project_estimates` ADD `client_signers_json` text;
ALTER TABLE `project_estimates` ADD `company_signer_initials` text;
ALTER TABLE `project_estimates` ADD `foxit_embedded_session_url` text;
ALTER TABLE `project_estimates` ADD `foxit_prepared_source_hash` text;
ALTER TABLE `project_estimates` ADD `foxit_prepared_at` text;

UPDATE `project_estimates`
SET `client_signers_json` = json_array(json_object(
  'contactId', `client_signer_contact_id`,
  'name', `client_signer_name`,
  'title', `client_signer_title`,
  'email', `client_signer_email`,
  'initials', trim(
    substr(`client_signer_name`, 1, 1) ||
    CASE
      WHEN instr(trim(`client_signer_name`), ' ') > 0
      THEN substr(trim(`client_signer_name`), instr(trim(`client_signer_name`), ' ') + 1, 1)
      ELSE ''
    END
  )
))
WHERE trim(coalesce(`client_signer_name`, '')) <> '';

UPDATE `project_estimates`
SET `company_signer_initials` = trim(
  substr(`company_signer_name`, 1, 1) ||
  CASE
    WHEN instr(trim(`company_signer_name`), ' ') > 0
    THEN substr(trim(`company_signer_name`), instr(trim(`company_signer_name`), ' ') + 1, 1)
    ELSE ''
  END
)
WHERE trim(coalesce(`company_signer_name`, '')) <> '';
