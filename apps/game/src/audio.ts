export class AudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private enabled: boolean = false;

  constructor() {
    // Only init on user interaction to obey browser autoplay rules
  }

  public init() {
    if (this.ctx) return;
    this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 0.15; // Global volume
    this.masterGain.connect(this.ctx.destination);
    this.enabled = true;
  }

  public playApprove() {
    this.synthTick(800, "sine", 0.05);
    setTimeout(() => this.synthTick(1200, "sine", 0.08), 50);
  }

  public playEscalate() {
    this.synthTick(600, "triangle", 0.1);
    setTimeout(() => this.synthTick(400, "triangle", 0.15), 100);
  }

  public playQuarantine() {
    this.synthTick(200, "square", 0.2);
    setTimeout(() => this.synthTick(150, "sawtooth", 0.3), 150);
  }

  public playAlarm() {
    if (!this.enabled || !this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(300, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(100, this.ctx.currentTime + 0.5);
    gain.gain.setValueAtTime(0.3, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.5);
    osc.connect(gain);
    gain.connect(this.masterGain!);
    osc.start();
    osc.stop(this.ctx.currentTime + 0.5);
  }

  public playMilestone() {
    if (!this.enabled || !this.ctx) return;
    const notes = [440, 554.37, 659.25, 880]; // A Major Arpeggio
    notes.forEach((freq, i) => {
      setTimeout(() => this.synthTick(freq, "sine", 0.2), i * 100);
    });
  }

  private synthTick(freq: number, type: OscillatorType, duration: number) {
    if (!this.enabled || !this.ctx || !this.masterGain) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    
    gain.gain.setValueAtTime(0.3, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + duration);
    
    osc.connect(gain);
    gain.connect(this.masterGain);
    
    osc.start();
    osc.stop(this.ctx.currentTime + duration);
  }
}

export const audio = new AudioEngine();
