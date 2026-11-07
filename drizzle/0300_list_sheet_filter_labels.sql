-- Settings > Lists: a company's names for a sheet's filter buttons
-- (change orders' Open / In progress / With owner ...). Additive only.
ALTER TABLE `organization_list_sheet_settings` ADD `filter_labels` text;
