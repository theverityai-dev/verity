-- Stylified print queue: remember which bundles have had their slip printed, so a bundle with no slip on it can be found and flagged.
-- Additive and nullable; a bundle printed before this existed simply shows as not printed.
ALTER TABLE "piecework_bundle" ADD COLUMN "slip_printed_at" TIMESTAMP(3);