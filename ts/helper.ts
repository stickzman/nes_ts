function combineHexBuff(buff: Uint8Array): number {
    return (buff[0]<<8)|(buff[1]);
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
