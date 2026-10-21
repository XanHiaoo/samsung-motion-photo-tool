const test = require('node:test');
const assert = require('node:assert/strict');
const { atPosition, moveHandle, nearestHandle } = require('../src/components/range-slider/range');

function component(t, properties = {}) {
  const original = global.Component;
  let definition;
  global.Component = value => { definition = value; };
  const modulePath = require.resolve('../src/components/range-slider/index');
  delete require.cache[modulePath]; require(modulePath);
  global.Component = original;
  t.after(() => { delete require.cache[modulePath]; });
  const events = [], queries = [];
  const instance = { ...definition.methods, properties: { duration: 10, start: 0, end: 10, disabled: false, ...properties },
    data: { ...definition.data },
    setData(value) { Object.assign(this.data, value); },
    triggerEvent(name, detail) { events.push({ name, ...detail }); },
    createSelectorQuery() { const query = { select() { return query; }, boundingClientRect() { return query; }, exec(fn) { queries.push(fn); } }; return query; },
  };
  const measure = (bounds = { left: 100, width: 400 }) => queries.shift()([bounds]);
  return { instance, definition, events, measure };
}
const touch = (x, edge, identifier = 1) => ({ currentTarget: { dataset: { edge } }, changedTouches: [{ identifier, clientX: x }] });

test('one range maps positions to time, selects the nearest grip and prevents crossing', () => {
  assert.equal(atPosition(50, {left:100,width:400}, 10), 0);
  assert.equal(atPosition(600, {left:100,width:400}, 10), 10);
  assert.equal(atPosition(150, {left:100,width:400}, 10), 1.25);
  assert.equal(atPosition(150, {left:100,width:0}, 10), null);
  assert.equal(atPosition(150, {width:400}, 10), null);
  assert.equal(nearestHandle(3, {start:1,end:8}), 'start');
  assert.equal(nearestHandle(4, {start:1,end:7}, 'end'), 'end');
  assert.deepEqual(moveHandle({start:1,end:8}, 'start', 9, 10), {start:7.9,end:8,duration:8-7.9});
  assert.equal(moveHandle({start:1,end:8}, 'end', -1, 10).end, 1.1);
  assert.equal(moveHandle({start:0,end:0.04}, 'end', 0, 0.04).end, 0.04);
});

test('dragging a handle emits a continuous range and one final change on the same rail', t => {
  const { instance, events, measure } = component(t);
  instance.onTouchStart(touch(100, 'start')); measure();
  instance.onTouchMove(touch(200)); instance.onTouchEnd(touch(200));
  assert.equal(events.at(-1).name, 'change');
  assert.equal(events.at(-1).start, 2.5);
  assert.equal(events.at(-1).end, 10);
  assert.equal(events.filter(e => e.name === 'change').length, 1);
  assert.equal(instance.data.startPercent, 25);
  assert.equal(instance.data.widthPercent, 75);
  assert.equal(instance.drag, null);
});

test('grabbing the side of a grip preserves the finger offset without jumping', t => {
  const { instance, events, measure } = component(t, {start:2,end:8});
  instance.onTouchStart(touch(190, 'start')); measure();
  assert.equal(events.at(-1).start, 2);
  instance.onTouchMove(touch(210)); instance.onTouchEnd(touch(210));
  assert.equal(events.at(-1).start, 2.5);
});

test('rail tap jumps the closest endpoint and touch end can arrive before measurement', t => {
  const { instance, events, measure } = component(t, {start:1,end:9});
  instance.onTouchStart(touch(420));
  instance.onTouchEnd(touch(420)); measure();
  assert.equal(events.at(-1).end, 8);
  assert.equal(events.at(-1).edge, 'end');
  assert.equal(instance.drag, null);
});

test('a narrow selection still moves the handle that was grabbed', t => {
  const { instance, events, measure } = component(t, {start:2,end:2.2});
  instance.onTouchStart(touch(190, 'start')); measure();
  instance.onTouchMove(touch(150)); instance.onTouchEnd(touch(150));
  assert.equal(events.at(-1).edge, 'start');
  assert.equal(events.at(-1).start, 1);
  assert.equal(events.at(-1).end, 2.2);
});

test('second fingers cannot steal a drag; cancellation commits the last visible selection', t => {
  const { instance, events, measure } = component(t);
  instance.onTouchStart(touch(100, 'start')); measure();
  instance.onTouchStart(touch(490, 'end', 2));
  instance.onTouchMove(touch(300, undefined, 2));
  instance.onTouchEnd(touch(300, undefined, 2));
  instance.onTouchMove(touch(220));
  instance.onTouchCancel(touch(220));
  assert.equal(events.at(-1).name, 'change');
  assert.equal(events.at(-1).start, 3);
  assert.equal(instance.drag, null);
});

test('disabled or detached sliders ignore late measurements', t => {
  const { instance, definition, events, measure } = component(t);
  instance.onTouchStart(touch(100));
  instance.properties.disabled = true; definition.observers.disabled.call(instance, true); measure();
  instance.onTouchStart(touch(400));
  assert.equal(events.length, 0);
  instance.properties.disabled = false; instance.onTouchStart(touch(400));
  definition.lifetimes.detached.call(instance); measure();
  assert.equal(events.length, 0);
});
