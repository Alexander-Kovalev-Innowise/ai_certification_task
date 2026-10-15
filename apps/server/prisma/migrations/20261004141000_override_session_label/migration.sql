-- Additive only. Human label of the session a coach was assigned to despite a conflict (Epic-02 stand-in).
ALTER TABLE "CoachAvailabilityOverride" ADD COLUMN "sessionLabel" TEXT;
