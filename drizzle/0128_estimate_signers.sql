ALTER TABLE `project_estimates` ADD `client_signer_contact_id` text REFERENCES `project_contacts`(`id`) ON DELETE SET NULL;
ALTER TABLE `project_estimates` ADD `client_signer_name` text;
ALTER TABLE `project_estimates` ADD `client_signer_title` text;
ALTER TABLE `project_estimates` ADD `client_signer_email` text;
ALTER TABLE `project_estimates` ADD `company_signer_contact_id` text REFERENCES `project_contacts`(`id`) ON DELETE SET NULL;
ALTER TABLE `project_estimates` ADD `company_signer_name` text;
ALTER TABLE `project_estimates` ADD `company_signer_title` text;
ALTER TABLE `project_estimates` ADD `company_signer_email` text;
