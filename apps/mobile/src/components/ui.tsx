import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import type { ComponentProps, ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text as RNText,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import { useTheme } from '../theme';

export type IconName = ComponentProps<typeof Ionicons>['name'];

export function Screen({
  children,
  scroll = false,
  edges = ['bottom'],
  padded = true,
}: {
  children: ReactNode;
  scroll?: boolean;
  edges?: Edge[];
  padded?: boolean;
}) {
  const t = useTheme();
  const inner = { padding: padded ? t.spacing(4) : 0, gap: t.spacing(3) };
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.colors.background }} edges={edges}>
      {scroll ? (
        <ScrollView contentContainerStyle={inner} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      ) : (
        <View style={[{ flex: 1 }, inner]}>{children}</View>
      )}
    </SafeAreaView>
  );
}

type Variant = 'title' | 'heading' | 'body' | 'label' | 'muted' | 'caption';

export function Text({
  children,
  variant = 'body',
  style,
  color,
  numberOfLines,
  accessibilityRole,
}: {
  children: ReactNode;
  variant?: Variant;
  style?: StyleProp<TextStyle>;
  color?: string;
  numberOfLines?: number;
  accessibilityRole?: 'header' | 'text';
}) {
  const t = useTheme();
  const v: Record<Variant, TextStyle> = {
    title: { fontSize: t.font.xxl, fontWeight: '700' },
    heading: { fontSize: t.font.lg, fontWeight: '700' },
    body: { fontSize: t.font.md },
    label: { fontSize: t.font.sm, fontWeight: '600' },
    muted: { fontSize: t.font.sm, color: t.colors.textMuted },
    caption: { fontSize: t.font.xs, color: t.colors.textMuted },
  };
  return (
    <RNText
      numberOfLines={numberOfLines}
      accessibilityRole={
        accessibilityRole ?? (variant === 'title' || variant === 'heading' ? 'header' : 'text')
      }
      style={[{ color: t.colors.text }, v[variant], color ? { color } : null, style]}
    >
      {children}
    </RNText>
  );
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  icon,
  loading,
  disabled,
  style,
  accessibilityHint,
}: {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  icon?: IconName;
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityHint?: string;
}) {
  const t = useTheme();
  const bg = {
    primary: t.colors.primary,
    secondary: t.colors.surface,
    danger: t.colors.danger,
    ghost: 'transparent',
  }[variant];
  const fg = {
    primary: t.colors.primaryText,
    secondary: t.colors.text,
    danger: '#fff',
    ghost: t.colors.primary,
  }[variant];
  const off = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!off, busy: !!loading }}
      disabled={off}
      onPress={() => {
        void Haptics.selectionAsync();
        onPress();
      }}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: bg,
          borderRadius: t.radius.md,
          borderColor: variant === 'secondary' ? t.colors.border : 'transparent',
          opacity: off ? 0.5 : pressed ? 0.85 : 1,
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <>
          {icon ? <Ionicons name={icon} size={18} color={fg} /> : null}
          <RNText style={{ color: fg, fontWeight: '600', fontSize: t.font.md }}>{title}</RNText>
        </>
      )}
    </Pressable>
  );
}

export function Card({
  children,
  style,
  onPress,
  accessibilityLabel,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
  accessibilityLabel?: string;
}) {
  const t = useTheme();
  const base: ViewStyle = {
    backgroundColor: t.colors.surface,
    borderRadius: t.radius.lg,
    padding: t.spacing(4),
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: t.colors.border,
    gap: t.spacing(2),
  };
  if (!onPress) return <View style={[base, style]}>{children}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => [base, { opacity: pressed ? 0.9 : 1 }, style]}
    >
      {children}
    </Pressable>
  );
}

export function Badge({ label, color, icon }: { label: string; color: string; icon?: IconName }) {
  return (
    <View
      style={[styles.badge, { backgroundColor: `${color}22`, borderColor: `${color}66` }]}
      accessibilityLabel={label}
    >
      {icon ? <Ionicons name={icon} size={12} color={color} /> : null}
      <RNText style={{ color, fontSize: 12, fontWeight: '700' }}>{label}</RNText>
    </View>
  );
}

export function ProgressBar({ value, color }: { value: number; color?: string }) {
  const t = useTheme();
  const pct = Math.max(0, Math.min(1, value));
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(pct * 100) }}
      style={{
        height: 6,
        borderRadius: 3,
        backgroundColor: t.colors.surfaceAlt,
        overflow: 'hidden',
      }}
    >
      <View
        style={{
          width: `${pct * 100}%`,
          height: '100%',
          backgroundColor: color ?? t.colors.primary,
        }}
      />
    </View>
  );
}

export function EmptyState({
  icon,
  title,
  message,
  action,
}: {
  icon: IconName;
  title: string;
  message?: string;
  action?: ReactNode;
}) {
  const t = useTheme();
  return (
    <Animated.View entering={FadeIn} style={styles.center}>
      <Ionicons name={icon} size={48} color={t.colors.textMuted} />
      <Text variant="heading" style={{ textAlign: 'center' }}>
        {title}
      </Text>
      {message ? (
        <Text variant="muted" style={{ textAlign: 'center' }}>
          {message}
        </Text>
      ) : null}
      {action}
    </Animated.View>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <EmptyState
      icon="cloud-offline-outline"
      title="Something went wrong"
      message={message}
      action={onRetry ? <Button title="Try again" icon="refresh" onPress={onRetry} /> : undefined}
    />
  );
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  const t = useTheme();
  return (
    <View style={styles.center} accessibilityLabel={label}>
      <ActivityIndicator color={t.colors.primary} size="large" />
      <Text variant="muted">{label}</Text>
    </View>
  );
}

export function TextField({
  label,
  error,
  ...props
}: TextInputProps & { label: string; error?: string | undefined }) {
  const t = useTheme();
  return (
    <View style={{ gap: t.spacing(1) }}>
      <Text variant="label">{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={t.colors.textMuted}
        {...props}
        style={[
          {
            borderWidth: 1,
            borderColor: error ? t.colors.danger : t.colors.border,
            borderRadius: t.radius.md,
            paddingHorizontal: t.spacing(3),
            paddingVertical: t.spacing(2.5),
            color: t.colors.text,
            backgroundColor: t.colors.surface,
            fontSize: t.font.md,
          },
          props.multiline ? { minHeight: 88, textAlignVertical: 'top' } : null,
          props.style,
        ]}
      />
      {error ? (
        <Text variant="caption" color={t.colors.danger}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  accessibilityLabel,
}: {
  value: T;
  options: { value: T; label: string; icon?: IconName; color?: string; a11yLabel?: string }[];
  onChange: (v: T) => void;
  accessibilityLabel?: string;
}) {
  const t = useTheme();
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={accessibilityLabel}
      style={{
        flexDirection: 'row',
        backgroundColor: t.colors.surfaceAlt,
        borderRadius: t.radius.md,
        padding: 3,
        gap: 3,
      }}
    >
      {options.map((o) => {
        const active = o.value === value;
        const fg = active ? (o.color ?? t.colors.primary) : t.colors.textMuted;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="radio"
            accessibilityState={{ selected: active }}
            accessibilityLabel={o.a11yLabel ?? o.label}
            onPress={() => {
              void Haptics.selectionAsync();
              onChange(o.value);
            }}
            style={{
              flex: 1,
              flexDirection: 'row',
              gap: 4,
              alignItems: 'center',
              justifyContent: 'center',
              paddingVertical: 8,
              borderRadius: t.radius.sm,
              backgroundColor: active ? t.colors.surface : 'transparent',
            }}
          >
            {o.icon ? <Ionicons name={o.icon} size={16} color={fg} /> : null}
            <RNText style={{ color: fg, fontWeight: active ? '700' : '500' }}>{o.label}</RNText>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Row({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'center', gap: 8 }, style]}>{children}</View>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    minHeight: 48,
    borderWidth: 1,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
});
