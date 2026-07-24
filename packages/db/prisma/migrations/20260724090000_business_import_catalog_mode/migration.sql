BEGIN;

CREATE TYPE "BusinessImportCatalogMode" AS ENUM ('ADD', 'REPLACE');

ALTER TABLE "BusinessImport"
ADD COLUMN "catalogMode" "BusinessImportCatalogMode" NOT NULL DEFAULT 'ADD';

COMMIT;
