const { atPosition, moveHandle, nearestHandle } = require('./range');

Component({
  properties: {
    duration: { type: Number, value: 0 }, start: { type: Number, value: 0 },
    end: { type: Number, value: 0 }, disabled: { type: Boolean, value: false },
  },
  data: { startPercent: 0, endPercent: 100, widthPercent: 100, activeEdge: '' },
  observers: {
    'duration, start, end': function update(duration, start, end) {
      if (this.drag) return;
      this.paint({ start, end }, duration);
    },
    disabled(value) { if (value) this.cancelDrag(); },
  },
  lifetimes: { detached() { this.drag = null; } },
  methods: {
    paint(range, duration = this.properties.duration) {
      const startPercent = duration > 0 ? Math.max(0, Math.min(100, range.start / duration * 100)) : 0;
      const endPercent = duration > 0 ? Math.max(startPercent, Math.min(100, range.end / duration * 100)) : 100;
      this.setData({ startPercent, endPercent, widthPercent: endPercent - startPercent });
    },
    onTouchStart(event) {
      if (this.properties.disabled || !(this.properties.duration > 0) || this.drag) return;
      const touch = (event.changedTouches || event.touches || [])[0];
      if (!touch || !Number.isFinite(touch.clientX)) return;
      const range = { start: this.properties.start, end: this.properties.end };
      const preferred = event.currentTarget.dataset.edge;
      const drag = { id: touch.identifier, range, lastX: touch.clientX, initialX: touch.clientX,
        preferred, ended: false, canceled: false };
      this.drag = drag;
      this.createSelectorQuery().select('.range-rail').boundingClientRect().exec(result => {
        if (this.drag !== drag || this.properties.disabled) return;
        const bounds = result && result[0];
        const position = atPosition(drag.initialX, bounds, this.properties.duration);
        if (position === null) { this.cancelDrag(); return; }
        drag.bounds = bounds;
        drag.edge = preferred === 'start' || preferred === 'end' ? preferred : nearestHandle(position, range);
        drag.grabOffset = preferred ? drag.initialX - (bounds.left + range[drag.edge] / this.properties.duration * bounds.width) : 0;
        this.setData({ activeEdge: drag.edge });
        // Grabbing a handle keeps its value until movement; a rail tap jumps.
        this.updateDrag(drag.preferred && drag.lastX === drag.initialX ? null : drag.lastX, false);
        if (drag.ended) this.finishDrag(drag.canceled);
      });
    },
    onTouchMove(event) {
      if (!this.drag || this.properties.disabled) return;
      const touch = (event.changedTouches || event.touches || []).find(t => t.identifier === this.drag.id);
      if (!touch || !Number.isFinite(touch.clientX)) return;
      this.drag.lastX = touch.clientX;
      if (this.drag.bounds) this.updateDrag(touch.clientX, false);
    },
    updateDrag(x, final) {
      const drag = this.drag;
      if (!drag || !drag.bounds) return;
      if (x !== null) {
        const seconds = atPosition(x - drag.grabOffset, drag.bounds, this.properties.duration);
        if (seconds !== null) drag.range = moveHandle(drag.range, drag.edge, seconds, this.properties.duration);
      }
      this.paint(drag.range);
      this.triggerEvent(final ? 'change' : 'changing', { start: drag.range.start, end: drag.range.end, edge: drag.edge });
    },
    onTouchEnd(event) {
      if (!this.drag) return;
      const touch = (event.changedTouches || []).find(t => t.identifier === this.drag.id);
      if (!touch) return;
      if (Number.isFinite(touch.clientX)) this.drag.lastX = touch.clientX;
      this.drag.ended = true;
      if (this.drag.bounds) this.finishDrag(false);
    },
    onTouchCancel(event) {
      if (!this.drag) return;
      if (event && event.changedTouches && event.changedTouches.length && !event.changedTouches.some(t => t.identifier === this.drag.id)) return;
      this.drag.ended = true; this.drag.canceled = true;
      if (this.drag.bounds) this.finishDrag(true);
    },
    finishDrag(canceled) {
      // A canceled gesture commits the last visible range so parent and grips agree.
      const drag = this.drag;
      if (!drag) return;
      this.updateDrag(canceled || (drag.preferred && drag.lastX === drag.initialX) ? null : drag.lastX, true);
      this.drag = null; this.setData({ activeEdge: '' });
    },
    cancelDrag() {
      this.drag = null;
      this.setData({ activeEdge: '' });
      this.paint({ start: this.properties.start, end: this.properties.end });
    },
  },
});
