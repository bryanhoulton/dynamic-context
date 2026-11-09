// Aggregate microphone samples into 100 ms mono PCM16 chunks for the voice service.
class MicCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Int16Array(1600);
    this.index = this.phase = this.total = this.count = 0;
  }
  process(inputs) {
    for (const sample of inputs[0]?.[0] ?? []) {
      this.total += sample;
      this.count++;
      this.phase += 16000;
      if (this.phase < sampleRate) continue;
      this.phase -= sampleRate;
      this.buffer[this.index++] = Math.round(
        Math.max(-1, Math.min(1, this.total / this.count)) * 32767,
      );
      this.total = this.count = 0;
      if (this.index === this.buffer.length) {
        this.port.postMessage(this.buffer.buffer, [this.buffer.buffer]);
        this.buffer = new Int16Array(1600);
        this.index = 0;
      }
    }
    return true;
  }
}
registerProcessor('mic-capture', MicCapture);
