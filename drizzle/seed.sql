-- Seed data for COMPASS
-- Run with: sqlite3 .wrangler/state/v3/d1/miniflare-D1DatabaseObject/<hash>.sqlite < seed.sql
-- (wrangler --file flag is broken in 4.x, use sqlite3 directly)

-- Remove legacy demo project if present
DELETE FROM projects WHERE id = 'demo-project-1';

-- ─── Customers (from Customers324.csv) ───

INSERT OR IGNORE INTO customers (id, name, email, phone, created_at) VALUES
  ('cust-001', 'Greg Smith', NULL, NULL, '2023-07-27T08:00:00Z'),
  ('cust-002', 'Andrew and Karen Rodney', NULL, NULL, '2023-07-27T08:00:00Z'),
  ('cust-003', 'Sandra Coen', NULL, NULL, '2023-08-15T10:00:00Z'),
  ('cust-004', 'Keith & Jennifer Hinson', NULL, NULL, '2023-09-01T08:00:00Z'),
  ('cust-005', 'Gerald and Kristi Taylor', NULL, NULL, '2023-09-10T09:00:00Z'),
  ('cust-006', 'Travis and Tanis Loomis', NULL, NULL, '2023-10-01T08:00:00Z'),
  ('cust-007', 'James McGorry', NULL, NULL, '2023-10-15T10:00:00Z'),
  ('cust-008', 'Redline Pipeline', NULL, NULL, '2023-11-01T08:00:00Z'),
  ('cust-009', 'Justin Rapp', NULL, NULL, '2023-11-15T09:00:00Z'),
  ('cust-010', 'Matt B Willson', NULL, NULL, '2023-12-01T08:00:00Z'),
  ('cust-011', 'Izabela Bigley', NULL, NULL, '2024-01-10T08:00:00Z'),
  ('cust-012', 'Rob Montano', NULL, NULL, '2024-02-01T09:00:00Z'),
  ('cust-013', 'Robert Kelsey', NULL, NULL, '2024-03-01T08:00:00Z'),
  ('cust-014', 'Chris Auger', NULL, NULL, '2024-03-15T10:00:00Z'),
  ('cust-015', 'Joseph Clifford', NULL, NULL, '2024-04-01T08:00:00Z'),
  ('cust-016', 'Dan Maley', NULL, NULL, '2024-05-01T09:00:00Z'),
  ('cust-017', 'Russ Gehling', NULL, NULL, '2024-06-01T08:00:00Z'),
  ('cust-018', 'James (Jimmy) Lusero', NULL, NULL, '2024-07-01T10:00:00Z'),
  ('cust-019', 'Bach Builders LLC', NULL, NULL, '2024-08-01T08:00:00Z'),
  ('cust-020', 'Mark Myers', NULL, NULL, '2024-09-01T09:00:00Z'),
  ('cust-021', 'William M Rainey', NULL, NULL, '2024-01-15T08:00:00Z'),
  ('cust-022', 'Craig Chellis', NULL, NULL, '2024-02-20T09:00:00Z'),
  ('cust-023', 'Donald Henrich', NULL, NULL, '2024-03-10T08:00:00Z'),
  ('cust-024', 'Kelsey & Daniel Dougherty', NULL, NULL, '2024-04-05T10:00:00Z'),
  ('cust-025', 'German Nevarez', NULL, NULL, '2024-05-12T08:00:00Z'),
  ('cust-026', 'Eric Wammel', NULL, NULL, '2024-06-20T09:00:00Z'),
  ('cust-027', 'Troy & Wendy Reiter', NULL, NULL, '2024-07-15T08:00:00Z'),
  ('cust-028', 'Fish Builders', NULL, NULL, '2024-08-01T10:00:00Z'),
  ('cust-029', 'Nathan and Lisa Wood', NULL, NULL, '2024-09-10T08:00:00Z'),
  ('cust-030', 'Stephanie Wetherby', NULL, NULL, '2024-10-01T09:00:00Z'),
  ('cust-031', 'Terry Weatherford', NULL, NULL, '2024-11-01T08:00:00Z'),
  ('cust-032', 'Scott Edwards', NULL, NULL, '2024-12-01T10:00:00Z'),
  ('cust-033', 'Tom Backes', NULL, NULL, '2025-01-15T08:00:00Z'),
  ('cust-034', 'James Chaney', NULL, NULL, '2025-02-01T09:00:00Z'),
  ('cust-035', 'Michael Ziehler', NULL, NULL, '2025-03-10T08:00:00Z'),
  ('cust-036', 'Alec Korver', NULL, NULL, '2025-04-01T10:00:00Z'),
  ('cust-037', 'David & Debi Strom', NULL, NULL, '2025-05-01T08:00:00Z'),
  ('cust-038', 'Dyer Construction Co.', NULL, NULL, '2025-06-15T09:00:00Z'),
  ('cust-039', 'Paldamas Construction', NULL, NULL, '2025-07-01T08:00:00Z'),
  ('cust-040', 'Barton Supply', NULL, NULL, '2025-08-01T10:00:00Z');

-- ─── Vendors (from Vendors698.csv) ───

INSERT OR IGNORE INTO vendors (id, name, category, email, phone, address, created_at) VALUES
  ('vend-001', '1st Priority Home Improvements LLC', 'Subcontractor', '1stpriorityhomeimprovement@gmail.com', NULL, '2928 Main St. Apt 101, Colorado Springs, CO 80907', '2023-07-16T20:26:00Z'),
  ('vend-002', 'Advantage Tile Work Inc.', 'Subcontractor', NULL, NULL, NULL, '2023-07-16T20:26:00Z'),
  ('vend-003', 'Apex Radon', 'Subcontractor', NULL, NULL, NULL, '2023-07-16T20:26:00Z'),
  ('vend-004', 'Christensen Construction Co. Inc.', 'Subcontractor', NULL, NULL, NULL, '2023-07-16T20:26:00Z'),
  ('vend-005', 'Kilgore Companies dba Peak Ready Mix', 'Subcontractor', NULL, NULL, NULL, '2023-07-16T20:26:00Z'),
  ('vend-006', 'Smelker Concrete Pumping Inc.', 'Subcontractor', NULL, NULL, NULL, '2023-07-16T20:26:00Z'),
  ('vend-007', 'Simpson Strong-Tie Co Inc', 'Subcontractor', NULL, NULL, NULL, '2023-07-16T20:26:00Z'),
  ('vend-008', 'Florissant ACE Hardware', 'Supplier', NULL, NULL, NULL, '2023-07-16T20:26:00Z'),
  ('vend-009', 'A-Mark Stamp/Budget Sign', 'Supplier', NULL, NULL, NULL, '2023-07-16T20:26:00Z'),
  ('vend-010', 'Aggregate Ind dba Transit Mix Concrete Co.', 'Supplier', NULL, NULL, NULL, '2023-07-16T20:26:00Z'),
  ('vend-011', 'Airlite Plastics Co.', 'Supplier', NULL, NULL, NULL, '2023-07-16T20:26:00Z'),
  ('vend-012', 'Apex Waste - Teller County', 'Supplier', NULL, NULL, NULL, '2023-07-16T20:26:00Z'),
  ('vend-013', 'Digital River', 'Supplier', NULL, NULL, NULL, '2023-07-16T20:26:00Z'),
  ('vend-014', 'Divide Feed', 'Supplier', NULL, NULL, NULL, '2023-07-16T20:26:00Z'),
  ('vend-015', 'Hardrick Enterprises', 'Supplier', NULL, NULL, NULL, '2023-07-16T20:26:00Z'),
  ('vend-016', 'MacArthur Co.', 'Supplier', NULL, NULL, NULL, '2023-07-16T20:26:00Z'),
  ('vend-017', 'Colorado Geoscience & Design', 'Subcontractor', NULL, NULL, NULL, '2023-07-16T20:26:00Z'),
  ('vend-018', 'Hamacher Well Works', 'Subcontractor', NULL, NULL, NULL, '2023-07-16T20:26:00Z'),
  ('vend-019', 'H2Air of Colorado', 'Subcontractor', NULL, NULL, NULL, '2023-07-16T20:26:00Z'),
  ('vend-020', 'TK Concrete Lifting', 'Subcontractor', NULL, NULL, NULL, '2023-07-16T20:26:00Z'),
  ('vend-021', 'Mule Creek Gravel', 'Supplier', NULL, NULL, NULL, '2023-07-16T20:26:00Z'),
  ('vend-022', 'BURNCO Colorado', 'Supplier', NULL, NULL, NULL, '2023-07-16T20:26:00Z'),
  ('vend-023', 'Agate Services', 'Subcontractor', NULL, NULL, NULL, '2023-07-16T20:26:00Z'),
  ('vend-024', 'JDM Consulting', 'Subcontractor', NULL, NULL, NULL, '2023-07-16T20:26:00Z'),
  ('vend-025', 'Teds Plumbing', 'Subcontractor', NULL, NULL, NULL, '2023-07-16T20:26:00Z');

-- ─── Projects (realistic HPS projects using customer names) ───

INSERT OR IGNORE INTO projects (id, name, status, address, client_name, project_manager, created_at) VALUES
  ('proj-o-001', 'O-001-5678-Williams', 'ACTIVE', '5678 Pine Ridge Dr, Woodland Park, CO', 'Matt B Willson', 'Daniel M Vogel', '2025-07-10T08:00:00Z'),
  ('proj-o-002', 'O-002-9012-Chen', 'ACTIVE', '9012 Elk Creek Rd, Divide, CO', 'Sandra Coen', 'Daniel M Vogel', '2025-09-20T09:00:00Z'),
  ('proj-o-003', 'O-003-3456-Taylor', 'OPEN', '3456 Mountain View Ln, Florissant, CO', 'Gerald and Kristi Taylor', 'Wesley Jones', '2025-11-05T10:00:00Z'),
  ('proj-o-004', 'O-004-7890-Hinson', 'ACTIVE', '7890 Sunset Trail, Cripple Creek, CO', 'Keith & Jennifer Hinson', 'Daniel M Vogel', '2025-12-01T08:00:00Z'),
  ('proj-o-005', 'O-005-2345-Loomis', 'OPEN', '2345 Aspen Grove Way, Woodland Park, CO', 'Travis and Tanis Loomis', 'Wesley Jones', '2026-01-10T09:00:00Z'),
  ('proj-n-001', 'N-001-1234-Johnson', 'ACTIVE', '1234 Gold Camp Rd, Colorado Springs, CO', 'James McGorry', 'Daniel M Vogel', '2025-08-15T09:00:00Z'),
  ('proj-n-002', 'N-002-5600-Martinez', 'COMPLETE', '5600 Ute Pass Ave, Cascade, CO', 'Justin Rapp', 'Wesley Jones', '2025-03-01T08:00:00Z'),
  ('proj-n-003', 'N-003-8800-Kelsey', 'ACTIVE', '8800 Rampart Range Rd, Woodland Park, CO', 'Robert Kelsey', 'Daniel M Vogel', '2025-10-15T10:00:00Z'),
  ('proj-n-004', 'N-004-4200-Auger', 'OPEN', '4200 Teller County Rd, Florissant, CO', 'Chris Auger', 'Wesley Jones', '2026-01-05T08:00:00Z'),
  ('proj-n-005', 'N-005-6100-Clifford', 'ACTIVE', '6100 High Park Rd, Cripple Creek, CO', 'Joseph Clifford', 'Daniel M Vogel', '2025-11-20T09:00:00Z');

-- ─── Schedule Tasks for N-001-1234-Johnson ───
-- Full construction schedule: preconstruction through closeout
-- As of Jan 2026, project is in drywall phase

INSERT OR IGNORE INTO schedule_tasks (id, project_id, title, start_date, workdays, end_date_calculated, phase, status, is_critical_path, is_milestone, percent_complete, assigned_to, sort_order, created_at, updated_at) VALUES
-- Preconstruction (COMPLETE)
('task-n001-001', 'proj-n-001', 'Permits & Approvals', '2025-08-18', 10, '2025-08-29', 'preconstruction', 'COMPLETE', 1, 0, 100, 'Daniel M Vogel', 1, '2025-08-15T09:00:00Z', '2025-08-29T16:00:00Z'),
('task-n001-002', 'proj-n-001', 'Survey & Staking', '2025-08-25', 3, '2025-08-27', 'preconstruction', 'COMPLETE', 0, 0, 100, 'Colorado Geoscience & Design', 2, '2025-08-15T09:00:00Z', '2025-08-27T15:00:00Z'),
('task-n001-003', 'proj-n-001', 'Soils Report', '2025-08-25', 5, '2025-08-29', 'preconstruction', 'COMPLETE', 0, 0, 100, 'Colorado Geoscience & Design', 3, '2025-08-15T09:00:00Z', '2025-08-29T14:00:00Z'),
-- Sitework (COMPLETE)
('task-n001-004', 'proj-n-001', 'Clear & Grub', '2025-09-02', 3, '2025-09-04', 'sitework', 'COMPLETE', 1, 0, 100, 'Agate Services', 4, '2025-08-15T09:00:00Z', '2025-09-04T16:00:00Z'),
('task-n001-005', 'proj-n-001', 'Rough Grade', '2025-09-05', 5, '2025-09-11', 'sitework', 'COMPLETE', 1, 0, 100, 'Agate Services', 5, '2025-08-15T09:00:00Z', '2025-09-11T16:00:00Z'),
('task-n001-006', 'proj-n-001', 'Driveway Cut & Base', '2025-09-08', 4, '2025-09-11', 'sitework', 'COMPLETE', 0, 0, 100, 'Mule Creek Gravel', 6, '2025-08-15T09:00:00Z', '2025-09-11T16:00:00Z'),
('task-n001-007', 'proj-n-001', 'Utility Trenching', '2025-09-12', 5, '2025-09-18', 'sitework', 'COMPLETE', 1, 0, 100, 'Agate Services', 7, '2025-08-15T09:00:00Z', '2025-09-18T16:00:00Z'),
('task-n001-008', 'proj-n-001', 'Well Drilling', '2025-09-15', 4, '2025-09-18', 'sitework', 'COMPLETE', 0, 0, 100, 'Hamacher Well Works', 8, '2025-08-15T09:00:00Z', '2025-09-18T15:00:00Z'),
-- Foundation (COMPLETE)
('task-n001-009', 'proj-n-001', 'Excavation', '2025-09-22', 3, '2025-09-24', 'foundation', 'COMPLETE', 1, 0, 100, 'Christensen Construction Co. Inc.', 9, '2025-08-15T09:00:00Z', '2025-09-24T16:00:00Z'),
('task-n001-010', 'proj-n-001', 'Pour Footings', '2025-09-25', 5, '2025-10-01', 'foundation', 'COMPLETE', 1, 0, 100, 'Kilgore Companies dba Peak Ready Mix', 10, '2025-08-15T09:00:00Z', '2025-10-01T16:00:00Z'),
('task-n001-011', 'proj-n-001', 'Foundation Walls', '2025-10-02', 7, '2025-10-10', 'foundation', 'COMPLETE', 1, 0, 100, 'Christensen Construction Co. Inc.', 11, '2025-08-15T09:00:00Z', '2025-10-10T16:00:00Z'),
('task-n001-012', 'proj-n-001', 'Waterproofing & Drain Tile', '2025-10-13', 2, '2025-10-14', 'foundation', 'COMPLETE', 0, 0, 100, '1st Priority Home Improvements LLC', 12, '2025-08-15T09:00:00Z', '2025-10-14T16:00:00Z'),
('task-n001-013', 'proj-n-001', 'Backfill', '2025-10-15', 3, '2025-10-17', 'foundation', 'COMPLETE', 1, 0, 100, 'Christensen Construction Co. Inc.', 13, '2025-08-15T09:00:00Z', '2025-10-17T16:00:00Z'),
('task-n001-014', 'proj-n-001', 'Foundation Complete', '2025-10-17', 1, '2025-10-17', 'foundation', 'COMPLETE', 1, 1, 100, NULL, 14, '2025-08-15T09:00:00Z', '2025-10-17T17:00:00Z'),
-- Framing (COMPLETE)
('task-n001-015', 'proj-n-001', 'Floor System', '2025-10-20', 5, '2025-10-24', 'framing', 'COMPLETE', 1, 0, 100, 'Daniel M Vogel', 15, '2025-08-15T09:00:00Z', '2025-10-24T16:00:00Z'),
('task-n001-016', 'proj-n-001', 'Wall Framing', '2025-10-27', 8, '2025-11-05', 'framing', 'COMPLETE', 1, 0, 100, 'Daniel M Vogel', 16, '2025-08-15T09:00:00Z', '2025-11-05T16:00:00Z'),
('task-n001-017', 'proj-n-001', 'Roof Framing', '2025-11-06', 6, '2025-11-13', 'framing', 'COMPLETE', 1, 0, 100, 'Daniel M Vogel', 17, '2025-08-15T09:00:00Z', '2025-11-13T16:00:00Z'),
('task-n001-018', 'proj-n-001', 'Sheathing & Wrap', '2025-11-14', 4, '2025-11-19', 'framing', 'COMPLETE', 1, 0, 100, 'Daniel M Vogel', 18, '2025-08-15T09:00:00Z', '2025-11-19T16:00:00Z'),
('task-n001-019', 'proj-n-001', 'Framing Inspection', '2025-11-20', 1, '2025-11-20', 'framing', 'COMPLETE', 1, 1, 100, 'Daniel M Vogel', 19, '2025-08-15T09:00:00Z', '2025-11-20T12:00:00Z'),
-- Roofing (COMPLETE)
('task-n001-020', 'proj-n-001', 'Roofing Felt & Ice Shield', '2025-11-20', 2, '2025-11-21', 'roofing', 'COMPLETE', 0, 0, 100, 'Simpson Strong-Tie Co Inc', 20, '2025-08-15T09:00:00Z', '2025-11-21T16:00:00Z'),
('task-n001-021', 'proj-n-001', 'Metal Roofing Install', '2025-11-24', 5, '2025-11-28', 'roofing', 'COMPLETE', 1, 0, 100, 'Simpson Strong-Tie Co Inc', 21, '2025-08-15T09:00:00Z', '2025-11-28T16:00:00Z'),
-- Electrical (COMPLETE)
('task-n001-022', 'proj-n-001', 'Rough-In Electrical', '2025-12-01', 6, '2025-12-08', 'electrical', 'COMPLETE', 0, 0, 100, 'Hardrick Enterprises', 22, '2025-08-15T09:00:00Z', '2025-12-08T16:00:00Z'),
-- Plumbing (COMPLETE)
('task-n001-023', 'proj-n-001', 'Rough-In Plumbing', '2025-12-01', 5, '2025-12-05', 'plumbing', 'COMPLETE', 0, 0, 100, 'Teds Plumbing', 23, '2025-08-15T09:00:00Z', '2025-12-05T16:00:00Z'),
-- HVAC (COMPLETE)
('task-n001-024', 'proj-n-001', 'HVAC Rough-In', '2025-12-08', 5, '2025-12-12', 'hvac', 'COMPLETE', 0, 0, 100, 'H2Air of Colorado', 24, '2025-08-15T09:00:00Z', '2025-12-12T16:00:00Z'),
('task-n001-025', 'proj-n-001', 'MEP Inspection', '2025-12-15', 1, '2025-12-15', 'hvac', 'COMPLETE', 1, 1, 100, 'Daniel M Vogel', 25, '2025-08-15T09:00:00Z', '2025-12-15T14:00:00Z'),
-- Insulation (COMPLETE)
('task-n001-026', 'proj-n-001', 'Spray Foam Insulation', '2025-12-16', 4, '2025-12-19', 'insulation', 'COMPLETE', 1, 0, 100, 'Airlite Plastics Co.', 26, '2025-08-15T09:00:00Z', '2025-12-19T16:00:00Z'),
('task-n001-027', 'proj-n-001', 'Batt Insulation', '2025-12-22', 3, '2025-12-24', 'insulation', 'COMPLETE', 0, 0, 100, 'Airlite Plastics Co.', 27, '2025-08-15T09:00:00Z', '2025-12-24T16:00:00Z'),
-- Drywall (IN_PROGRESS)
('task-n001-028', 'proj-n-001', 'Hang Drywall', '2026-01-05', 6, '2026-01-12', 'drywall', 'COMPLETE', 1, 0, 100, 'Advantage Tile Work Inc.', 28, '2025-08-15T09:00:00Z', '2026-01-12T16:00:00Z'),
('task-n001-029', 'proj-n-001', 'Tape & Mud', '2026-01-13', 5, '2026-01-19', 'drywall', 'IN_PROGRESS', 1, 0, 80, 'Advantage Tile Work Inc.', 29, '2025-08-15T09:00:00Z', '2026-01-22T10:00:00Z'),
('task-n001-030', 'proj-n-001', 'Texture & Prime', '2026-01-22', 3, '2026-01-24', 'drywall', 'IN_PROGRESS', 1, 0, 30, 'Advantage Tile Work Inc.', 30, '2025-08-15T09:00:00Z', '2026-01-23T14:00:00Z'),
-- Finish (PENDING)
('task-n001-031', 'proj-n-001', 'Cabinets & Countertops', '2026-01-27', 5, '2026-01-31', 'finish', 'PENDING', 0, 0, 0, NULL, 31, '2025-08-15T09:00:00Z', '2025-08-15T09:00:00Z'),
('task-n001-032', 'proj-n-001', 'Trim & Millwork', '2026-02-03', 7, '2026-02-11', 'finish', 'PENDING', 0, 0, 0, NULL, 32, '2025-08-15T09:00:00Z', '2025-08-15T09:00:00Z'),
('task-n001-033', 'proj-n-001', 'Interior Paint', '2026-02-12', 5, '2026-02-18', 'finish', 'PENDING', 1, 0, 0, NULL, 33, '2025-08-15T09:00:00Z', '2025-08-15T09:00:00Z'),
('task-n001-034', 'proj-n-001', 'Flooring Install', '2026-02-19', 5, '2026-02-25', 'finish', 'PENDING', 0, 0, 0, NULL, 34, '2025-08-15T09:00:00Z', '2025-08-15T09:00:00Z'),
('task-n001-035', 'proj-n-001', 'Fixtures & Hardware', '2026-02-26', 3, '2026-02-28', 'finish', 'PENDING', 0, 0, 0, NULL, 35, '2025-08-15T09:00:00Z', '2025-08-15T09:00:00Z'),
('task-n001-036', 'proj-n-001', 'Final Electrical & Plumbing', '2026-03-02', 3, '2026-03-04', 'finish', 'PENDING', 0, 0, 0, NULL, 36, '2025-08-15T09:00:00Z', '2025-08-15T09:00:00Z'),
-- Landscaping (PENDING)
('task-n001-037', 'proj-n-001', 'Final Grade', '2026-03-05', 3, '2026-03-09', 'landscaping', 'PENDING', 0, 0, 0, NULL, 37, '2025-08-15T09:00:00Z', '2025-08-15T09:00:00Z'),
('task-n001-038', 'proj-n-001', 'Landscaping & Seed', '2026-03-10', 4, '2026-03-13', 'landscaping', 'PENDING', 0, 0, 0, NULL, 38, '2025-08-15T09:00:00Z', '2025-08-15T09:00:00Z'),
-- Closeout (PENDING)
('task-n001-039', 'proj-n-001', 'Final Inspections', '2026-03-16', 3, '2026-03-18', 'closeout', 'PENDING', 1, 0, 0, 'Daniel M Vogel', 39, '2025-08-15T09:00:00Z', '2025-08-15T09:00:00Z'),
('task-n001-040', 'proj-n-001', 'Punch List', '2026-03-19', 5, '2026-03-25', 'closeout', 'PENDING', 0, 0, 0, NULL, 40, '2025-08-15T09:00:00Z', '2025-08-15T09:00:00Z'),
('task-n001-041', 'proj-n-001', 'Certificate of Occupancy', '2026-03-26', 2, '2026-03-27', 'closeout', 'PENDING', 1, 1, 0, 'Daniel M Vogel', 41, '2025-08-15T09:00:00Z', '2025-08-15T09:00:00Z');

-- ─── Dependencies for N-001 (finish-to-start) ───

INSERT OR IGNORE INTO task_dependencies (id, predecessor_id, successor_id, type, lag_days) VALUES
('dep-n001-01', 'task-n001-001', 'task-n001-004', 'FS', 0),
('dep-n001-02', 'task-n001-007', 'task-n001-009', 'FS', 2),
('dep-n001-03', 'task-n001-010', 'task-n001-011', 'FS', 0),
('dep-n001-04', 'task-n001-011', 'task-n001-012', 'FS', 0),
('dep-n001-05', 'task-n001-013', 'task-n001-015', 'FS', 1),
('dep-n001-06', 'task-n001-018', 'task-n001-020', 'FS', 0),
('dep-n001-07', 'task-n001-019', 'task-n001-022', 'FS', 0),
('dep-n001-08', 'task-n001-019', 'task-n001-023', 'FS', 0),
('dep-n001-09', 'task-n001-024', 'task-n001-025', 'FS', 0),
('dep-n001-10', 'task-n001-025', 'task-n001-026', 'FS', 0),
('dep-n001-11', 'task-n001-027', 'task-n001-028', 'FS', 0),
('dep-n001-12', 'task-n001-028', 'task-n001-029', 'FS', 0),
('dep-n001-13', 'task-n001-029', 'task-n001-030', 'FS', 0),
('dep-n001-14', 'task-n001-030', 'task-n001-031', 'FS', 1),
('dep-n001-15', 'task-n001-035', 'task-n001-036', 'FS', 0),
('dep-n001-16', 'task-n001-036', 'task-n001-037', 'FS', 0),
('dep-n001-17', 'task-n001-038', 'task-n001-039', 'FS', 1),
('dep-n001-18', 'task-n001-039', 'task-n001-040', 'FS', 0),
('dep-n001-19', 'task-n001-040', 'task-n001-041', 'FS', 0);
