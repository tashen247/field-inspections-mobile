import type { Diagram, Severity } from '@fim/shared';
import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { Pressable, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { ZoomIn } from 'react-native-reanimated';
import Svg, { Circle, G, Line, Path, Rect, Text as SvgText } from 'react-native-svg';
import { scheduleOnRN } from 'react-native-worklets';
import { severityColor, useTheme } from '../../theme';

export interface DiagramPin {
  id: string;
  x: number;
  y: number;
  severity: Severity;
  note: string | null;
}

export const DIAGRAM_ASPECT: Record<Diagram, number> = {
  'vehicle-top': 0.55, // width / height
  'floor-plan': 1.4,
};

/** Top-down car outline in a 100 × 182 box. */
function VehicleOutline({ stroke, fill }: { stroke: string; fill: string }) {
  return (
    <G stroke={stroke} strokeWidth={1.2} fill="none">
      <Path
        d="M30 6 Q50 0 70 6 Q86 12 88 34 L90 150 Q88 172 70 177 Q50 182 30 177 Q12 172 10 150 L12 34 Q14 12 30 6 Z"
        fill={fill}
      />
      <Path d="M22 50 Q50 40 78 50 L74 72 Q50 66 26 72 Z" />
      <Path d="M26 128 Q50 134 74 128 L78 146 Q50 154 22 146 Z" />
      <Rect x={26} y={74} width={48} height={52} rx={6} />
      <Line x1={10} y1={98} x2={26} y2={98} />
      <Line x1={74} y1={98} x2={90} y2={98} />
      <Rect x={2} y={28} width={8} height={22} rx={3} fill={stroke} />
      <Rect x={90} y={28} width={8} height={22} rx={3} fill={stroke} />
      <Rect x={2} y={130} width={8} height={22} rx={3} fill={stroke} />
      <Rect x={90} y={130} width={8} height={22} rx={3} fill={stroke} />
      <SvgText x={50} y={20} fontSize={7} fill={stroke} stroke="none" textAnchor="middle">
        FRONT
      </SvgText>
      <SvgText x={50} y={168} fontSize={7} fill={stroke} stroke="none" textAnchor="middle">
        REAR
      </SvgText>
    </G>
  );
}

/** Generic three-bedroom floor plan in a 140 × 100 box. */
function FloorPlan({ stroke, fill }: { stroke: string; fill: string }) {
  const label = (x: number, y: number, t: string) => (
    <SvgText x={x} y={y} fontSize={5} fill={stroke} stroke="none" textAnchor="middle">
      {t}
    </SvgText>
  );
  return (
    <G stroke={stroke} strokeWidth={1} fill="none">
      <Rect x={4} y={4} width={132} height={92} fill={fill} strokeWidth={2} />
      <Line x1={52} y1={4} x2={52} y2={60} />
      <Line x1={4} y1={60} x2={136} y2={60} />
      <Line x1={92} y1={4} x2={92} y2={60} />
      <Line x1={72} y1={60} x2={72} y2={96} />
      <Line x1={110} y1={60} x2={110} y2={96} />
      {label(28, 33, 'BEDROOM 1')}
      {label(72, 33, 'BEDROOM 2')}
      {label(114, 33, 'BEDROOM 3')}
      {label(38, 80, 'LOUNGE / KITCHEN')}
      {label(91, 80, 'BATHROOM')}
      {label(123, 80, 'GARAGE')}
    </G>
  );
}

export function DamageDiagram({
  diagram,
  pins,
  selectedId,
  readOnly,
  onAdd,
  onSelect,
  onMove,
}: {
  diagram: Diagram;
  pins: DiagramPin[];
  selectedId?: string | null;
  readOnly?: boolean;
  onAdd?: (x: number, y: number) => void;
  onSelect?: (id: string) => void;
  onMove?: (id: string, x: number, y: number) => void;
}) {
  const t = useTheme();
  const [size, setSize] = useState({ w: 0, h: 0 });
  const onLayout = (e: LayoutChangeEvent) =>
    setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height });

  const add = (x: number, y: number) => {
    if (!size.w || !size.h) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onAdd?.(clamp(x / size.w), clamp(y / size.h));
  };
  const tap = Gesture.Tap()
    .enabled(!readOnly)
    .onEnd((e) => {
      scheduleOnRN(add, e.x, e.y);
    });

  const box = diagram === 'vehicle-top' ? '0 0 100 182' : '0 0 140 100';
  return (
    <GestureDetector gesture={tap}>
      <View
        onLayout={onLayout}
        accessibilityLabel={`${diagram === 'vehicle-top' ? 'Vehicle' : 'Floor plan'} diagram with ${pins.length} damage pins${readOnly ? '' : '. Tap to add a pin.'}`}
        style={[
          styles.wrap,
          {
            width: diagram === 'vehicle-top' ? '62%' : '100%',
            aspectRatio: DIAGRAM_ASPECT[diagram],
            backgroundColor: t.colors.surface,
            borderColor: t.colors.border,
          },
        ]}
      >
        <Svg width="100%" height="100%" viewBox={box} preserveAspectRatio="none">
          {diagram === 'vehicle-top' ? (
            <VehicleOutline stroke={t.colors.textMuted} fill={t.colors.surfaceAlt} />
          ) : (
            <FloorPlan stroke={t.colors.textMuted} fill={t.colors.surfaceAlt} />
          )}
        </Svg>
        {pins.map((p, i) => (
          <PinMarker
            key={p.id}
            pin={p}
            index={i + 1}
            size={size}
            selected={p.id === selectedId}
            readOnly={readOnly}
            onSelect={onSelect}
            onMove={onMove}
          />
        ))}
      </View>
    </GestureDetector>
  );
}

function PinMarker({
  pin,
  index,
  size,
  selected,
  readOnly,
  onSelect,
  onMove,
}: {
  pin: DiagramPin;
  index: number;
  size: { w: number; h: number };
  selected: boolean;
  readOnly?: boolean | undefined;
  onSelect?: ((id: string) => void) | undefined;
  onMove?: ((id: string, x: number, y: number) => void) | undefined;
}) {
  const R = 14;
  const [drag, setDrag] = useState<{ dx: number; dy: number } | null>(null);
  const commit = (dx: number, dy: number) => {
    setDrag(null);
    if (!size.w || !size.h) return;
    onMove?.(pin.id, clamp(pin.x + dx / size.w), clamp(pin.y + dy / size.h));
  };
  const pan = Gesture.Pan()
    .enabled(!readOnly && selected)
    .onUpdate((e) => {
      scheduleOnRN(setDrag, { dx: e.translationX, dy: e.translationY });
    })
    .onEnd((e) => {
      scheduleOnRN(commit, e.translationX, e.translationY);
    });
  const left = pin.x * size.w - R + (drag?.dx ?? 0);
  const top = pin.y * size.h - R + (drag?.dy ?? 0);
  return (
    <GestureDetector gesture={pan}>
      <Animated.View entering={ZoomIn.springify()} style={[styles.pin, { left, top }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Damage pin ${index}, ${pin.severity}${pin.note ? `: ${pin.note}` : ''}`}
          onPress={() => onSelect?.(pin.id)}
          hitSlop={8}
        >
          <Svg width={R * 2} height={R * 2}>
            <Circle
              cx={R}
              cy={R}
              r={R - 2}
              fill={severityColor[pin.severity]}
              stroke={selected ? '#fff' : 'rgba(0,0,0,0.35)'}
              strokeWidth={selected ? 3 : 1.5}
            />
            <SvgText x={R} y={R + 4} fontSize={11} fontWeight="700" fill="#111" textAnchor="middle">
              {index}
            </SvgText>
          </Svg>
        </Pressable>
      </Animated.View>
    </GestureDetector>
  );
}

function clamp(v: number) {
  return Math.max(0, Math.min(1, v));
}

const styles = StyleSheet.create({
  wrap: { borderRadius: 16, borderWidth: 1, overflow: 'hidden', alignSelf: 'center' },
  pin: { position: 'absolute' },
});
