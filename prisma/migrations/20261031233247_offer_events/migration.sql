-- AlterTable
ALTER TABLE "OfferDecision" ADD COLUMN "offerPrice" REAL;

-- CreateTable
CREATE TABLE "OfferEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "decisionId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "value" REAL,
    "currencyCode" TEXT,
    "reason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OfferEvent_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "OfferDecision" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "OfferEvent_shop_type_createdAt_idx" ON "OfferEvent"("shop", "type", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "OfferEvent_decisionId_type_key" ON "OfferEvent"("decisionId", "type");
