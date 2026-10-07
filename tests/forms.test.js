import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseNumber } from '../ui/forms.js';

test('parseNumber: الأرقام العربية وفواصل الآلاف والفاصلة العشرية', () => {
  assert.equal(parseNumber('٤٬٢٠٠'), 4200);
  assert.equal(parseNumber('1,300'), 1300);
  assert.equal(parseNumber('970.96'), 970.96);
  assert.equal(parseNumber('٩٧٠٫٩٦'), 970.96);
  assert.equal(parseNumber(' 500 ر.س '), 500);
  assert.equal(parseNumber(''), null);
  assert.ok(Number.isNaN(parseNumber('1.2.3')));
});
