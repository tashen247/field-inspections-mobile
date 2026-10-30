import { zodResolver } from '@hookform/resolvers/zod';
import { Ionicons } from '@expo/vector-icons';
import { loginBodySchema, type LoginBody } from '@fim/shared';
import { router } from 'expo-router';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { KeyboardAvoidingView, Platform, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { Button, Card, Screen, Text, TextField } from '../components/ui';
import { claimDevice } from '../db/repo';
import { ApiError, NetworkError } from '../lib/api';
import { useAuth } from '../lib/auth-store';
import { getServices } from '../services';
import { useTheme } from '../theme';

export default function Login() {
  const t = useTheme();
  const [error, setError] = useState<string | null>(null);
  const { control, handleSubmit, formState } = useForm<LoginBody>({
    resolver: zodResolver(loginBodySchema),
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = handleSubmit(async ({ email, password }) => {
    setError(null);
    try {
      const { api, db } = getServices();
      const res = await api.login(email, password);
      const claim = claimDevice(db, res.user.id);
      if (!claim.ok) {
        setError(claim.reason);
        return;
      }
      await useAuth.getState().signIn({
        accessToken: res.accessToken,
        refreshToken: res.refreshToken,
        user: res.user,
      });
      router.replace('/');
    } catch (err) {
      setError(
        err instanceof NetworkError
          ? 'No connection. You need signal to sign in the first time.'
          : err instanceof ApiError
            ? err.message
            : 'Could not sign in',
      );
    }
  });

  return (
    <Screen edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1, justifyContent: 'center', gap: 24 }}
      >
        <Animated.View entering={FadeInDown.duration(500)} style={{ alignItems: 'center', gap: 8 }}>
          <View
            style={{
              width: 72,
              height: 72,
              borderRadius: 20,
              backgroundColor: t.colors.primary,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons name="clipboard-outline" size={38} color={t.colors.primaryText} />
          </View>
          <Text variant="title">Field Inspections</Text>
          <Text variant="muted">Vehicle and property assessments, online or off.</Text>
        </Animated.View>
        <Animated.View entering={FadeInDown.delay(120).duration(500)}>
          <Card style={{ gap: 16 }}>
            <Controller
              control={control}
              name="email"
              render={({ field, fieldState }) => (
                <TextField
                  label="Email"
                  autoCapitalize="none"
                  autoComplete="email"
                  keyboardType="email-address"
                  textContentType="username"
                  value={field.value}
                  onChangeText={field.onChange}
                  onBlur={field.onBlur}
                  error={fieldState.error?.message}
                />
              )}
            />
            <Controller
              control={control}
              name="password"
              render={({ field, fieldState }) => (
                <TextField
                  label="Password"
                  secureTextEntry
                  autoComplete="password"
                  textContentType="password"
                  value={field.value}
                  onChangeText={field.onChange}
                  onBlur={field.onBlur}
                  onSubmitEditing={() => void onSubmit()}
                  error={fieldState.error?.message}
                />
              )}
            />
            {error ? (
              <Text color={t.colors.danger} accessibilityRole="text">
                {error}
              </Text>
            ) : null}
            <Button
              title="Sign in"
              icon="log-in-outline"
              onPress={() => void onSubmit()}
              loading={formState.isSubmitting}
            />
          </Card>
        </Animated.View>
      </KeyboardAvoidingView>
    </Screen>
  );
}
