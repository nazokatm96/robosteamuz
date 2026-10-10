/* Circuit canvas (SVG): an Arduino Uno plus the parts a project places (see projects.js), and the wires the
   user draws between pins (click/tap one pin, then another; click a wire to remove it).
   Electrical model, kept simple on purpose:
   - Digital: wires, resistors and pressed buttons join nodes into nets; a net is LOW if it touches GND, HIGH if
     it touches 5V, otherwise whatever an OUTPUT pin on it drives, otherwise floating (the input pin then reads
     its own pull-up, see avr-runner.js).
   - LEDs light with the share of time their anode is driven HIGH (so analogWrite() PWM dims them).
   - Analog: A0-A5 read 0 V / 5 V when tied to GND / 5V, and a potentiometer's wiper gives position × 5 V when
     its outer legs go to GND and 5V. No resistance, current or voltage drop is simulated.
   - A buzzer sounds at the frequency its + leg is switched at (tone()), with - on GND.
   - A servo turns to the angle its signal pulse width gives (544 µs = 0° … 2400 µs = 180°), at a real servo's
     speed; it needs 5V and GND. An HC-SR04 answers each trigger pulse with an echo pulse 58.3 µs per cm of the
     distance to its obstacle. An LCD latches RS/D4-D7 into its HD44780 controller on every falling edge of E.
     Those two react within microseconds, in CPU time (runner.pinListeners / runner.after), not once a frame.
   - A 7-segment display (common cathode) lights the segments driven HIGH while its COM reaches GND. */
import { PinState } from './avr-runner.js';
import { HD44780 } from './hd44780.js';

const T = {
  pin: (n) => n + '-pin',
  resistor: 'Rezistor 220 Ω',
  ledA: (c) => c + ' LED anodi (+, uzun oyoq)',
  ledK: (c) => c + ' LED katodi (−, qisqa oyoq)',
  ledColor: { red: 'Qizil', yellow: 'Sariq', green: 'Yashil', blue: 'Ko\'k' },
  btn: 'Tugma',
  btnLeg: (n) => 'Tugma oyog\'i ' + n,
  pot: 'Potentsiometr',
  potLeg: { 3: 'Potentsiometr chap oyog\'i (5V tomoni)', w: 'Potentsiometr o\'rta oyog\'i (signal)', 1: 'Potentsiometr o\'ng oyog\'i (GND tomoni)' },
  potHint: 'Burash uchun suring yoki strelka tugmalarini bosing',
  buzzer: 'Buzzer',
  railHole: (n) => 'GND qatori, ' + n + '-teshik',
  buzzerLeg: { p: 'Buzzer + oyog\'i', n: 'Buzzer − oyog\'i' },
  wire: (a, b) => 'Sim: ' + a + ' — ' + b + '. O\'chirish uchun bosing',
  pressHint: 'Bosib turing',
  warnNoRes: 'LED rezistorsiz ulangan: haqiqiy LED kuyib qolishi mumkin. Oraga rezistor qo\'ying.',
  warnReverse: 'LED teskari ulangan: uzun oyog\'i (+) pin tomonga, qisqasi (−) GND ga qarashi kerak.',
  warnShort: (p) => 'Qisqa tutashuv: ' + p + ' HIGH berayapti, lekin to\'g\'ridan-to\'g\'ri GND ga ulangan.',
  warnPower: (name) => name + ' quvvatga ulanmagan: uning 5V (VCC) oyog\'ini 5V ga, GND oyog\'ini GND ga ulang.',
  servo: 'Servo',
  servoLeg: { sig: 'Servo signal simi (to\'q sariq)', v5: 'Servo 5V simi (qizil)', gnd: 'Servo GND simi (jigarrang)' },
  sonar: 'Ultratovush datchigi',
  sonarPin: { vcc: 'Datchik VCC (5V)', trig: 'Datchik Trig', echo: 'Datchik Echo', gnd: 'Datchik GND' },
  sonarTarget: 'To\'siqgacha masofa',
  sonarHint: 'Masofani o\'zgartirish uchun to\'siqni suring yoki strelka tugmalarini bosing',
  cm: (n) => n + ' sm',
  lcd: 'LCD ekran',
  lcdPin: (n) => 'LCD ' + n,
  seg7: '7-segmentli displey',
  segPin: (s) => 'Displey ' + s + ' segmenti',
  segCom: 'Displey umumiy oyog\'i (COM, katod)',
  ldr: 'Yorug\'lik datchigi',
  ldrPin: { vcc: 'Yorug\'lik datchigi VCC (5V)', gnd: 'Yorug\'lik datchigi GND', ao: 'Yorug\'lik datchigi AO (signal)' },
  light: 'Xonadagi yorug\'lik',
  lightHint: 'Yorug\'likni o\'zgartirish uchun surgichni suring yoki strelka tugmalarini bosing',
  pct: (n) => n + '%',
};

// ---------- board geometry (viewBox 0 0 660 380) ----------
const TOP_Y = 55, BOT_Y = 262;
const TOP = [['gnd1', 'GND', 52], ['13', '13', 70], ['12', '12', 88], ['11', '~11', 106], ['10', '~10', 124], ['9', '~9', 142], ['8', '8', 160],
  ['7', '7', 188], ['6', '~6', 206], ['5', '~5', 224], ['4', '4', 242], ['3', '~3', 260], ['2', '2', 278], ['1', 'TX', 296], ['0', 'RX', 314]];
// Bottom edge, as on a real Uno: power header, then the analog inputs.
const BOT = [['5v', '5V', 184], ['gnd2', 'GND', 212], ['gnd3', 'GND', 240],
  ['a0', 'A0', 272], ['a1', 'A1', 290], ['a2', 'A2', 308], ['a3', 'A3', 326], ['a4', 'A4', 344], ['a5', 'A5', 362]];

const BOARD_PINS = {}; // id -> { x, y, label (for people) }
TOP.forEach(([id, , x]) => { BOARD_PINS['uno.' + id] = { x, y: TOP_Y, label: id.startsWith('gnd') ? 'GND' : T.pin(id) }; });
BOT.forEach(([id, text, x]) => { BOARD_PINS['uno.' + id] = { x, y: BOT_Y, label: text }; });
// Digital pins: D0-D13, then A0-A5 as digital pins 14-19 (as on a real Uno).
const DIGITAL = Array.from({ length: 20 }, (_, d) => d);
const PIN_ID = DIGITAL.map((d) => (d < 14 ? 'uno.' + d : 'uno.a' + (d - 14)));
const pinNo = (id) => PIN_ID.indexOf(id);
const pinName = (d) => T.pin(d < 14 ? d : 'A' + (d - 14));
const ANALOG = [0, 1, 2, 3, 4, 5];
const GND = ['uno.gnd1', 'uno.gnd2', 'uno.gnd3'];
const WIRE_COLORS = ['#3D3BFF', '#FFB020', '#1FBF8F', '#B455E0', '#2FA4E7'];
const LED_COLORS = ['red', 'yellow', 'green', 'blue'];
const POT_SPAN = 270; // knob turns 270°: -135° (0) … +135° (1)
const SERVO_US = [544, 2400];      // Servo library defaults: pulse width for 0° and 180°
const SERVO_DEG_PER_MS = 0.6;      // SG90: about 0.1 s per 60°
const SONAR_CM = [2, 200];         // obstacle range the slider covers (an HC-SR04 measures 2 … 400 cm)
const SONAR_X = [74, 186];         // obstacle position (part-local x) for SONAR_CM[0] … SONAR_CM[1]
const SONAR_DELAY_US = 450;        // trigger falls -> 8 × 40 kHz burst -> echo goes HIGH
const SONAR_US_PER_CM = 58.3;      // sound at 343 m/s, there and back
const LCD_PINS = [['d7', 'D7'], ['d6', 'D6'], ['d5', 'D5'], ['d4', 'D4'], ['e', 'E'], ['rs', 'RS'], ['vcc', 'VCC'], ['gnd', 'GND']];
const LCD_CELL = { x0: 42, y0: 40, dx: 12, dy: 38, w: 11, h: 30 }; // 16×2 character cells on the screen (part-local)
const LIGHT_X = 60;                // light slider runs from -LIGHT_X (dark) to +LIGHT_X (bright), part-local
const SEGMENTS = { a: 'M36 22H68', b: 'M76 30V72', c: 'M76 88V130', d: 'M36 138H68', e: 'M28 88V130', f: 'M28 30V72', g: 'M36 80H68' };
const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

/* ---------- part types ----------
   pins(part): name -> [dx, dy, label] relative to the part's (x, y) before rotation; joined: pin pairs that
   always conduct (in this digital model); pressedJoins: pairs that conduct while a button is held;
   draw(id, part): markup in local coordinates (wrapped in translate(x, y) rotate(rot)). */
const PART_TYPES = {
  resistor: {
    pins: () => ({ 1: [0, 0, T.resistor + ' (1)'], 2: [140, 0, T.resistor + ' (2)'] }),
    joined: [['1', '2']],
    draw: (id, p) => '<g class="part" aria-hidden="true"><line class="leg" x1="0" y1="0" x2="35" y2="0"/><line class="leg" x1="105" y1="0" x2="140" y2="0"/>' +
      '<rect class="res" x="35" y="-12" width="70" height="24" rx="11"/><rect class="band b1" x="48" y="-12" width="6" height="24"/><rect class="band b1" x="62" y="-12" width="6" height="24"/><rect class="band b2" x="76" y="-12" width="6" height="24"/><rect class="band b3" x="90" y="-12" width="4" height="24"/>' +
      // keep the label upright when the resistor stands vertically
      (p.label === '' ? '' : '<text class="part-label" x="70" y="34"' + (p.rot ? ' transform="rotate(' + -p.rot + ' 70 30)"' : '') + '>220 Ω</text>') + '</g>',
  },
  led: {
    pins: (p) => { const c = T.ledColor[p.color || 'red']; return { a: [-12, 84, T.ledA(c)], k: [12, 72, T.ledK(c)] }; },
    draw: (id, p) => {
      const color = LED_COLORS.includes(p.color) ? p.color : 'red';
      return '<g class="part led-part is-' + color + '" data-led="' + id + '" aria-hidden="true"><circle class="led-glow" cx="0" cy="0" r="56" fill="url(#led-glow-' + color + ')"/>' +
        '<line class="leg" x1="-12" y1="30" x2="-12" y2="84"/><line class="leg" x1="12" y1="30" x2="12" y2="72"/>' +
        '<path class="led-body" d="M-20 32 V4 a20 20 0 0 1 40 0 V32 Z"/><path class="led-lit" d="M-20 32 V4 a20 20 0 0 1 40 0 V32 Z"/>' +
        '<rect class="led-rim" x="-24" y="28" width="48" height="7" rx="2"/>' +
        '<text class="part-label" x="-26" y="96">+</text><text class="part-label" x="26" y="84">−</text><text class="part-label" x="0" y="-30">LED</text></g>';
    },
  },
  // Pushbutton. Optional: color (cap colour, e.g. for Simon), label: '' to hide the "Tugma" caption.
  button: {
    pins: () => ({ 1: [-70, 0, T.btnLeg(1)], 2: [70, 0, T.btnLeg(2)] }),
    pressedJoins: [['1', '2']],
    draw: (id, p) => {
      const name = p.color ? T.ledColor[p.color] + ' ' + T.btn.toLowerCase() : T.btn;
      // caption under the button; when it stands upright, beside it (further out, kept horizontal)
      const ly = p.rot ? 66 : 42;
      const label = p.label === '' ? '' : '<text class="part-label" x="0" y="' + ly + '"' + (p.rot ? ' transform="rotate(' + -p.rot + ' 0 ' + (ly - 4) + ')"' : '') + '>' + (p.label || T.btn) + '</text>';
      return '<g class="part" aria-hidden="true"><line class="leg" x1="-70" y1="0" x2="-28" y2="0"/><line class="leg" x1="28" y1="0" x2="70" y2="0"/>' + label + '</g>' +
        '<g class="btn-part' + (p.color ? ' is-' + p.color : '') + '" data-button="' + id + '" tabindex="0" role="button" aria-pressed="false" aria-label="' + name + ' (' + T.pressHint + ')">' +
        '<rect class="btn-base" x="-28" y="-28" width="56" height="56" rx="8"/><circle class="btn-cap" cx="0" cy="0" r="17"/></g>';
    },
  },
  // Breadboard-style GND rail: n holes, `pitch` apart, all connected. Wire one hole to an Arduino GND.
  rail: {
    conductor: true,
    pins: (p) => Object.fromEntries(Array.from({ length: p.n }, (_, i) => [String(i + 1), [i * p.pitch, 0, T.railHole(i + 1)]])),
    joined: (p) => Array.from({ length: p.n - 1 }, (_, i) => [String(i + 1), String(i + 2)]),
    draw: (id, p) => {
      const w = (p.n - 1) * p.pitch;
      return '<g class="part" aria-hidden="true"><rect class="rail-strip" x="-14" y="-10" width="' + (w + 28) + '" height="20" rx="5"/>' +
        '<line class="rail-line" x1="-8" y1="-13" x2="' + (w + 8) + '" y2="-13"/><text class="rail-label" x="-22" y="4">−</text></g>';
    },
  },
  // Rotary potentiometer, legs along the bottom: 3 (left), w (wiper, middle), 1 (right). Turning clockwise moves
  // the wiper towards leg 3, so with 3 on 5V and 1 on GND, clockwise = higher voltage.
  pot: {
    pins: () => ({ 3: [-30, 58, T.potLeg[3]], w: [0, 58, T.potLeg.w], 1: [30, 58, T.potLeg[1]] }),
    draw: (id) => '<g class="part" aria-hidden="true">' +
      '<line class="leg" x1="-30" y1="22" x2="-30" y2="58"/><line class="leg" x1="0" y1="22" x2="0" y2="58"/><line class="leg" x1="30" y1="22" x2="30" y2="58"/>' +
      '<rect class="pot-body" x="-42" y="-34" width="84" height="60" rx="8"/>' +
      '<text class="part-label" x="0" y="-44">' + T.pot + '</text></g>' +
      '<g class="pot-knob" data-pot="' + id + '" tabindex="0" role="slider" aria-label="' + T.pot + '" aria-valuemin="0" aria-valuemax="100" aria-description="' + T.potHint + '">' +
      '<circle class="pot-hit" cx="0" cy="-4" r="30"/><circle class="pot-cap" cx="0" cy="-4" r="22"/>' +
      '<g data-pot-pointer><line class="pot-pointer" x1="0" y1="-4" x2="0" y2="-22"/></g></g>',
  },
  // Passive buzzer: - (left) and + (right) legs along the bottom.
  buzzer: {
    pins: () => ({ n: [-14, 60, T.buzzerLeg.n], p: [14, 60, T.buzzerLeg.p] }),
    draw: (id) => '<g class="part buzzer-part" data-buzzer="' + id + '" aria-hidden="true">' +
      '<path class="bz-wave" d="M44 -22 a30 30 0 0 1 0 36 M56 -32 a44 44 0 0 1 0 56 M-44 -22 a30 30 0 0 0 0 36 M-56 -32 a44 44 0 0 0 0 56"/>' +
      '<line class="leg" x1="-14" y1="28" x2="-14" y2="60"/><line class="leg" x1="14" y1="28" x2="14" y2="60"/>' +
      '<circle class="bz-body" cx="0" cy="-4" r="34"/><circle class="bz-ring" cx="0" cy="-4" r="22"/><circle class="bz-hole" cx="0" cy="-4" r="6"/>' +
      '<text class="bz-plus" x="24" y="-18">+</text>' +
      '<text class="part-label" x="-24" y="74">−</text><text class="part-label" x="24" y="74">+</text><text class="part-label" x="0" y="-48">' + T.buzzer + '</text></g>',
  },
  // Hobby servo (SG90), seen from above. Its cable leaves the left end and ends in three pins, top to bottom:
  // signal, 5V, GND. The horn turns about (30, 0): 0° points right, 90° up, 180° left.
  servo: {
    pins: () => ({ sig: [-100, -20, T.servoLeg.sig], v5: [-100, 0, T.servoLeg.v5], gnd: [-100, 20, T.servoLeg.gnd] }),
    draw: (id) => '<g class="part" aria-hidden="true">' +
      '<rect class="servo-tab" x="-78" y="-8" width="156" height="16" rx="5"/><rect class="servo-body" x="-60" y="-26" width="120" height="52" rx="7"/>' +
      '<path class="servo-cable is-sig" d="M-58 -6C-80 -6 -80 -20 -100 -20"/><path class="servo-cable is-v5" d="M-58 0H-100"/><path class="servo-cable is-gnd" d="M-58 6C-80 6 -80 20 -100 20"/>' +
      '<path class="servo-arc" d="M102 0A72 72 0 0 0 -42 0"/>' +
      '<text class="servo-deg" x="-22" y="6" data-servo-deg="' + id + '">90°</text>' +
      '<g data-servo="' + id + '"><path class="servo-horn" d="M30 -8L92 -5A5 5 0 0 1 92 5L30 8Z"/><circle class="servo-hub" cx="30" cy="0" r="12"/>' +
      '<circle class="servo-hole" cx="60" cy="0" r="2"/><circle class="servo-hole" cx="76" cy="0" r="2"/><circle class="servo-hole" cx="30" cy="0" r="3.5"/></g></g>',
  },
  // HC-SR04 ultrasonic sensor facing right, pins down its left edge (VCC, Trig, Echo, GND as on the real board).
  // The obstacle to its right is dragged (or moved with the arrow keys) to set the distance.
  sonar: {
    pins: () => ({ vcc: [-52, -36, T.sonarPin.vcc], trig: [-52, -12, T.sonarPin.trig], echo: [-52, 12, T.sonarPin.echo], gnd: [-52, 36, T.sonarPin.gnd] }),
    draw: (id) => '<g class="part" aria-hidden="true">' +
      [-36, -12, 12, 36].map((y) => '<line class="leg" x1="-52" y1="' + y + '" x2="-32" y2="' + y + '"/>').join('') +
      '<rect class="sonar-pcb" x="-32" y="-82" width="66" height="164" rx="6"/>' +
      [['VCC', -36], ['Trig', -12], ['Echo', 12], ['GND', 36]].map(([t, y]) => '<text class="part-pin-label" x="-28" y="' + (y + 3) + '">' + t + '</text>').join('') +
      [-42, 42].map((y) => '<circle class="sonar-can" cx="16" cy="' + y + '" r="24"/><circle class="sonar-mesh" cx="16" cy="' + y + '" r="16"/>').join('') +
      '<g class="sonar-waves" data-sonar-waves="' + id + '"><path d="M46 -22A30 30 0 0 1 46 22M58 -34A46 46 0 0 1 58 34"/></g>' +
      '<line class="sonar-ruler" x1="40" y1="96" x2="196" y2="96"/></g>' +
      '<g class="sonar-target" data-sonar="' + id + '" tabindex="0" role="slider" aria-label="' + T.sonarTarget + '" aria-valuemin="' + SONAR_CM[0] +
        '" aria-valuemax="' + SONAR_CM[1] + '" aria-description="' + T.sonarHint + '"><g data-sonar-pos>' +
        '<rect class="sonar-hit" x="-22" y="-84" width="44" height="190"/><rect class="sonar-wall" x="-9" y="-72" width="18" height="144" rx="4"/>' +
        '<path class="sonar-grip" d="M-3 -12V12M3 -12V12"/><text class="sonar-dist" x="0" y="-80" data-sonar-dist>…</text></g></g>',
  },
  // 16x2 character LCD (HD44780) as a module: pins down the left edge (D7 at the top), the screen on the right.
  lcd: {
    pins: () => Object.fromEntries(LCD_PINS.map(([name, label], i) => [name, [-25, 12 + i * 18, T.lcdPin(label)]])),
    draw: (id) => '<g class="part" aria-hidden="true">' +
      LCD_PINS.map((_, i) => '<line class="leg" x1="-25" y1="' + (12 + i * 18) + '" x2="0" y2="' + (12 + i * 18) + '"/>').join('') +
      '<rect class="lcd-pcb" x="0" y="0" width="250" height="150" rx="8"/>' +
      LCD_PINS.map(([, label], i) => '<text class="part-pin-label" x="5" y="' + (15 + i * 18) + '">' + label + '</text>').join('') +
      '<rect class="lcd-bezel" x="32" y="22" width="212" height="100" rx="5"/><rect class="lcd-screen" data-lcd-screen="' + id + '" x="36" y="30" width="204" height="84" rx="3"/>' +
      Array.from({ length: 32 }, (_, i) => '<rect class="lcd-cell" x="' + (LCD_CELL.x0 + (i % 16) * LCD_CELL.dx) + '" y="' + (LCD_CELL.y0 + Math.floor(i / 16) * LCD_CELL.dy) +
        '" width="' + LCD_CELL.w + '" height="' + LCD_CELL.h + '"/>').join('') +
      '<g data-lcd="' + id + '"></g><text class="part-label" x="140" y="142">LCD 16x2</text></g>',
  },
  // One-digit 7-segment display, common cathode: segment pins a-g down the left edge, COM at the bottom.
  seg7: {
    pins: () => Object.assign(Object.fromEntries('abcdefg'.split('').map((s, i) => [s, [-25, 20 + i * 20, T.segPin(s)]])), { com: [45, 186, T.segCom] }),
    draw: (id) => '<g class="part" aria-hidden="true">' +
      'abcdefg'.split('').map((s, i) => '<line class="leg" x1="-25" y1="' + (20 + i * 20) + '" x2="0" y2="' + (20 + i * 20) + '"/>').join('') +
      '<line class="leg" x1="45" y1="160" x2="45" y2="186"/>' +
      '<rect class="seg-body" x="0" y="0" width="100" height="160" rx="8"/>' +
      'abcdefg'.split('').map((s, i) => '<text class="part-pin-label" x="5" y="' + (23 + i * 20) + '">' + s + '</text>').join('') +
      '<g transform="translate(12 0)">' + Object.values(SEGMENTS).map((d) => '<path class="seg-off" d="' + d + '"/>').join('') +
      Object.entries(SEGMENTS).map(([s, d]) => '<path class="seg-on" data-seg="' + id + '.' + s + '" d="' + d + '"/>').join('') + '</g>' +
      '<text class="part-label" x="64" y="182">COM</text></g>',
  },
  // Light sensor module (photoresistor + resistor divider): AO = light × 5 V when powered (brighter = higher).
  // Legs along the bottom: VCC, GND, AO. The slider above it sets how bright the room is (moon … sun).
  ldr: {
    pins: () => ({ vcc: [-24, 58, T.ldrPin.vcc], gnd: [0, 58, T.ldrPin.gnd], ao: [24, 58, T.ldrPin.ao] }),
    draw: (id) => '<g class="part" aria-hidden="true">' +
      [-24, 0, 24].map((x) => '<line class="leg" x1="' + x + '" y1="30" x2="' + x + '" y2="58"/>').join('') +
      '<rect class="ldr-pcb" x="-44" y="-34" width="88" height="64" rx="6"/>' +
      [['VCC', -24], ['GND', 0], ['AO', 24]].map(([t, x]) => '<text class="part-pin-label is-mid" x="' + x + '" y="24">' + t + '</text>').join('') +
      '<circle class="ldr-glow" data-ldr-glow="' + id + '" cx="0" cy="-8" r="26"/><circle class="ldr-cell" cx="0" cy="-8" r="16"/>' +
      '<path class="ldr-track" d="M-9 -16H9V-12H-9V-8H9V-4H-9V0H9"/></g>' +
      '<g class="light-slider" data-light="' + id + '" tabindex="0" role="slider" aria-label="' + T.light + '" aria-valuemin="0" aria-valuemax="100" aria-description="' + T.lightHint + '">' +
        '<rect class="slider-hit" x="' + (-LIGHT_X - 30) + '" y="-112" width="' + (2 * LIGHT_X + 60) + '" height="48"/>' +
        '<line class="light-track" x1="' + -LIGHT_X + '" y1="-82" x2="' + LIGHT_X + '" y2="-82"/>' +
        '<path class="light-moon" d="M' + (-LIGHT_X - 18) + ' -90a9 9 0 1 0 8 13a7 7 0 1 1 -8 -13z"/>' +
        '<circle class="light-sun" cx="' + (LIGHT_X + 18) + '" cy="-82" r="7"/>' +
        '<path class="light-rays" d="M' + (LIGHT_X + 18) + ' -96v4M' + (LIGHT_X + 18) + ' -72v4M' + (LIGHT_X + 4) + ' -82h4M' + (LIGHT_X + 28) + ' -82h4"/>' +
        '<g data-light-pos><circle class="light-knob" cx="0" cy="-82" r="10"/></g>' +
        '<text class="slider-label" x="0" y="-100" data-light-label>…</text></g>',
  },
};
const rotate = ([dx, dy], rot) => (rot === 90 ? [-dy, dx] : rot === 180 ? [-dx, -dy] : rot === 270 ? [dy, -dx] : [dx, dy]);

// ---------- union-find ----------
function nets(ids, pairs) {
  const parent = {};
  const find = (a) => { while (parent[a] !== a) a = parent[a] = parent[parent[a]]; return a; };
  ids.forEach((id) => { parent[id] = id; });
  pairs.forEach(([a, b]) => { parent[find(a)] = find(b); });
  const byRoot = {};
  ids.forEach((id) => { (byRoot[find(id)] = byRoot[find(id)] || []).push(id); });
  const netOf = {};
  Object.values(byRoot).forEach((members) => members.forEach((id) => { netOf[id] = members; }));
  return netOf;
}

function boardMarkup() {
  const topLabels = TOP.map(([, t, x]) => '<text class="hdr-label" x="' + x + '" y="' + (TOP_Y + 22) + '">' + t + '</text>').join('');
  const botLabels = BOT.map(([, t, x]) => '<text class="hdr-label" x="' + x + '" y="' + (BOT_Y - 14) + '">' + t + '</text>').join('');
  return '<g class="uno" aria-hidden="true">' +
      '<rect class="usb" x="6" y="96" width="46" height="54" rx="4"/><rect class="jack" x="6" y="196" width="40" height="46" rx="4"/>' +
      '<rect class="mcu" x="20" y="30" width="356" height="256" rx="14"/>' +
      '<rect class="hdr" x="41" y="' + (TOP_Y - 10) + '" width="130" height="20" rx="3"/><rect class="hdr" x="177" y="' + (TOP_Y - 10) + '" width="148" height="20" rx="3"/>' +
      '<rect class="hdr" x="172" y="' + (BOT_Y - 10) + '" width="80" height="20" rx="3"/><rect class="hdr" x="261" y="' + (BOT_Y - 10) + '" width="112" height="20" rx="3"/>' +
      topLabels + botLabels +
      '<text class="brand" x="86" y="150">UNO</text><text class="brand-sub" x="88" y="168">RoboSTEAM</text>' +
      '<rect class="chip" x="170" y="176" width="150" height="44" rx="4"/><text class="chip-label" x="245" y="203">ATmega328P</text>' +
      '<g class="board-led" data-l><rect x="100" y="98" width="14" height="8" rx="2"/><text class="hdr-label" x="107" y="120">L</text></g>' +
      '<g class="board-led is-power" data-on><rect x="290" y="112" width="14" height="8" rx="2"/><text class="hdr-label" x="297" y="134">ON</text></g>' +
    '</g>';
}

const GLOWS = { red: ['#FF4B3A', '#FF6B57'], yellow: ['#FFD23F', '#FFE27A'], green: ['#3DF2B0', '#6BF7C6'], blue: ['#3D8BFF', '#7FB2FF'] };
const defs = '<defs>' + Object.entries(GLOWS).map(([c, [a, b]]) =>
  '<radialGradient id="led-glow-' + c + '"><stop offset="0" stop-color="' + a + '" stop-opacity=".9"/><stop offset=".45" stop-color="' + b + '" stop-opacity=".45"/><stop offset="1" stop-color="' + b + '" stop-opacity="0"/></radialGradient>').join('') + '</defs>';

export class Circuit {
  constructor(svg, { onChange } = {}) {
    this.svg = svg;
    this.onChange = onChange || (() => {});
    this.sound = 0; // Hz the buzzer should play right now (0 = silent); read by the page every frame
    svg.setAttribute('viewBox', '0 0 660 380');
    this.bind();
    this.setProject({ parts: [], wires: [] });
  }

  /* Replace the canvas with a project's parts. `wires` is what to show now (saved work or the project's
     default); the project's own `wires` stay the default for resetWires(). */
  setProject(project, wires) {
    // Canvas is 660 wide; a project with many parts can ask for more height (canvas: { h: 520 }).
    const h = (project.canvas && project.canvas.h) || 380;
    this.svg.setAttribute('viewBox', '0 0 660 ' + h);
    this.svg.style.aspectRatio = '660 / ' + h;
    this.parts = (project.parts || []).filter((p) => PART_TYPES[p.type]);
    this.defaultWires = project.wires || [];
    this.pins = Object.assign({}, BOARD_PINS);
    this.parts.forEach((p) => {
      Object.entries(PART_TYPES[p.type].pins(p)).forEach(([name, [dx, dy, label]]) => {
        const [rx, ry] = rotate([dx, dy], p.rot || 0);
        this.pins[p.id + '.' + name] = { x: p.x + rx, y: p.y + ry, label };
      });
    });
    this.wires = [];
    this.pressed = new Set();  // ids of buttons held down
    this.potValues = Object.fromEntries(this.parts.filter((p) => p.type === 'pot').map((p) => [p.id, p.value ?? 0.5]));
    this.pending = null;       // first pin of a wire being drawn
    this.drag = null;          // potentiometer being turned with the pointer
    this.painted = {};         // last painted state, to touch the DOM only on change
    this.warnings = [];
    this.sound = 0;
    // Per-part state of the parts that remember something: servo angle, sonar distance/echo, LCD controller.
    this.dev = {};
    this.parts.forEach((p) => {
      if (p.type === 'servo') this.dev[p.id] = { angle: 90, target: 90, ms: null };
      else if (p.type === 'sonar') this.dev[p.id] = { cm: p.value || 30, echo: 0, busy: false, pingMs: -1e9, powered: false };
      else if (p.type === 'lcd') this.dev[p.id] = { chip: new HD44780(16, 2), powered: false };
      else if (p.type === 'ldr') this.dev[p.id] = { light: p.value ?? 0.7 };
    });
    this.drive = {};          // part pins driving a net themselves (the sonar's echo): pin id -> 0 / 1
    this.attached = null;     // the runner whose pin edges the sonar/LCD listen to

    const pinG = (id) => {
      const p = this.pins[id];
      return '<g class="pin" data-pin="' + id + '" tabindex="0" role="button" aria-label="' + p.label + '">' +
        '<circle class="pin-hit" cx="' + p.x + '" cy="' + p.y + '" r="11"/><circle class="pin-dot" cx="' + p.x + '" cy="' + p.y + '" r="5"/></g>';
    };
    this.svg.innerHTML = defs + boardMarkup() +
      this.parts.map((p) => '<g transform="translate(' + p.x + ' ' + p.y + ')' + (p.rot ? ' rotate(' + p.rot + ')' : '') + '">' + PART_TYPES[p.type].draw(p.id, p) + '</g>').join('') +
      '<g class="wires" data-wires></g>' +
      '<g class="pins">' + Object.keys(this.pins).map(pinG).join('') + '</g>' +
      '<line class="wire-pending" data-pending x1="0" y1="0" x2="0" y2="0" visibility="hidden"/>';
    const byData = (attr) => Object.fromEntries([...this.svg.querySelectorAll('[data-' + attr + ']')].map((g) => [g.getAttribute('data-' + attr), g]));
    this.el = {
      wires: this.svg.querySelector('[data-wires]'), pending: this.svg.querySelector('[data-pending]'),
      l: this.svg.querySelector('[data-l]'), on: this.svg.querySelector('[data-on]'),
      leds: byData('led'), buttons: byData('button'), pots: byData('pot'), buzzers: byData('buzzer'), pins: byData('pin'),
      servos: byData('servo'), servoDeg: byData('servo-deg'), sonars: byData('sonar'), sonarWaves: byData('sonar-waves'),
      lcds: byData('lcd'), lcdScreens: byData('lcd-screen'), segs: byData('seg'), lights: byData('light'), ldrGlows: byData('ldr-glow'),
    };
    Object.keys(this.potValues).forEach((id) => this.paintPot(id));
    this.parts.forEach((p) => {
      if (p.type === 'sonar') this.paintSonar(p.id);
      else if (p.type === 'servo') this.paintServo(p.id);
      else if (p.type === 'ldr') this.paintLight(p.id);
    });
    this.setWires(wires || this.defaultWires);
  }

  // ---------- wiring ----------
  setWires(list) {
    this.wires = list.filter(([a, b]) => this.pins[a] && this.pins[b] && a !== b).map((w) => w.slice());
    this.rebuild();
  }
  addWire(a, b) {
    if (a === b || this.wires.some(([x, y]) => (x === a && y === b) || (x === b && y === a))) return;
    this.wires.push([a, b]);
    this.rebuild();
  }
  removeWire(i) { this.wires.splice(i, 1); this.rebuild(); }
  clear() { this.cancelPending(); this.setWires([]); }
  resetWires() { this.cancelPending(); this.setWires(this.defaultWires); }

  rebuild() {
    const ids = Object.keys(this.pins);
    const fixed = GND.slice(1).map((g) => [GND[0], g]);                 // the Uno's GND pins are one net
    const joins = [], plain = [];   // plain: parts that are just conductors (rails), counted as wiring
    this.parts.forEach((p) => {
      const type = PART_TYPES[p.type];
      (typeof type.joined === 'function' ? type.joined(p) : type.joined || []).forEach(([a, b]) => {
        const pair = [p.id + '.' + a, p.id + '.' + b];
        joins.push(pair);
        if (type.conductor) plain.push(pair);
      });
      if (this.pressed.has(p.id)) (type.pressedJoins || []).forEach(([a, b]) => joins.push([p.id + '.' + a, p.id + '.' + b]));
    });
    this.wireNets = nets(ids, fixed.concat(this.wires, plain));           // wiring only: used to spot a missing resistor
    this.nets = nets(ids, fixed.concat(this.wires, joins));
    // Arduino pins whose falling edge a part reacts to at once: a sonar's Trig, an LCD's E.
    this.edgeWatch = {};
    this.parts.forEach((p) => {
      const pin = p.type === 'sonar' ? 'trig' : p.type === 'lcd' ? 'e' : null;
      if (pin) this.nets[p.id + '.' + pin].map(pinNo).filter((d) => d >= 0).forEach((d) => { (this.edgeWatch[d] = this.edgeWatch[d] || []).push(p); });
    });
    this.drawWires();
    this.onChange(this);
  }

  drawWires() {
    let colour = 0;
    this.el.wires.innerHTML = this.wires.map(([a, b], i) => {
      const p = this.pins[a], q = this.pins[b];
      const gnd = GND.includes(a) || GND.includes(b), v5 = a === 'uno.5v' || b === 'uno.5v';
      const stroke = gnd ? '' : ' stroke="' + (v5 ? '#FF6B57' : WIRE_COLORS[colour++ % WIRE_COLORS.length]) + '"'; // GND: CSS, follows the theme
      const title = T.wire(p.label, q.label);
      return '<g class="wire" data-wire="' + i + '" tabindex="0" role="button" aria-label="' + title + '"><title>' + title + '</title>' +
        '<line class="wire-hit" x1="' + p.x + '" y1="' + p.y + '" x2="' + q.x + '" y2="' + q.y + '"/>' +
        '<line class="wire-line' + (gnd ? ' is-gnd' : '') + '" x1="' + p.x + '" y1="' + p.y + '" x2="' + q.x + '" y2="' + q.y + '"' + stroke + '/></g>';
    }).join('');
    Object.entries(this.el.pins).forEach(([id, g]) => {
      g.classList.toggle('is-wired', this.wires.some(([a, b]) => a === id || b === id));
    });
  }

  // ---------- evaluation (every frame while running; once with runner = null when stopped) ----------
  update(runner) {
    if (runner !== this.attached) this.attach(runner);
    const states = DIGITAL.map((d) => (runner ? runner.pinState(d) : PinState.Input));
    const isOut = (d) => states[d] === PinState.High || states[d] === PinState.Low;
    const act = (d) => (runner && runner.activity ? runner.activity(d) : { duty: states[d] === PinState.High ? 1 : 0, freq: 0 });
    const outPins = (net) => net.map(pinNo).filter((d) => d >= 0 && isOut(d));
    const level = (net, skip) => {
      let gnd = false, v5 = false, hi = false, lo = false;
      for (const id of net) {
        if (id === skip) continue;
        if (GND.includes(id)) gnd = true;
        else if (id === 'uno.5v') v5 = true;
        else if (pinNo(id) >= 0) {
          const s = states[pinNo(id)];
          if (s === PinState.High) hi = true; else if (s === PinState.Low) lo = true;
        } else if (id in this.drive) {
          if (this.drive[id]) hi = true; else lo = true;
        }
      }
      return { value: gnd ? 0 : v5 ? 1 : hi ? 1 : lo ? 0 : null, hiPin: hi && gnd, gnd, v5 };
    };
    // Share of time a net is HIGH: 5V = 1, GND = 0, else the busiest output pin driving it (PWM-aware).
    const highShare = (net) => {
      const l = level(net);
      if (l.gnd) return 0;
      if (l.v5) return 1;
      const pins = outPins(net);
      return pins.length ? Math.max(...pins.map((d) => act(d).duty)) : 0;
    };

    // Parts powered from the Arduino: + leg on 5V and - leg on GND.
    const powered = (p, plus, minus) => level(this.nets[p.id + '.' + plus]).v5 && level(this.nets[p.id + '.' + minus]).gnd;
    const wiredToBoard = (net) => net.some((id) => pinNo(id) >= 0);
    const warnings = new Set();
    this.drive = {};
    this.parts.filter((p) => p.type === 'sonar').forEach((p) => {
      const s = this.dev[p.id];
      s.powered = !!runner && powered(p, 'vcc', 'gnd');
      if (s.powered) this.drive[p.id + '.echo'] = s.echo;
      else if (runner && wiredToBoard(this.nets[p.id + '.trig'])) warnings.add(T.warnPower(T.sonar));
      const on = !!runner && runner.millis - s.pingMs < 120;
      this.paint('sw:' + p.id, on, () => this.el.sonarWaves[p.id].classList.toggle('is-on', on));
    });
    this.parts.filter((p) => p.type === 'lcd').forEach((p) => {
      const l = this.dev[p.id], on = !!runner && powered(p, 'vcc', 'gnd');
      if (on && !l.powered) l.chip.reset(); // power-up: blank controller, 8-bit mode
      l.powered = on;
      if (runner && !on && wiredToBoard(this.nets[p.id + '.e'])) warnings.add(T.warnPower(T.lcd));
      this.paintLcd(p.id);
    });

    // Feed input pins with what the circuit ties them to (floating -> null -> the pin's own pull-up).
    if (runner) DIGITAL.forEach((d) => {
      const s = states[d];
      runner.setInput(d, s === PinState.Input || s === PinState.InputPullUp ? level(this.nets[PIN_ID[d]], PIN_ID[d]).value : null);
    });

    // Analog inputs: GND / 5V, a potentiometer wiper, or a digital output wired straight in; floating reads 0 V.
    if (runner && runner.setAnalog) ANALOG.forEach((ch) => {
      const net = this.nets['uno.a' + ch];
      let v = 0;
      const l = level(net);
      if (l.gnd) v = 0;
      else if (l.v5) v = 5;
      else {
        const pot = this.parts.find((p) => p.type === 'pot' && net.includes(p.id + '.w'));
        const ldr = this.parts.find((p) => p.type === 'ldr' && net.includes(p.id + '.ao'));
        if (pot) v = this.potVolts(pot, level);
        else if (ldr) {
          if (powered(ldr, 'vcc', 'gnd')) v = 5 * this.dev[ldr.id].light;
          else warnings.add(T.warnPower(T.ldr));
        }
        else if (outPins(net).length) v = 5 * highShare(net);
      }
      runner.setAnalog(ch, v);
    });

    const drives = (net) => net.some((id) => id === 'uno.5v' || pinNo(id) >= 0);
    this.parts.filter((p) => p.type === 'led').forEach((p) => {
      const a = level(this.nets[p.id + '.a']).value, k = level(this.nets[p.id + '.k']).value;
      const b = runner && k === 0 ? Math.round(highShare(this.nets[p.id + '.a']) * 20) / 20 : 0; // brightness, 5% steps
      if (runner) {
        if (b > 0 && drives(this.wireNets[p.id + '.a']) && this.wireNets[p.id + '.k'].some((id) => GND.includes(id))) warnings.add(T.warnNoRes);
        if (a === 0 && k === 1) warnings.add(T.warnReverse);
      }
      this.paint('led:' + p.id, b, () => {
        const g = this.el.leds[p.id];
        g.classList.toggle('is-on', b > 0);
        g.style.setProperty('--b', b);
      });
    });
    if (runner) DIGITAL.forEach((d) => {
      if (states[d] === PinState.High && level(this.nets[PIN_ID[d]]).hiPin) warnings.add(T.warnShort(pinName(d)));
    });

    // Buzzers: pitch of the pin switching the + leg, with - on GND (or a LOW output).
    let sound = 0;
    this.parts.filter((p) => p.type === 'buzzer').forEach((p) => {
      let hz = 0;
      if (runner && level(this.nets[p.id + '.n']).value === 0) {
        for (const d of outPins(this.nets[p.id + '.p'])) hz = Math.max(hz, act(d).freq);
      }
      if (hz < 20 || hz > 20000) hz = 0;
      sound = Math.max(sound, hz);
      const shown = Math.round(hz);
      this.paint('bz:' + p.id, shown, () => {
        const g = this.el.buzzers[p.id];
        g.classList.toggle('is-on', shown > 0);
        g.setAttribute('data-hz', shown);
      });
    });
    this.sound = sound;

    // Servos: follow the signal's pulse width at servo speed; with no pulses they hold their position.
    this.parts.filter((p) => p.type === 'servo').forEach((p) => {
      const s = this.dev[p.id];
      if (!runner) { s.ms = null; return; }
      const on = powered(p, 'v5', 'gnd');
      let us = 0;
      if (on) for (const d of outPins(this.nets[p.id + '.sig'])) us = Math.max(us, act(d).pulseUs);
      else if (wiredToBoard(this.nets[p.id + '.sig'])) warnings.add(T.warnPower(T.servo));
      if (us >= 400 && us <= 2700) s.target = Math.min(180, Math.max(0, (us - SERVO_US[0]) / (SERVO_US[1] - SERVO_US[0]) * 180));
      const now = runner.millis, step = s.ms === null ? 0 : (now - s.ms) * SERVO_DEG_PER_MS;
      s.ms = now;
      s.angle += Math.min(step, Math.max(-step, s.target - s.angle));
      this.paintServo(p.id);
    });

    // 7-segment displays: a segment lights with the share of time its pin is HIGH while COM reaches GND.
    this.parts.filter((p) => p.type === 'seg7').forEach((p) => {
      const comOk = !!runner && level(this.nets[p.id + '.com']).value === 0;
      'abcdefg'.split('').forEach((s) => {
        const b = comOk ? Math.round(highShare(this.nets[p.id + '.' + s]) * 20) / 20 : 0;
        this.paint('seg:' + p.id + s, b, () => this.el.segs[p.id + '.' + s].style.setProperty('--b', b));
      });
    });

    const lOn = !!runner && states[13] === PinState.High;
    this.paint('l', lOn, () => this.el.l.classList.toggle('is-on', lOn));
    this.paint('on', !!runner, () => this.el.on.classList.toggle('is-on', !!runner));
    DIGITAL.forEach((d) => {
      const high = states[d] === PinState.High;
      this.paint('p' + d, high, () => this.el.pins[PIN_ID[d]].classList.toggle('is-high', high));
    });
    const list = [...warnings], key = list.join('\n');
    if (key !== this.painted.warnings) { this.painted.warnings = key; this.warnings = list; this.onChange(this); }
  }

  // Wiper voltage: position × 5 V with leg 1 on GND and leg 3 on 5V (reversed if swapped); else 0 V.
  potVolts(pot, level) {
    const v = this.potValues[pot.id], one = level(this.nets[pot.id + '.1']), three = level(this.nets[pot.id + '.3']);
    if (one.value === 0 && three.value === 1) return 5 * v;
    if (one.value === 1 && three.value === 0) return 5 * (1 - v);
    return 0;
  }

  setPot(id, value) {
    const v = Math.min(1, Math.max(0, value));
    if (this.potValues[id] === undefined || this.potValues[id] === v) return;
    this.potValues[id] = v;
    this.paintPot(id);
  }
  paintPot(id) {
    const g = this.el.pots[id], v = this.potValues[id];
    g.querySelector('[data-pot-pointer]').setAttribute('transform', 'rotate(' + (v * POT_SPAN - POT_SPAN / 2) + ' 0 -4)');
    g.setAttribute('aria-valuenow', Math.round(v * 100));
    g.setAttribute('aria-valuetext', Math.round(v * 100) + '%');
  }

  // ---------- parts that react within microseconds (CPU time) ----------
  // A new run (or stop): listen to the new runner's pin edges and start the parts from power-up.
  attach(runner) {
    this.attached = runner;
    if (runner) runner.pinListeners.push((d, level) => this.onEdge(runner, d, level));
    Object.values(this.dev).forEach((s) => {
      if ('echo' in s) { s.echo = 0; s.busy = false; s.pingMs = -1e9; }
      if (s.chip) s.powered = false;
    });
  }

  onEdge(runner, d, level) {
    if (level || runner !== this.attached) return; // sonar trigger and LCD enable both act on the falling edge
    (this.edgeWatch[d] || []).forEach((p) => {
      if (p.type === 'sonar') this.ping(runner, p);
      else if (p.type === 'lcd' && this.dev[p.id].powered) {
        const bit = (pin) => this.bitNow(runner, this.nets[p.id + '.' + pin]);
        this.dev[p.id].chip.latch(bit('rs'), bit('d4') | bit('d5') << 1 | bit('d6') << 2 | bit('d7') << 3);
      }
    });
  }

  // HC-SR04: ignore triggers while an echo is under way, as the real one does.
  ping(runner, p) {
    const s = this.dev[p.id];
    if (!s.powered || s.busy) return;
    s.busy = true;
    s.pingMs = runner.millis;
    runner.after(SONAR_DELAY_US, () => {
      this.setEcho(runner, p, 1);
      runner.after(s.cm * SONAR_US_PER_CM, () => { this.setEcho(runner, p, 0); s.busy = false; });
    });
  }

  setEcho(runner, p, v) {
    if (runner !== this.attached) return;
    this.dev[p.id].echo = v;
    this.drive[p.id + '.echo'] = v;
    this.nets[p.id + '.echo'].forEach((id) => { const d = pinNo(id); if (d >= 0) runner.setInput(d, !!v); });
  }

  // Level of a net at this very instruction: GND / 5V, else an output pin on it; floating reads 1 (the LCD's
  // inputs have pull-ups).
  bitNow(runner, net) {
    if (net.some((id) => GND.includes(id))) return 0;
    if (net.includes('uno.5v')) return 1;
    for (const id of net) {
      const d = pinNo(id);
      if (d < 0) continue;
      const s = runner.pinState(d);
      if (s === PinState.High) return 1;
      if (s === PinState.Low) return 0;
    }
    return 1;
  }

  // ---------- painting the parts ----------
  paintServo(id) {
    const a = Math.round(this.dev[id].angle);
    this.paint('sv:' + id, a, () => {
      this.el.servos[id].setAttribute('transform', 'rotate(' + -a + ' 30 0)');
      this.el.servoDeg[id].textContent = a + '°';
    });
  }

  setSonar(id, cm) {
    const v = Math.round(Math.min(SONAR_CM[1], Math.max(SONAR_CM[0], cm)));
    if (!this.dev[id] || this.dev[id].cm === v) return;
    this.dev[id].cm = v;
    this.paintSonar(id);
  }
  paintSonar(id) {
    const g = this.el.sonars[id], cm = this.dev[id].cm;
    const x = SONAR_X[0] + (cm - SONAR_CM[0]) / (SONAR_CM[1] - SONAR_CM[0]) * (SONAR_X[1] - SONAR_X[0]);
    g.querySelector('[data-sonar-pos]').setAttribute('transform', 'translate(' + x + ' 0)');
    g.querySelector('[data-sonar-dist]').textContent = T.cm(cm);
    g.setAttribute('aria-valuenow', cm);
    g.setAttribute('aria-valuetext', T.cm(cm));
  }

  setLight(id, v) {
    const l = Math.round(Math.min(1, Math.max(0, v)) * 100) / 100;
    if (!this.dev[id] || this.dev[id].light === l) return;
    this.dev[id].light = l;
    this.paintLight(id);
  }
  paintLight(id) {
    const g = this.el.lights[id], l = this.dev[id].light, pct = Math.round(l * 100);
    g.querySelector('[data-light-pos]').setAttribute('transform', 'translate(' + (2 * l - 1) * LIGHT_X + ' 0)');
    g.querySelector('[data-light-label]').textContent = T.pct(pct);
    g.setAttribute('aria-valuenow', pct);
    g.setAttribute('aria-valuetext', T.pct(pct));
    this.el.ldrGlows[id].style.setProperty('--l', l);
  }

  // The LCD screen: unpowered = dark; powered but never initialised = the top row of dark blocks a real one
  // shows; otherwise the characters (custom ones drawn from CGRAM) and the cursor.
  paintLcd(id) {
    const { chip, powered } = this.dev[id];
    const cur = powered ? chip.cursorCell() : null;
    const blink = !!cur && chip.blinkOn && Math.floor(performance.now() / 500) % 2 === 0;
    const key = !powered ? 'off' : chip.initialized ? chip.version + '|' + (cur ? cur.row + ',' + cur.col : '') + '|' + blink : 'boot';
    this.paint('lcd:' + id, key, () => {
      this.el.lcdScreens[id].classList.toggle('is-off', !powered);
      const C = LCD_CELL, cell = (r, c) => [C.x0 + c * C.dx, C.y0 + r * C.dy];
      let out = '';
      if (powered && !chip.initialized) {
        for (let c = 0; c < 16; c++) { const [x, y] = cell(0, c); out += '<rect class="lcd-px" x="' + x + '" y="' + y + '" width="' + C.w + '" height="' + C.h + '"/>'; }
      } else if (powered) {
        for (let r = 0; r < 2; r++) for (let c = 0; c < 16; c++) {
          const code = chip.codeAt(r, c), [x, y] = cell(r, c);
          if (code === null) continue;
          if (code < 16) { // custom character: 5×8 pixels
            chip.glyph(code).forEach((row, py) => {
              for (let px = 0; px < 5; px++) if (row & (16 >> px)) out += '<rect class="lcd-px" x="' + (x + px * 2.2) + '" y="' + (y + py * 3.75) + '" width="2" height="3.4"/>';
            });
          } else {
            const ch = HD44780.char(code);
            if (ch !== ' ') out += '<text class="lcd-char" x="' + (x + C.w / 2) + '" y="' + (y + 22) + '">' + esc(ch) + '</text>';
          }
        }
        if (cur) {
          const [x, y] = cell(cur.row, cur.col);
          if (blink) out += '<rect class="lcd-px" x="' + x + '" y="' + y + '" width="' + C.w + '" height="' + C.h + '"/>';
          else if (chip.cursorOn) out += '<rect class="lcd-px" x="' + x + '" y="' + (y + C.h - 3) + '" width="' + C.w + '" height="3"/>';
        }
      }
      this.el.lcds[id].innerHTML = out;
    });
  }

  paint(key, value, fn) {
    if (this.painted[key] === value) return;
    this.painted[key] = value;
    fn();
  }

  // ---------- input ----------
  point(e) {
    const pt = this.svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    return pt.matrixTransform(this.svg.getScreenCTM().inverse());
  }

  pickPin(id) {
    if (!this.pending) {
      this.pending = id;
      this.el.pins[id].classList.add('is-pending');
      const p = this.pins[id];
      ['x1', 'x2'].forEach((k) => this.el.pending.setAttribute(k, p.x));
      ['y1', 'y2'].forEach((k) => this.el.pending.setAttribute(k, p.y));
      this.el.pending.setAttribute('visibility', 'visible');
      return;
    }
    const first = this.pending;
    this.cancelPending();
    if (first !== id) this.addWire(first, id);
  }

  cancelPending() {
    if (!this.pending) return;
    this.el.pins[this.pending].classList.remove('is-pending');
    this.pending = null;
    this.el.pending.setAttribute('visibility', 'hidden');
  }

  setPressed(id, on) {
    const g = this.el.buttons[id];
    if (!g || this.pressed.has(id) === on) return;
    if (on) this.pressed.add(id); else this.pressed.delete(id);
    g.classList.toggle('is-pressed', on);
    g.setAttribute('aria-pressed', String(on));
    this.rebuild();
  }
  releaseButtons() { [...this.pressed].forEach((id) => this.setPressed(id, false)); }

  // Listeners are delegated from the <svg>, so they survive setProject() replacing its contents.
  bind() {
    const svg = this.svg;
    const buttonOf = (e) => e.target.closest && e.target.closest('[data-button]');
    const potOf = (e) => e.target.closest && e.target.closest('[data-pot]');
    // Sliders that follow the pointer along x: the sonar's obstacle (cm) and the light sensor's light level (0..1).
    // Keys: arrows one step, Page Up/Down ten steps, Home/End the ends.
    const SLIDERS = {
      sonar: {
        get: (id) => this.dev[id].cm, set: (id, v) => this.setSonar(id, v), step: 1, min: SONAR_CM[0], max: SONAR_CM[1],
        at: (x) => SONAR_CM[0] + (x - SONAR_X[0]) / (SONAR_X[1] - SONAR_X[0]) * (SONAR_CM[1] - SONAR_CM[0]),
      },
      light: { get: (id) => this.dev[id].light, set: (id, v) => this.setLight(id, v), step: 0.05, min: 0, max: 1, at: (x) => (x / LIGHT_X + 1) / 2 },
    };
    const sliderOf = (e) => {
      const g = e.target.closest && e.target.closest('[data-sonar], [data-light]');
      return g && { g, kind: g.dataset.sonar ? 'sonar' : 'light', id: g.dataset.sonar || g.dataset.light };
    };
    const slideTo = (kind, id, e) => SLIDERS[kind].set(id, SLIDERS[kind].at(this.point(e).x - this.parts.find((p) => p.id === id).x));
    svg.addEventListener('click', (e) => {
      const pin = e.target.closest('[data-pin]');
      if (pin) { this.pickPin(pin.dataset.pin); return; }
      const wire = e.target.closest('[data-wire]');
      if (wire && !this.pending) { this.removeWire(+wire.dataset.wire); return; }
      if (!buttonOf(e) && !potOf(e) && !sliderOf(e)) this.cancelPending();
    });
    svg.addEventListener('keydown', (e) => {
      const s = sliderOf(e);
      if (!s) return;
      const c = SLIDERS[s.kind], n = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1, PageUp: 10, PageDown: -10 }[e.key];
      const to = n !== undefined ? c.get(s.id) + n * c.step : e.key === 'Home' ? c.min : e.key === 'End' ? c.max : null;
      if (to !== null) { e.preventDefault(); c.set(s.id, to); }
    });
    svg.addEventListener('pointerdown', (e) => {
      const s = sliderOf(e);
      if (!s) return;
      e.preventDefault();
      s.g.setPointerCapture(e.pointerId);
      s.g.focus({ preventScroll: true });
      this.drag = { id: s.id, pointer: e.pointerId, slider: s.kind };
      slideTo(s.kind, s.id, e);
    });
    svg.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { this.cancelPending(); return; }
      const btn = buttonOf(e);
      if (btn) {
        if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); this.setPressed(btn.dataset.button, true); }
        return;
      }
      const pot = potOf(e);
      if (pot) {
        const id = pot.dataset.pot, v = this.potValues[id];
        const step = { ArrowRight: 0.05, ArrowUp: 0.05, ArrowLeft: -0.05, ArrowDown: -0.05, PageUp: 0.2, PageDown: -0.2 }[e.key];
        if (step !== undefined) { e.preventDefault(); this.setPot(id, v + step); }
        else if (e.key === 'Home') { e.preventDefault(); this.setPot(id, 0); }
        else if (e.key === 'End') { e.preventDefault(); this.setPot(id, 1); }
        return;
      }
      if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Delete' && e.key !== 'Backspace') return;
      const pin = e.target.closest('[data-pin]'), wire = e.target.closest('[data-wire]');
      if (pin && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); this.pickPin(pin.dataset.pin); }
      else if (wire) {
        e.preventDefault();
        const i = +wire.dataset.wire;
        this.removeWire(i);
        const next = this.el.wires.querySelector('[data-wire="' + Math.min(i, this.wires.length - 1) + '"]');
        (next || svg.querySelector('[data-pin]')).focus();
      }
    });
    svg.addEventListener('pointermove', (e) => {
      if (this.drag && this.drag.slider && e.pointerId === this.drag.pointer) { slideTo(this.drag.slider, this.drag.id, e); return; }
      if (this.drag && e.pointerId === this.drag.pointer) {
        // drag right or up to turn clockwise; the whole range is ~160 screen px
        const d = (e.clientX - this.drag.x) - (e.clientY - this.drag.y);
        this.setPot(this.drag.id, this.drag.start + d / 160);
        return;
      }
      if (!this.pending) return;
      const p = this.point(e);
      this.el.pending.setAttribute('x2', p.x);
      this.el.pending.setAttribute('y2', p.y);
    });

    // Pushbuttons: pressed while the pointer (mouse, finger, pen) or Space/Enter is held down.
    // Potentiometers: turned by dragging.
    svg.addEventListener('pointerdown', (e) => {
      const pot = potOf(e);
      if (pot) {
        e.preventDefault();
        pot.setPointerCapture(e.pointerId);
        pot.focus({ preventScroll: true });
        this.drag = { id: pot.dataset.pot, pointer: e.pointerId, x: e.clientX, y: e.clientY, start: this.potValues[pot.dataset.pot] };
        return;
      }
      const btn = buttonOf(e);
      if (!btn) return;
      e.preventDefault();
      btn.setPointerCapture(e.pointerId);
      this.setPressed(btn.dataset.button, true);
    });
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((t) => svg.addEventListener(t, (e) => {
      if (this.drag && e.pointerId === this.drag.pointer) { this.drag = null; return; }
      const btn = buttonOf(e);
      if (btn) this.setPressed(btn.dataset.button, false);
    }));
    svg.addEventListener('keyup', (e) => {
      const btn = buttonOf(e);
      if (btn && (e.key === ' ' || e.key === 'Enter')) this.setPressed(btn.dataset.button, false);
    });
    svg.addEventListener('focusout', (e) => { const btn = buttonOf(e); if (btn) this.setPressed(btn.dataset.button, false); });
    svg.addEventListener('contextmenu', (e) => { if (buttonOf(e) || potOf(e) || sliderOf(e)) e.preventDefault(); }); // long-press on touch
  }
}
