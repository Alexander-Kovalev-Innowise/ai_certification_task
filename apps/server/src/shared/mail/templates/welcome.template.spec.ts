import { buildWelcomeEmailPayload } from './welcome.template';

describe('buildWelcomeEmailPayload', () => {
  it('addresses the mail to the new user and carries only their first name', () => {
    expect(buildWelcomeEmailPayload('new@example.com', { firstName: 'Nina' })).toEqual({
      to: 'new@example.com',
      subject: 'Welcome to PracticePerfect',
      templateData: { firstName: 'Nina' },
    });
  });
});
