-- CreateTable
CREATE TABLE "ProductIntelligence" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "snapshot" TEXT NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "category" TEXT,
    "format" TEXT,
    "attributes" TEXT,
    "useCases" TEXT,
    "crossSellAngles" TEXT,
    "factRefs" TEXT,
    "enrichedHash" TEXT,
    "enrichmentVersion" TEXT,
    "modelName" TEXT,
    "enrichedAt" DATETIME,
    "enrichmentStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" DATETIME,
    "lastError" TEXT,
    "syncedAt" DATETIME NOT NULL,
    "deletedAt" DATETIME
);

-- CreateTable
CREATE TABLE "ProductRelationship" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "sourceProductId" TEXT NOT NULL,
    "targetProductId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "score" REAL NOT NULL,
    "reasoning" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProductRelationship_shop_sourceProductId_fkey" FOREIGN KEY ("shop", "sourceProductId") REFERENCES "ProductIntelligence" ("shop", "productId") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OfferDecision" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "referenceId" TEXT NOT NULL,
    "basketKey" TEXT NOT NULL,
    "orderContext" TEXT NOT NULL,
    "candidates" TEXT NOT NULL,
    "selectedVariantId" TEXT,
    "selectedProductId" TEXT,
    "headline" TEXT,
    "description" TEXT,
    "reasoning" TEXT,
    "source" TEXT NOT NULL,
    "fallbackReason" TEXT,
    "modelName" TEXT,
    "promptVersion" TEXT,
    "durationMs" INTEGER,
    "discountPercent" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "ProductIntelligence_shop_enrichmentStatus_nextAttemptAt_idx" ON "ProductIntelligence"("shop", "enrichmentStatus", "nextAttemptAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProductIntelligence_shop_productId_key" ON "ProductIntelligence"("shop", "productId");

-- CreateIndex
CREATE INDEX "ProductRelationship_shop_sourceProductId_idx" ON "ProductRelationship"("shop", "sourceProductId");

-- CreateIndex
CREATE INDEX "ProductRelationship_shop_targetProductId_idx" ON "ProductRelationship"("shop", "targetProductId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductRelationship_shop_sourceProductId_targetProductId_key" ON "ProductRelationship"("shop", "sourceProductId", "targetProductId");

-- CreateIndex
CREATE INDEX "OfferDecision_shop_basketKey_createdAt_idx" ON "OfferDecision"("shop", "basketKey", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "OfferDecision_shop_referenceId_key" ON "OfferDecision"("shop", "referenceId");
