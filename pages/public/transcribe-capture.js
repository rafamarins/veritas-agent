// AudioWorkletProcessor runs at the device rate. The output is silent; only
// the first 30 seconds of mono microphone samples are retained.
class DictationCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.samples = new Float32Array(sampleRate * 30);
    this.used = 0;
    this.port.onmessage = () => this.finish();
  }
  finish() {
    if (!this.samples) return;
    const samples = this.samples.subarray(0, this.used);
    this.port.postMessage(samples, [samples.buffer]);
    this.samples = null;
  }
  process(inputs) {
    if (!this.samples) return false;
    const input = inputs[0][0];
    if (input) {
      const count = Math.min(input.length, this.samples.length - this.used);
      this.samples.set(input.subarray(0, count), this.used);
      this.used += count;
      if (this.used === this.samples.length) this.finish();
    }
    return !!this.samples;
  }
}
registerProcessor('veritas-dictation', DictationCapture);
