// react-native-svg pulls in RN's internal Touchable mixin, which isn't wired
// up under this project's jsdom/react-native mock combo. GoogleLogo only
// needs Svg/Path as inert host tags for rendering assertions.
const Svg = 'Svg';
const Path = 'Path';

export default Svg;
export { Svg, Path };
