UPDATE `projects`
SET `job_status_id` = CASE
  WHEN upper(trim(`status`)) = 'CLOSED' THEN 'closed'
  WHEN upper(trim(`status`)) IN ('BID REFUSED', 'BID_REFUSED') THEN 'bid_refused'
  ELSE `job_status_id`
END
WHERE upper(trim(`status`)) IN ('CLOSED', 'BID REFUSED', 'BID_REFUSED');
