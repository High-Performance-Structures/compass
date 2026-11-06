-- How many bundles of a Nu-Tech product fill a manufacturer truck, so an order
-- shows what share of a truckload it takes. Staff set it on the product
-- catalog; the price-list import never writes it.
-- Additive only: one nullable column.
ALTER TABLE `nutech_products` ADD COLUMN `bundles_per_truckload` integer;
