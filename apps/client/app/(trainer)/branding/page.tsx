'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { SkeletonCard } from '../../../src/components/shared/Skeleton';
import { BrandingLivePreview } from '../../../src/components/trainer/BrandingLivePreview';
import { ColorPicker } from '../../../src/components/trainer/ColorPicker';
import { ContrastWarningBanner } from '../../../src/components/trainer/ContrastWarningBanner';
import { LogoUploadField } from '../../../src/components/trainer/LogoUploadField';
import { useBootstrap } from '../../../src/hooks/useBootstrap';
import { apiRequest } from '../../../src/lib/api/apiClient';
import { parseApiErrorBody } from '../../../src/lib/api/apiError';
import { updateBrandingSchema, type UpdateBrandingFormValues } from '../../../src/lib/schemas/updateBrandingSchema';

// fe §1.2/§8 — mirrors BrandingProvider.tsx's own (private) platform-default
// mint, used here only as this form's starting value for a trainer who has
// never saved branding (`primaryColorHex: null` off bootstrap) — not
// re-exported from BrandingProvider.tsx to avoid touching that module's
// already-settled Phase 10 internals for a one-constant reuse.
const PLATFORM_DEFAULT_PRIMARY_COLOR_HEX = '#6EE7B7';

const GENERIC_ERROR_MESSAGE = 'Something went wrong saving your branding. Please try again.';

interface TrainerBrandingBootstrap {
  trainerProfile: { id: string };
  branding: { logoUrl: string | null; primaryColorHex: string | null };
}

// Mirrors coaches/page.tsx's `hasTrainerProfileId` / layout.tsx's
// `hasTrainerBranding` type-guard pattern for pulling typed slices off
// `GET /me/bootstrap`'s role-discriminated (and otherwise loosely-typed,
// see types/bootstrap.ts) response.
function hasTrainerBrandingBootstrap(data: unknown): data is TrainerBrandingBootstrap {
  if (typeof data !== 'object' || data === null || !('trainerProfile' in data) || !('branding' in data)) {
    return false;
  }
  const { trainerProfile } = data as { trainerProfile?: unknown };
  return typeof trainerProfile === 'object' && trainerProfile !== null && typeof (trainerProfile as { id?: unknown }).id === 'string';
}

// api §4.1 `BrandingResponseDto` — `derivedPalette` only carries WCAG
// contrast metadata (no shade fields, see BrandingProvider.tsx's own
// comment); this page doesn't consume it directly, `contrastWarning` is
// Task 17.2's job.
interface BrandingResponse {
  logoUrl: string | null;
  primaryColorHex: string | null;
  derivedPalette: unknown;
  contrastWarning?: string;
}

interface BrandingPatchBody {
  primaryColorHex: string;
  logoUrl?: string;
}

async function patchBranding(trainerId: string, body: BrandingPatchBody): Promise<BrandingResponse> {
  const res = await apiRequest(`/trainers/${trainerId}/branding`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    await parseApiErrorBody(res);
    throw new Error(`PATCH /trainers/${trainerId}/branding failed with status ${res.status}`);
  }

  return (await res.json()) as BrandingResponse;
}

interface BrandingFormProps {
  trainerId: string;
  initialLogoUrl: string | null;
  initialPrimaryColorHex: string | null;
}

// fe §8 "`/trainer/branding` settings form specifics" — ColorPicker +
// BrandingLivePreview + LogoUploadField's two-step upload, one "Save
// branding" submit that PATCHes both the color and (when a fresh upload
// happened this session) the logoUrl together. Split from BrandingPage so
// RHF's `defaultValues` are only ever computed once bootstrap data is
// already in hand (mirrors TrainerLayoutContent's isLoading-gated split) —
// no prefill `useEffect` needed at all, sidestepping
// `react-hooks/set-state-in-effect` entirely rather than working around it.
function BrandingForm({ trainerId, initialLogoUrl, initialPrimaryColorHex }: BrandingFormProps) {
  const queryClient = useQueryClient();
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  // Task 17.2 (fe §8, OQ-7/G-11) — non-blocking, dismissible. Only ever set
  // from a successful PATCH response (the save has already happened by the
  // time this can be non-null), never a pre-save gate.
  const [contrastWarning, setContrastWarning] = useState<string | null>(null);

  const {
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<UpdateBrandingFormValues>({
    resolver: zodResolver(updateBrandingSchema),
    defaultValues: {
      primaryColorHex: initialPrimaryColorHex ?? PLATFORM_DEFAULT_PRIMARY_COLOR_HEX,
      logoUrl: initialLogoUrl ?? '',
    },
  });

  const primaryColorHex = watch('primaryColorHex');
  const logoUrl = watch('logoUrl');

  const mutation = useMutation({
    mutationFn: (body: BrandingPatchBody) => patchBranding(trainerId, body),
    onSuccess: (data) => {
      setSaveError(null);
      setSaveSuccess(true);
      // Re-armed on every successful save (not just set once) — a dismissed
      // banner from a previous save must not suppress a fresh warning from
      // this one, and a save with no warning this time must clear a stale
      // one from before.
      setContrastWarning(data.contrastWarning ?? null);
      // fe §8/§10 — refresh the TRAINER bootstrap's `branding` block so
      // BrandingProvider (the layout wrapping this page) picks up the
      // just-saved accent without a full page reload. `exact: true` per this
      // phase's convention — this key has no sub-params to accidentally
      // over-invalidate, but the rule is applied uniformly regardless.
      void queryClient.invalidateQueries({ queryKey: ['me', 'bootstrap'], exact: true });
    },
    onError: () => {
      setSaveSuccess(false);
      setSaveError(GENERIC_ERROR_MESSAGE);
    },
  });

  const onSubmit = handleSubmit((values) => {
    setSaveSuccess(false);
    setSaveError(null);

    const body: BrandingPatchBody = { primaryColorHex: values.primaryColorHex };
    if (values.logoUrl && values.logoUrl !== (initialLogoUrl ?? '')) {
      body.logoUrl = values.logoUrl;
    }
    mutation.mutate(body);
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-lg">
      <LogoUploadField currentLogoUrl={logoUrl || null} onUploaded={(url) => setValue('logoUrl', url, { shouldDirty: true })} />

      <ColorPicker
        value={primaryColorHex}
        onChange={(hex) => setValue('primaryColorHex', hex, { shouldDirty: true, shouldValidate: true })}
        error={errors.primaryColorHex?.message}
      />

      {/* fe §8 — "renders as a dismissible, non-blocking ContrastWarningBanner
          directly under the picker". Task 17.2. */}
      {contrastWarning && <ContrastWarningBanner message={contrastWarning} onDismiss={() => setContrastWarning(null)} />}

      <BrandingLivePreview primaryColorHex={primaryColorHex} logoUrl={logoUrl || null} />

      {saveError && (
        <p role="alert" className="text-body text-[var(--danger)]">
          {saveError}
        </p>
      )}
      {saveSuccess && (
        <p role="status" className="text-body text-[var(--success)]">
          Branding saved.
        </p>
      )}

      <div>
        <button
          type="submit"
          disabled={isSubmitting || mutation.isPending}
          className="rounded-sm bg-[var(--brand-primary)] p-sm text-body font-semibold text-[#0D0D0D] shadow-button-primary disabled:opacity-60"
        >
          {mutation.isPending ? 'Saving…' : 'Save branding'}
        </button>
      </div>
    </form>
  );
}

// fe §3 route map — `(trainer)/branding`: `PATCH /trainers/:id/branding`
// (api §4.1, FR-071/OQ-7). Trainer-only, own tenant — Super Admin has no
// branding page in Epic-01 scope (impersonation is the intended path for a
// Super Admin to help with branding). Wrapped by `(trainer)/layout.tsx`'s
// RoleGuard(TRAINER), so this leaf doesn't re-guard. Task 17.1.
export default function BrandingPage() {
  const { data, isLoading } = useBootstrap();

  if (isLoading || !data) {
    return (
      <section className="p-lg" aria-busy="true" aria-label="Loading branding settings">
        <SkeletonCard />
      </section>
    );
  }

  if (!hasTrainerBrandingBootstrap(data)) {
    return null;
  }

  return (
    <section className="flex flex-col gap-lg p-lg">
      <h1 className="text-xl font-semibold text-[var(--text-primary)]">Branding</h1>
      <BrandingForm
        trainerId={data.trainerProfile.id}
        initialLogoUrl={data.branding.logoUrl}
        initialPrimaryColorHex={data.branding.primaryColorHex}
      />
    </section>
  );
}
