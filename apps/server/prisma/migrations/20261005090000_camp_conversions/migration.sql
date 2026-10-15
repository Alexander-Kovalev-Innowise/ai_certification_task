-- Additive only. Camp/evaluation sign-up -> account conversion (Epic-01 side of the Epic-08 camp form).
ALTER TABLE "public"."PlayerTrainerAssociation" ADD COLUMN "source" TEXT;

CREATE TABLE "public"."CampConversion" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "shareLinkId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampConversion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CampConversion_tokenHash_key" ON "public"."CampConversion"("tokenHash");

CREATE INDEX "CampConversion_shareLinkId_idx" ON "public"."CampConversion"("shareLinkId");

ALTER TABLE "public"."CampConversion" ADD CONSTRAINT "CampConversion_shareLinkId_fkey" FOREIGN KEY ("shareLinkId") REFERENCES "public"."ShareLink"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
