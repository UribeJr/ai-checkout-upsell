-- CreateTable
CREATE TABLE "ShopSettings" (
    "shop" TEXT NOT NULL PRIMARY KEY,
    "autoEnrich" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" DATETIME NOT NULL
);
