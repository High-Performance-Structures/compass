-- Nu-Tech orders: the order's number in the manufacturer PO sequence
-- (e.g. 1860 in "N-0-0-1860 Reeves"), assigned when the PO workbook is first
-- generated and reused on regeneration.
ALTER TABLE `nutech_order_workflows` ADD `airlite_po_sequence` integer;
