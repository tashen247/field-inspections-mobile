import { Canvas, Fill, Path, useCanvasRef } from '@shopify/react-native-skia';
import { forwardRef, useImperativeHandle, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { Text } from '../../components/ui';

export interface SignaturePadHandle {
  /** PNG bytes of the signature, or null when nothing has been drawn. */
  toPng(): Uint8Array | null;
  clear(): void;
  isEmpty(): boolean;
}

/** Ink on white, drawn with Skia so the exported PNG matches exactly what the client saw. */
export const SignaturePad = forwardRef<SignaturePadHandle, { onChange?: (empty: boolean) => void }>(
  function SignaturePad({ onChange }, ref) {
    const canvas = useCanvasRef();
    const [paths, setPaths] = useState<string[]>([]);
    const [current, setCurrent] = useState<string | null>(null);

    useImperativeHandle(ref, () => ({
      toPng() {
        if (paths.length === 0) return null;
        const image = canvas.current?.makeImageSnapshot();
        return image ? image.encodeToBytes() : null;
      },
      clear() {
        setPaths([]);
        setCurrent(null);
        onChange?.(true);
      },
      isEmpty: () => paths.length === 0,
    }));

    const pan = Gesture.Pan()
      .runOnJS(true)
      .minDistance(0)
      .onBegin((e) => {
        // Strokes are kept as SVG path strings, which Skia renders directly.
        setCurrent(
          `M ${e.x.toFixed(1)} ${e.y.toFixed(1)} L ${(e.x + 0.1).toFixed(1)} ${(e.y + 0.1).toFixed(1)}`,
        );
      })
      .onUpdate((e) => {
        setCurrent((p) => (p ? `${p} L ${e.x.toFixed(1)} ${e.y.toFixed(1)}` : p));
      })
      .onFinalize(() => {
        setCurrent((p) => {
          if (p) {
            setPaths((all) => [...all, p]);
            onChange?.(false);
          }
          return null;
        });
      });

    return (
      <View style={styles.wrap} accessibilityLabel="Signature area. Sign with your finger.">
        <GestureDetector gesture={pan}>
          <Canvas ref={canvas} style={StyleSheet.absoluteFill}>
            <Fill color="white" />
            {[...paths, ...(current ? [current] : [])].map((p, i) => (
              <Path
                key={i}
                path={p}
                color="#10233F"
                style="stroke"
                strokeWidth={3}
                strokeJoin="round"
                strokeCap="round"
              />
            ))}
          </Canvas>
        </GestureDetector>
        {paths.length === 0 && !current ? (
          <View pointerEvents="none" style={styles.placeholder}>
            <Text color="#8A97A6">Sign here</Text>
          </View>
        ) : null}
        <View pointerEvents="none" style={styles.line} />
      </View>
    );
  },
);

const styles = StyleSheet.create({
  wrap: {
    height: 220,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#DCE3E9',
  },
  placeholder: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  line: {
    position: 'absolute',
    left: 24,
    right: 24,
    bottom: 48,
    height: 1,
    backgroundColor: '#C9D2DB',
  },
});
