import { z } from 'zod';
import { roleSchema } from './enums.js';

export const userSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  name: z.string(),
  role: roleSchema,
});
export type User = z.infer<typeof userSchema>;

export const loginBodySchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  password: z.string().min(8).max(200),
});
export type LoginBody = z.input<typeof loginBodySchema>;

export const refreshBodySchema = z.object({
  refreshToken: z.string().min(20),
});
export type RefreshBody = z.infer<typeof refreshBodySchema>;

export const tokenPairSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  /** Access token lifetime in seconds. */
  expiresIn: z.number().int().positive(),
});
export type TokenPair = z.infer<typeof tokenPairSchema>;

export const loginResponseSchema = tokenPairSchema.extend({ user: userSchema });
export type LoginResponse = z.infer<typeof loginResponseSchema>;

export const userListResponseSchema = z.object({ items: z.array(userSchema) });
export type UserListResponse = z.infer<typeof userListResponseSchema>;

export const registerDeviceBodySchema = z.object({
  expoPushToken: z.string().regex(/^Expo(nent)?PushToken\[.+\]$/, 'invalid Expo push token'),
  platform: z.enum(['ios', 'android']),
});
export type RegisterDeviceBody = z.infer<typeof registerDeviceBodySchema>;
