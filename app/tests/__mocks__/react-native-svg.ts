// react-native-svg pulls in RN's internal Touchable mixin, which isn't wired
// up under this project's jsdom/react-native mock combo. Consumers only need
// Svg/Path/Circle etc. as inert host tags for rendering assertions.
const Svg = 'Svg';
const Path = 'Path';
const Circle = 'Circle';

export default Svg;
export { Svg, Path, Circle };
