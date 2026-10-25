import { expect, it } from 'vitest';
import {
  decodeToolbarSequence,
  splitToolbarSequenceSegments,
} from '../components/terminal/mobileKeyboardPresets';
import { describeToolbarSequence, encodeToolbarText } from './toolbarCustomization';

it.each([String.raw`C:\new\test`, String.raw`literal \u001b[A`, 'one || two', '你好\nworld', '\t'])(
  'round-trips literal text without turning it into key codes or steps: %s',
  (text) => {
    const encoded = encodeToolbarText(text);
    expect(splitToolbarSequenceSegments(encoded)).toEqual([encoded]);
    expect(decodeToolbarSequence(encoded)).toBe(text);
    if (describeToolbarSequence(encoded).kind === 'text')
      expect(describeToolbarSequence(encoded).value).toBe(text);
  },
);
it('keeps existing escaped shortcuts and segmented commands working', () => {
  expect(decodeToolbarSequence('\\u001b[1;2D')).toBe('\x1b[1;2D');
  expect(decodeToolbarSequence('/undo\\r')).toBe('/undo\r');
  expect(splitToolbarSequenceSegments('/||undo ||\\r').map(decodeToolbarSequence)).toEqual([
    '/',
    'undo ',
    '\r',
  ]);
  expect(describeToolbarSequence('/undo\\r')).toMatchObject({
    kind: 'text',
    value: '/undo',
    enter: true,
  });
});
