-- Field app: a per-job choice of whether the job appears in Field Mode.
-- NULL means "Automatic" (the company's Settings decide from the job's
-- phase and department); 'shown' always shows it; 'hidden' never does.
-- Closed jobs never show whatever this says. Additive only, no backfill:
-- every existing job starts on Automatic.
ALTER TABLE projects ADD COLUMN field_app_visibility text;
