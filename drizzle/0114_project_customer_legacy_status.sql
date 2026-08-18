UPDATE `projects`
SET
	`status` = 'OPEN',
	`updated_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE `client_status` = 'customer'
	AND upper(trim(`status`)) = 'LEAD';
