// Native modules that have no meaning in a Node test run.
jest.mock('expo-crypto', () => ({ randomUUID: () => require('node:crypto').randomUUID() }));

// Animations are visual only; tests render the same tree without the native runtime.
jest.mock('react-native-worklets', () => ({
  scheduleOnRN: (fn, ...args) => fn(...args),
  runOnJS: (fn) => fn,
}));
jest.mock('react-native-reanimated', () => {
  const RN = require('react-native');
  const builder = () => {
    const b = new Proxy({}, { get: () => () => b });
    return b;
  };
  const animations = ['FadeIn', 'FadeOut', 'FadeInDown', 'ZoomIn', 'LinearTransition'];
  return {
    __esModule: true,
    default: { View: RN.View, Text: RN.Text, FlatList: RN.FlatList, ScrollView: RN.ScrollView },
    ...Object.fromEntries(animations.map((n) => [n, builder()])),
    useSharedValue: (v) => ({ value: v }),
    useAnimatedStyle: (fn) => fn(),
    withSpring: (v) => v,
    withTiming: (v) => v,
    interpolate: (v) => v,
  };
});

// Icon fonts load through the asset system, which tests do not have.
jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native');
  const Icon = ({ name }) => require('react').createElement(Text, null, `[${name}]`);
  return { Ionicons: Icon };
});
