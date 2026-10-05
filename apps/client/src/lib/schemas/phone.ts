import { isValidPhoneNumber } from 'libphonenumber-js/max';
import { z } from 'zod';

// Same validator the server's @IsPhoneNumber() uses (class-validator ->
// libphonenumber-js/max), so the client never accepts what the API rejects.
export const INVALID_PHONE_MESSAGE = 'Enter a valid phone number for the selected country.';

export const requiredPhoneSchema = z
  .string()
  .min(1, 'Phone number is required.')
  .refine((value) => isValidPhoneNumber(value), INVALID_PHONE_MESSAGE);

export const optionalPhoneSchema = z
  .string()
  .optional()
  .refine((value) => !value || isValidPhoneNumber(value), INVALID_PHONE_MESSAGE);
