export class FakeParam {
  value = 1;
  curves: { curve: Float32Array; start: number; duration: number }[] = [];
  calls: string[] = [];

  cancelScheduledValues() {
    this.calls.push("cancelScheduledValues");
    return this;
  }

  cancelAndHoldAtTime() {
    this.calls.push("cancelAndHoldAtTime");
    return this;
  }

  setValueAtTime(value: number) {
    this.value = value;
    this.calls.push("setValueAtTime");
    return this;
  }

  setValueCurveAtTime(curve: Float32Array, start: number, duration: number) {
    this.curves.push({ curve, start, duration });
    this.value = curve.at(-1)!;
    return this;
  }

  linearRampToValueAtTime(value: number) {
    this.value = value;
    this.calls.push("linearRampToValueAtTime");
    return this;
  }
}

export class FakeGain {
  readonly gain = new FakeParam();

  connect() {
    return this;
  }

  disconnect() {}
}
