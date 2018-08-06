interface oamEntry {
    x: number,
    y: number,
    patData: number[],
    paletteNum: number,
    priority: boolean,
}

function combineHex(hiByte: number, lowByte: number): number {
    return (hiByte<<8)|(lowByte);
}

function splitHex(hex: number): [number, number] {
    let str = hex.toString(16).padStart(4, "0");
    let hiByte = parseInt(str.substr(0, 2), 16);
    let loByte = parseInt(str.substr(2), 16);
    return [hiByte, loByte];
}

function addWrap(reg: number, add: number): number {
    reg = reg + add;
    if (reg > 0xFF) { reg = 0x00; }
    if (reg < 0x00) { reg = 0xFF; }
    return reg;
}

function insertInto(addr: number, byte: number, i: number, j1: number, j2: number): number {
    let mask = 0xFFFF;
    mask ^= (Math.pow(2, (j1 - j2)) - 1) << (i - (j1 - j2));
    addr &= mask; //Clear relevant bits
    //Slice/Shift byte
    byte &= (Math.pow(2, (j1 - j2)) - 1) << j2;
    byte >>= j2;
    byte <<= (i - (j1 - j2));
    return addr | byte;
}
