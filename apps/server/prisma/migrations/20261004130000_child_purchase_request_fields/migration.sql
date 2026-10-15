-- Child-initiated purchase requests (POST /me/purchase-requests): the Epic-02/05
-- checkout is not built yet, so a request may carry no event, and carries a
-- human title plus the guardian's optional "request more info" message.
ALTER TABLE "public"."ChildPurchaseApproval" ALTER COLUMN "eventId" DROP NOT NULL;
ALTER TABLE "public"."ChildPurchaseApproval" ADD COLUMN "title" TEXT;
ALTER TABLE "public"."ChildPurchaseApproval" ADD COLUMN "infoRequestMessage" TEXT;
ALTER TABLE "public"."ChildPurchaseApproval" ADD COLUMN "infoRequestedAt" TIMESTAMP(3);
