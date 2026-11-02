-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ShopSettings" (
    "shop" TEXT NOT NULL PRIMARY KEY,
    "autoEnrich" BOOLEAN NOT NULL DEFAULT false,
    "upsellTag" TEXT,
    "discountPercent" INTEGER,
    "maxOrderRatio" REAL,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_ShopSettings" ("autoEnrich", "discountPercent", "maxOrderRatio", "shop", "updatedAt", "upsellTag") SELECT "autoEnrich", "discountPercent", "maxOrderRatio", "shop", "updatedAt", "upsellTag" FROM "ShopSettings";
DROP TABLE "ShopSettings";
ALTER TABLE "new_ShopSettings" RENAME TO "ShopSettings";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
