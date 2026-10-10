/* HD44780 character LCD controller (the chip on every 16x2 LCD), as the Arduino LiquidCrystal library drives it in
   4-bit mode: the circuit calls latch(rs, nibble) on each falling edge of E with the levels of RS and D4-D7.
   After power-up it is in 8-bit mode (each E pulse is a whole instruction, DB0-DB3 read as 0) until "function set"
   switches it to 4-bit; from then on every instruction or character takes two pulses, high nibble first.
   Not modelled: the busy flag and instruction timing (the controller is always ready), reading back (RW is tied to
   GND), contrast and the backlight. No DOM here, so it also runs in the Node tests. */

// Character ROM A00 (the common one) for codes 0x20-0xFF where it differs from ASCII or has a useful symbol;
// codes 0x00-0x0F are the 8 custom characters (twice), anything else unknown shows as a space.
const ROM = { 0x5C: '¥', 0x7E: '→', 0x7F: '←', 0xA5: '·', 0xDF: '°', 0xE4: 'µ', 0xF4: 'Ω', 0xFF: '█' };

export class HD44780 {
  constructor(cols = 16, rows = 2) {
    this.cols = cols;
    this.rows = rows;
    this.reset();
  }

  reset() {
    this.ddram = new Uint8Array(128).fill(0x20); // display data, indexed by DDRAM address (row 2 starts at 0x40)
    this.cgram = new Uint8Array(64);             // 8 custom characters × 8 rows of 5 pixels
    this.ac = 0;                // address counter
    this.toCg = false;          // AC points into CGRAM (after "set CGRAM address") instead of DDRAM
    this.increment = true;      // entry mode I/D
    this.shiftOnWrite = false;  // entry mode S
    this.displayOn = false;
    this.cursorOn = false;
    this.blinkOn = false;
    this.shift = 0;             // display shift: visible column c shows DDRAM column c + shift
    this.eightBit = true;
    this.twoLines = false;
    this.initialized = false;   // a fresh LCD shows a row of dark blocks until the first function set
    this.high = null;           // first nibble of a 4-bit transfer, waiting for the second
    this.version = 0;           // bumps on every instruction or character, so the page repaints only on change
  }

  latch(rs, nibble) {
    if (this.eightBit) { this.exec(rs, (nibble & 0xF) << 4); return; }
    if (this.high === null) { this.high = nibble & 0xF; return; }
    const byte = (this.high << 4) | (nibble & 0xF);
    this.high = null;
    this.exec(rs, byte);
  }

  exec(rs, b) {
    this.version++;
    if (rs) { this.write(b); return; }
    if (b & 0x80) { this.toCg = false; this.ac = b & 0x7F; }                               // set DDRAM address
    else if (b & 0x40) { this.toCg = true; this.ac = b & 0x3F; }                           // set CGRAM address
    else if (b & 0x20) {                                                                    // function set
      this.eightBit = !!(b & 0x10);
      this.twoLines = !!(b & 0x08);
      this.initialized = true;
      this.high = null;
    } else if (b & 0x10) {                                                                  // cursor / display shift
      const right = !!(b & 0x04);
      if (b & 0x08) this.shift += right ? -1 : 1; else this.move(right ? 1 : -1);
    } else if (b & 0x08) { this.displayOn = !!(b & 4); this.cursorOn = !!(b & 2); this.blinkOn = !!(b & 1); }
    else if (b & 0x04) { this.increment = !!(b & 2); this.shiftOnWrite = !!(b & 1); }      // entry mode set
    else if (b & 0x02) { this.toCg = false; this.ac = 0; this.shift = 0; }                 // return home
    else if (b & 0x01) { this.ddram.fill(0x20); this.toCg = false; this.ac = 0; this.shift = 0; this.increment = true; } // clear
  }

  write(b) {
    if (this.toCg) this.cgram[this.ac & 0x3F] = b & 0x1F;
    else {
      this.ddram[this.ac] = b;
      if (this.shiftOnWrite) this.shift += this.increment ? 1 : -1;
    }
    this.move(this.increment ? 1 : -1);
  }

  // Step the address counter. Two-line mode: 0x00-0x27 and 0x40-0x67, each wrapping into the other line.
  move(d) {
    if (this.toCg) { this.ac = (this.ac + d) & 0x3F; return; }
    if (!this.twoLines) { this.ac = (this.ac + d + 80) % 80; return; }
    let line = this.ac & 0x40, col = (this.ac & 0x3F) + d;
    if (col > 0x27) { col = 0; line ^= 0x40; } else if (col < 0) { col = 0x27; line ^= 0x40; }
    this.ac = line | col;
  }

  /* Character code shown at (row, col) of the visible window, or null where nothing is shown. */
  codeAt(row, col) {
    if (!this.displayOn) return null;
    const lineLen = this.twoLines ? 40 : 80;
    if (row > 0 && !this.twoLines) return null;
    const c = (((col + this.shift) % lineLen) + lineLen) % lineLen;
    return this.ddram[(row ? 0x40 : 0) + c];
  }

  /* The visible text as strings (custom characters as \x00-\x07), e.g. for tests. */
  text() {
    return Array.from({ length: this.rows }, (_, r) =>
      Array.from({ length: this.cols }, (_, c) => { const v = this.codeAt(r, c); return v === null ? ' ' : HD44780.char(v); }).join(''));
  }

  /* Where the cursor is on screen ({ row, col }), or null if it is off or outside the window. */
  cursorCell() {
    if (!this.displayOn || !(this.cursorOn || this.blinkOn) || this.toCg) return null;
    const lineLen = this.twoLines ? 40 : 80;
    const row = this.twoLines && this.ac & 0x40 ? 1 : 0;
    const col = ((((this.ac & 0x3F) - this.shift) % lineLen) + lineLen) % lineLen;
    return col < this.cols ? { row, col } : null;
  }

  /* 8 rows of 5 pixels (bit 4 = left) for a custom character code 0-15. */
  glyph(code) { return Array.from(this.cgram.subarray((code & 7) * 8, (code & 7) * 8 + 8)); }

  static char(code) {
    if (code < 0x10) return String.fromCharCode(code & 7);
    if (ROM[code]) return ROM[code];
    return code >= 0x20 && code < 0x7E ? String.fromCharCode(code) : ' ';
  }
}
