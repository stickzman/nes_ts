declare function md5(input: string): string;

interface oamEntry {
    x: number,
    patData: number[],
    paletteNum: number,
    priority: boolean,
    isSprite0: boolean
}

interface AudioContext {
    createNoiseSource(): AudioBufferSourceNode;
}

AudioContext.prototype.createNoiseSource = function () {
    let bufferSize = 2 * this.sampleRate;
    let buffer = this.createBuffer(1, bufferSize, this.sampleRate);
    let output = buffer.getChannelData(0);
    for (var i = 0; i < bufferSize; i++) {
        output[i] = Math.random() * 2 - 1;
    }
    let node = this.createBufferSource();
    node.buffer = buffer;
    node.loop = true;
    return node;
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

function deepCopyObj(obj: object): object {
    return JSON.parse(JSON.stringify(obj));
}

function updateVol(val: number) {
    APU.masterVol = Math.pow(val, 2);
    APU.masterGain.gain.setTargetAtTime(Math.pow(val, 2), 0, 0.1);
}
