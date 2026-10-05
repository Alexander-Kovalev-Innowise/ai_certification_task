import { test, expect, highlight, shell, createTrainer, createCoach, nextDateOnWeekday, type CoachFixture, type TrainerFixture } from '../support/test';
import type { ApiClient } from '../support/api';
import type { Page } from '@playwright/test';

/**
 * US-01.10 - Coach sets My Times (weekly availability) + trainer assignment conflict flow.
 * Note (documented in the app): events do not exist until Epic-02, so "assign to event" is the trainer's
 * "Check availability / Assign to session" modal on the Coaches roster; "request change" is out of scope.
 */
test.describe('US-01.10: Coach sets My Times and the trainer assignment conflict flow', () => {
  const MONDAY = 1;
  const SATURDAY = 6;

  /** Coach is available Monday 16:00-18:00 and 19:00-21:00 (set through the API for the trainer-side tests). */
  async function setMondayEvening(api: ApiClient, coach: CoachFixture) {
    const res = await api.put(`/coaches/${coach.coachId}/availability`, {
      auth: coach.session,
      body: {
        slots: [
          { dayOfWeek: MONDAY, startTime: 16 * 60, endTime: 18 * 60, isAvailable: true },
          { dayOfWeek: MONDAY, startTime: 19 * 60, endTime: 21 * 60, isAvailable: true },
        ],
      },
    });
    expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);
  }

  async function openAssignModal(page: Page, trainer: TrainerFixture, coach: CoachFixture, loginAs: (e: string, p: string) => Promise<void>) {
    await loginAs(trainer.email, trainer.password);
    await shell(page).goTo('Coaches');
    const row = page.getByRole('table', { name: 'Coach roster' }).getByRole('row').filter({ hasText: coach.email });
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: new RegExp(`^Check availability / Assign .* to session$`) }).click();
    const dialog = page.getByRole('dialog', { name: `Assign ${coach.firstName} ${coach.lastName} to a session` });
    await expect(dialog).toBeVisible();
    return dialog;
  }

  test('coach sets several weekly slots (two on Monday) and they persist; invalid ranges are rejected', async ({ page, api, mailbox, narrate, loginAs }) => {
    const trainer = await createTrainer(api, mailbox);
    const coach = await createCoach(api, mailbox, trainer);

    await narrate('Coach signs in - the dashboard nudges them to set availability');
    await loginAs(coach.email, coach.password);
    await expect(page.getByText("You haven't set your availability yet.")).toBeVisible();
    await highlight(page.getByRole('link', { name: 'Set your availability' }));

    await narrate('Click through to My Times');
    await page.getByRole('link', { name: 'Set your availability' }).click();
    await expect(page.getByRole('heading', { name: 'My Times', level: 1 })).toBeVisible();

    const addTime = page.getByRole('button', { name: '+ Add time' });
    await narrate('Monday: first slot 4:00 PM - 6:00 PM');
    await addTime.nth(MONDAY).click();
    await page.getByLabel('Mon start').first().fill('16:00');
    await page.getByLabel('Mon end').first().fill('18:00');

    await narrate('Monday: a SECOND slot 7:00 PM - 9:00 PM on the same day');
    await addTime.nth(MONDAY).click();
    await page.getByLabel('Mon start').nth(1).fill('19:00');
    await page.getByLabel('Mon end').nth(1).fill('21:00');

    await narrate('Saturday: 9:00 AM - 12:00 PM');
    await addTime.nth(SATURDAY).click();
    await page.getByLabel('Sat start').fill('09:00');
    await page.getByLabel('Sat end').fill('12:00');

    await narrate('A slot that ends before it starts is rejected on save');
    await addTime.nth(3).click(); // Wednesday
    await page.getByLabel('Wed start').fill('15:00');
    await page.getByLabel('Wed end').fill('14:00');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    const rangeError = page.getByRole('alert').filter({ hasText: 'Start time must be before end time.' });
    await expect(rangeError).toBeVisible();
    await highlight(rangeError);
    await expect(page.getByText('Availability saved.')).toHaveCount(0);

    await narrate('Remove the bad slot and save');
    await page.getByLabel('Wed end').locator('xpath=following-sibling::button[contains(., "Remove")]').click();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    const saved = page.getByRole('status').filter({ hasText: 'Availability saved.' });
    await expect(saved).toBeVisible();
    await highlight(saved);

    await narrate('After a reload the saved schedule is still there (stored in the system)');
    await page.reload();
    await expect(page.getByLabel('Mon start')).toHaveCount(2);
    await expect(page.getByLabel('Mon start').first()).toHaveValue('16:00');
    await expect(page.getByLabel('Mon end').first()).toHaveValue('18:00');
    await expect(page.getByLabel('Mon start').nth(1)).toHaveValue('19:00');
    await expect(page.getByLabel('Mon end').nth(1)).toHaveValue('21:00');
    await expect(page.getByLabel('Sat start')).toHaveValue('09:00');
    await expect(page.getByLabel('Wed start')).toHaveCount(0);
    await highlight(page.getByLabel('Mon start').first());

    await narrate('The dashboard nudge is gone now that availability is set');
    await shell(page).goTo('Dashboard');
    await expect(page.getByRole('heading', { name: `Welcome, ${coach.firstName}` })).toBeVisible();
    await expect(page.getByText("You haven't set your availability yet.")).toHaveCount(0);
    await expect(page.getByText('Weekly availability slots')).toBeVisible();
  });

  test('trainer check: an available time is confirmed, a conflicting time warns and needs a reason to assign anyway', async ({
    page,
    api,
    mailbox,
    narrate,
    loginAs,
  }) => {
    const trainer = await createTrainer(api, mailbox);
    const coach = await createCoach(api, mailbox, trainer);
    await setMondayEvening(api, coach);
    const coachName = `${coach.firstName} ${coach.lastName}`;
    const monday = nextDateOnWeekday(MONDAY);

    await narrate('Trainer opens "Check availability / Assign to session" for the coach');
    const dialog = await openAssignModal(page, trainer, coach, loginAs);

    await narrate('Validation: date and times are required');
    await dialog.getByRole('button', { name: 'Check availability' }).click();
    await expect(dialog.getByText('Choose the session date.')).toBeVisible();
    await expect(dialog.getByText('Choose a start time.')).toBeVisible();

    await narrate('A time inside the coach\'s schedule (Monday 4:30-5:30 PM) is fine');
    await dialog.getByLabel('Session label (optional)').fill('U12 shooting drill');
    await dialog.getByLabel('Session date').fill(monday);
    await dialog.getByLabel('Start time').fill('16:30');
    await dialog.getByLabel('End time').fill('17:30');
    await dialog.getByRole('button', { name: 'Check availability' }).click();
    const ok = dialog.getByRole('status').filter({ hasText: `${coachName} is available at this time per their schedule.` });
    await expect(ok).toBeVisible();
    await highlight(ok);

    await narrate('Check another time: Monday 10:00-11:00 AM is outside the schedule');
    await dialog.getByRole('button', { name: 'Check another time' }).click();
    await dialog.getByLabel('Session label (optional)').fill('Morning clinic');
    await dialog.getByLabel('Session date').fill(monday);
    await dialog.getByLabel('Start time').fill('10:00');
    await dialog.getByLabel('End time').fill('11:00');
    await dialog.getByRole('button', { name: 'Check availability' }).click();

    const warning = dialog.getByRole('alert').filter({ hasText: `Coach ${coachName} is not available at this time per their schedule. Continue anyway?` });
    await expect(warning).toBeVisible();
    await highlight(warning);

    await narrate('Overriding requires a reason');
    await dialog.getByRole('button', { name: 'Assign anyway' }).click();
    const reasonError = dialog.getByText('Please give a reason (at least 5 characters).');
    await expect(reasonError).toBeVisible();
    await highlight(reasonError);

    await narrate('Enter a reason and assign anyway - the override is logged and the coach is notified');
    await dialog.getByLabel('Reason for assigning anyway').fill('Emergency cover - coach agreed by phone');
    await dialog.getByRole('button', { name: 'Assign anyway' }).click();
    await expect(dialog).toBeHidden();
    const toast = page.getByRole('status').filter({ hasText: `${coachName} was assigned anyway. The override was logged and the coach has been notified.` });
    await expect(toast).toBeVisible();
    await highlight(toast);

    await narrate('The coach receives an email about the scheduling despite the conflict');
    const mail = await mailbox.waitFor(coach.email, { subject: /scheduled you despite an availability conflict/i });
    expect(mail.text + mail.html).toContain('Emergency cover - coach agreed by phone');
  });

  test('coach sees the override notice (not blocked) with the trainer\'s reason and can acknowledge it', async ({ page, api, mailbox, narrate, loginAs }) => {
    const trainer = await createTrainer(api, mailbox);
    const coach = await createCoach(api, mailbox, trainer);
    await setMondayEvening(api, coach);
    const reason = 'Another coach cancelled - need you for the camp';

    // Arrange the override through the same API the trainer modal calls.
    const override = await api.post(`/coaches/${coach.coachId}/availability/override`, {
      auth: trainer.session,
      body: { eventId: crypto.randomUUID(), reason, sessionLabel: 'Holiday camp (Mon 10:00-11:00)' },
    });
    expect(override.status, JSON.stringify(override.body)).toBeLessThan(300);

    await narrate('Coach signs in and opens My Times');
    await loginAs(coach.email, coach.password);
    await shell(page).goTo('My Times');
    await expect(page.getByRole('heading', { name: 'My Times', level: 1 })).toBeVisible();

    await narrate('A "Schedule overrides" card shows the assignment, the trainer and the reason');
    const card = page.getByRole('heading', { name: 'Schedule overrides' });
    await expect(card).toBeVisible();
    await expect(page.getByText('Holiday camp (Mon 10:00-11:00)')).toBeVisible();
    await expect(page.getByText(`${trainer.businessName}: ${reason}`)).toBeVisible();
    await highlight(page.getByText(`${trainer.businessName}: ${reason}`));

    await narrate('The coach acknowledges the assignment');
    await page.getByRole('button', { name: 'Acknowledge' }).click();
    await expect(page.getByText('Acknowledged', { exact: true })).toBeVisible();
    await highlight(page.getByText('Acknowledged', { exact: true }));
  });
});
