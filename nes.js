class CPU {
    constructor(memory, ppu) {
        this.debug = false; //Output debug info
        //Stop execution when an infinite loop is detected
        this.detectTraps = false;
        this.RES_VECT_LOC = 0xFFFC;
        this.INT_VECT_LOC = 0xFFFE;
        this.NMI_VECT_LOC = 0xFFFA;
        this.IRQ = false; //Interrupt Request signal line
        this.NMI = false; //Non-Maskable Interrupt signal line
        this.PC = 0; //Program Counter
        this.flags = {
            carry: false,
            zero: false,
            interruptDisable: true,
            decimalMode: false,
            break: false,
            overflow: false,
            negative: false //Result of last op had bit 7 set to 1
        };
        this.mem = memory;
        this.ppu = ppu;
    }
    boot() {
        this.flags.interruptDisable = true;
        this.ACC = 0;
        this.X = 0;
        this.Y = 0;
        this.SP = 0xFD;
        this.mem[0x4015] = 0;
        this.mem[0x4017] = 0;
        this.mem.fill(0x00, 0x4000, 0x4010); //LSFR?
        this.PC = this.getResetVector();
    }
    reset() {
        this.SP -= 3;
        this.flags.interruptDisable = true;
        this.mem[0x4015] = 0;
        this.PC = this.getResetVector();
    }
    step() {
        //Check interrupt lines
        if (this.NMI) {
            this.NMI = false;
            this.handleInterrupt(this.NMI_VECT_LOC);
        }
        else if (this.IRQ && !this.flags.interruptDisable) {
            this.IRQ = false;
            this.handleInterrupt(this.INT_VECT_LOC);
        }
        let opCode = this.mem[this.PC]; //Fetch
        let op = opTable[opCode]; //Decode
        if (op === undefined) {
            let e = new Error(`Encountered unknown opCode: [0x${opCode.toString(16).toUpperCase()}] at PC: 0x${this.PC.toString(16).padStart(4, "0").toUpperCase()}`);
            e.name = "Unexpected OpCode";
            throw e;
        }
        if (this.debug) {
            console.log(`Executing ${op.name} at 0x${this.PC.toString(16).padStart(4, "0").toUpperCase()}...`);
        }
        op.execute.bind(this)(); //Execute
        if (this.debug) {
            this.displayState();
            console.log("");
        }
        this.PC += op.bytes;
        if (this.PC > 0xFFFF) {
            this.PC -= 0x10000;
        }
    }
    requestInterrupt() {
        this.IRQ = true;
    }
    requestNMInterrupt() {
        this.NMI = true;
    }
    handleInterrupt(resetVectStartAddr, setBRK = false) {
        //Split PC and add each addr byte to stack
        let bytes = splitHex(this.PC);
        this.pushStack(bytes[0]); //MSB
        this.pushStack(bytes[1]); //LSB
        //Store the processor status in the stack
        let statusByte = 0x00;
        //Set each bit accoriding to flags, ignoring the break flag
        statusByte += (this.flags.carry) ? 1 : 0;
        statusByte += (this.flags.zero) ? 2 : 0;
        statusByte += (this.flags.interruptDisable) ? 4 : 0;
        statusByte += (this.flags.decimalMode) ? 8 : 0;
        statusByte += (setBRK) ? 16 : 0;
        statusByte += 32; //This bit always set
        statusByte += (this.flags.overflow) ? 64 : 0;
        statusByte += (this.flags.negative) ? 128 : 0;
        this.pushStack(statusByte);
        this.flags.interruptDisable = true;
        //Set program counter to interrupt vector
        let vector = new Uint8Array(this.mem.slice(resetVectStartAddr, resetVectStartAddr + 2));
        this.PC = combineHexBuff(vector.reverse());
    }
    getResetVector() {
        let bytes = new Uint8Array(this.mem.slice(this.RES_VECT_LOC, this.RES_VECT_LOC + 2));
        return combineHexBuff(bytes.reverse());
    }
    pushStack(byte) {
        //Write byte to stack
        this.mem[combineHex(0x01, this.SP)] = byte;
        //Decrement stack pointer, wrap if necessary
        this.SP--;
        if (this.SP < 0) {
            this.SP = 0xFF;
        }
    }
    pullStack() {
        this.SP++;
        if (this.SP > 0xFF) {
            this.SP = 0;
        }
        let byte = this.mem[combineHex(0x01, this.SP)];
        return byte;
    }
    displayState() {
        //Print Registers
        console.log(`[ACC: 0x${this.ACC.toString(16).padStart(2, "0").toUpperCase()} X: 0x${this.X.toString(16).padStart(2, "0").toUpperCase()} Y: 0x${this.Y.toString(16).padStart(2, "0").toUpperCase()} PC: 0x${this.PC.toString(16).padStart(4, "0").toUpperCase()} SP: 0x${this.SP.toString(16).padStart(2, "0").toUpperCase()} ]`);
        //Print flags
        let keys = Object.getOwnPropertyNames(this.flags);
        for (let key of keys) {
            console.log(`${key}: ${this.flags[key]}`);
        }
    }
    nextByte() {
        return this.mem[this.PC + 1];
    }
    next2Bytes(flip = true) {
        let bytes = new Uint8Array(this.mem.slice(this.PC + 1, this.PC + 3));
        if (flip) {
            bytes.reverse();
        }
        return combineHexBuff(bytes);
    }
    updateOverflowFlag(reg, num1, num2) {
        //If the sum of two like signed terms is a diff sign, then the
        //signed result is outside [-128, 127], so set overflow flag
        this.flags.overflow = (num1 < 0x80 && num2 < 0x80 && reg >= 0x80) ||
            (num1 >= 0x80 && num2 >= 0x80 && reg < 0x80);
    }
    updateNegativeFlag(register) {
        this.flags.negative = (register > 0x7F);
    }
    updateNumStateFlags(register) {
        this.flags.zero = (register === 0x00);
        this.updateNegativeFlag(register);
    }
    getRef(offset = 0) {
        let addr = this.next2Bytes() + offset;
        if (addr > 0xFFFF) {
            addr -= 0x10000;
        }
        if (this.debug) {
            console.log(`Accessing memory at 0x${addr.toString(16).padStart(4, "0").toUpperCase()}...`);
        }
        return addr;
    }
    getZPageRef(offset = 0) {
        let addr = this.nextByte() + offset;
        addr -= (addr > 0xFF) ? 0x100 : 0;
        if (this.debug) {
            console.log(`Accessing memory at 0x${addr.toString(16).padStart(4, "0").toUpperCase()}...`);
        }
        return addr;
    }
    getIndrXRef() {
        let addr = this.getZPageRef(this.X);
        if (addr == 0xFF) {
            return combineHex(this.mem[0], this.mem[addr]);
        }
        else {
            return combineHex(this.mem[addr + 1], this.mem[addr]);
        }
    }
    getIndrYRef() {
        let addr = this.getZPageRef();
        //console.log(addr.toString(16), this.mem[addr+1].toString(16), this.mem[addr].toString(16), this.Y.toString(16));
        let res;
        if (addr == 0xFF) {
            res = combineHex(this.mem[0], this.mem[addr]) + this.Y;
        }
        else {
            res = combineHex(this.mem[addr + 1], this.mem[addr]) + this.Y;
        }
        if (res > 0xFFFF) {
            res -= 0x10000;
        }
        return res;
    }
}
let opTable = {};
opTable[0x00] = {
    name: "BRK",
    bytes: 0,
    cycles: 7,
    execute: function () {
        this.PC += 2;
        this.handleInterrupt(this.INT_VECT_LOC, true);
    }
};
opTable[0xA9] = {
    name: "LDA (imm)",
    bytes: 2,
    cycles: 2,
    execute: function () {
        this.ACC = this.nextByte();
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0xAD] = {
    name: "LDA (abs)",
    bytes: 3,
    cycles: 4,
    execute: function () {
        let addr = this.getRef();
        this.ACC = this.mem[addr];
        this.updateNumStateFlags(this.ACC);
        this.ppu.readReg(addr);
    }
};
opTable[0xBD] = {
    name: "LDA (abs, X)",
    bytes: 3,
    cycles: 4,
    execute: function () {
        let addr = this.getRef(this.X);
        this.ACC = this.mem[addr];
        this.updateNumStateFlags(this.ACC);
        this.ppu.readReg(addr);
    }
};
opTable[0xB9] = {
    name: "LDA (abs, Y)",
    bytes: 3,
    cycles: 4,
    execute: function () {
        let addr = this.getRef(this.Y);
        this.ACC = this.mem[addr];
        this.updateNumStateFlags(this.ACC);
        this.ppu.readReg(addr);
    }
};
opTable[0xA5] = {
    name: "LDA (zpg)",
    bytes: 2,
    cycles: 3,
    execute: function () {
        let addr = this.getZPageRef();
        this.ACC = this.mem[addr];
        this.updateNumStateFlags(this.ACC);
        this.ppu.readReg(addr);
    }
};
opTable[0xB5] = {
    name: "LDA (zpg, X)",
    bytes: 2,
    cycles: 4,
    execute: function () {
        let addr = this.getZPageRef(this.X);
        this.ACC = this.mem[addr];
        this.updateNumStateFlags(this.ACC);
        this.ppu.readReg(addr);
    }
};
opTable[0xA1] = {
    name: "LDA (ind, X)",
    bytes: 2,
    cycles: 6,
    execute: function () {
        let addr = this.getIndrXRef();
        this.ACC = this.mem[addr];
        this.updateNumStateFlags(this.ACC);
        this.ppu.readReg(addr);
    }
};
opTable[0xB1] = {
    name: "LDA (ind), Y",
    bytes: 2,
    cycles: 5,
    execute: function () {
        let addr = this.getIndrYRef();
        this.ACC = this.mem[addr];
        this.updateNumStateFlags(this.ACC);
        this.ppu.readReg(addr);
    }
};
opTable[0xA2] = {
    name: "LDX (imm)",
    bytes: 2,
    cycles: 2,
    execute: function () {
        this.X = this.nextByte();
        this.updateNumStateFlags(this.X);
    }
};
opTable[0xA6] = {
    name: "LDX (zpg)",
    bytes: 2,
    cycles: 3,
    execute: function () {
        let addr = this.getZPageRef();
        this.X = this.mem[addr];
        this.updateNumStateFlags(this.X);
        this.ppu.readReg(addr);
    }
};
opTable[0xB6] = {
    name: "LDX (zpg, Y)",
    bytes: 2,
    cycles: 4,
    execute: function () {
        let addr = this.getZPageRef(this.Y);
        this.X = this.mem[addr];
        this.updateNumStateFlags(this.X);
        this.ppu.readReg(addr);
    }
};
opTable[0xAE] = {
    name: "LDX (abs)",
    bytes: 3,
    cycles: 4,
    execute: function () {
        let addr = this.getRef();
        this.X = this.mem[addr];
        this.updateNumStateFlags(this.X);
        this.ppu.readReg(addr);
    }
};
opTable[0xBE] = {
    name: "LDX (abs, Y)",
    bytes: 3,
    cycles: 4,
    execute: function () {
        let addr = this.getRef(this.Y);
        this.X = this.mem[addr];
        this.updateNumStateFlags(this.X);
        this.ppu.readReg(addr);
    }
};
opTable[0xA0] = {
    name: "LDY (imm)",
    bytes: 2,
    cycles: 2,
    execute: function () {
        this.Y = this.nextByte();
        this.updateNumStateFlags(this.Y);
    }
};
opTable[0xA4] = {
    name: "LDY (zpg)",
    bytes: 2,
    cycles: 3,
    execute: function () {
        let addr = this.getZPageRef();
        this.Y = this.mem[addr];
        this.updateNumStateFlags(this.Y);
        this.ppu.readReg(addr);
    }
};
opTable[0xB4] = {
    name: "LDY (zpg, X)",
    bytes: 2,
    cycles: 4,
    execute: function () {
        let addr = this.getZPageRef(this.X);
        this.Y = this.mem[addr];
        this.updateNumStateFlags(this.Y);
        this.ppu.readReg(addr);
    }
};
opTable[0xAC] = {
    name: "LDY (abs)",
    bytes: 3,
    cycles: 4,
    execute: function () {
        let addr = this.getRef();
        this.Y = this.mem[addr];
        this.updateNumStateFlags(this.Y);
        this.ppu.readReg(addr);
    }
};
opTable[0xBC] = {
    name: "LDY (abs, X)",
    bytes: 3,
    cycles: 4,
    execute: function () {
        let addr = this.getRef(this.X);
        this.Y = this.mem[addr];
        this.updateNumStateFlags(this.Y);
        this.ppu.readReg(addr);
    }
};
opTable[0x85] = {
    name: "STA (zpg)",
    bytes: 2,
    cycles: 3,
    execute: function () {
        let addr = this.getZPageRef();
        this.mem[addr] = this.ACC;
        this.ppu.writeReg(addr);
    }
};
opTable[0x95] = {
    name: "STA (zpg, X)",
    bytes: 2,
    cycles: 4,
    execute: function () {
        let addr = this.getZPageRef(this.X);
        this.mem[addr] = this.ACC;
        this.ppu.writeReg(addr);
    }
};
opTable[0x8D] = {
    name: "STA (abs)",
    bytes: 3,
    cycles: 4,
    execute: function () {
        let addr = this.getRef();
        this.mem[addr] = this.ACC;
        this.ppu.writeReg(addr);
    }
};
opTable[0x9D] = {
    name: "STA (abs, X)",
    bytes: 3,
    cycles: 4,
    execute: function () {
        let addr = this.getRef(this.X);
        this.mem[addr] = this.ACC;
        this.ppu.writeReg(addr);
    }
};
opTable[0x99] = {
    name: "STA (abs, Y)",
    bytes: 3,
    cycles: 4,
    execute: function () {
        let addr = this.getRef(this.Y);
        this.mem[addr] = this.ACC;
        this.ppu.writeReg(addr);
    }
};
opTable[0x81] = {
    name: "STA (ind, X)",
    bytes: 2,
    cycles: 6,
    execute: function () {
        let addr = this.getIndrXRef();
        this.mem[addr] = this.ACC;
        this.ppu.writeReg(addr);
    }
};
opTable[0x91] = {
    name: "STA (ind), Y",
    bytes: 2,
    cycles: 5,
    execute: function () {
        let addr = this.getIndrYRef();
        this.mem[addr] = this.ACC;
        this.ppu.writeReg(addr);
    }
};
opTable[0x86] = {
    name: "STX (zpg)",
    bytes: 2,
    cycles: 3,
    execute: function () {
        let addr = this.getZPageRef();
        this.mem[addr] = this.X;
        this.ppu.writeReg(addr);
    }
};
opTable[0x96] = {
    name: "STX (zpg, Y)",
    bytes: 2,
    cycles: 4,
    execute: function () {
        let addr = this.getZPageRef(this.Y);
        this.mem[addr] = this.X;
        this.ppu.writeReg(addr);
    }
};
opTable[0x8E] = {
    name: "STX (abs)",
    bytes: 3,
    cycles: 4,
    execute: function () {
        let addr = this.getRef();
        this.mem[addr] = this.X;
        this.ppu.writeReg(addr);
    }
};
opTable[0x84] = {
    name: "STY (zpg)",
    bytes: 2,
    cycles: 3,
    execute: function () {
        let addr = this.getZPageRef();
        this.mem[addr] = this.Y;
        this.ppu.writeReg(addr);
    }
};
opTable[0x94] = {
    name: "STY (zpg, Y)",
    bytes: 2,
    cycles: 4,
    execute: function () {
        let addr = this.getZPageRef(this.X);
        this.mem[addr] = this.Y;
        this.ppu.writeReg(addr);
    }
};
opTable[0x8C] = {
    name: "STY (abs)",
    bytes: 3,
    cycles: 4,
    execute: function () {
        let addr = this.getRef();
        this.mem[addr] = this.Y;
        this.ppu.writeReg(addr);
    }
};
opTable[0xAA] = {
    name: "TAX",
    bytes: 1,
    cycles: 2,
    execute: function () {
        this.X = this.ACC;
        this.updateNumStateFlags(this.X);
    }
};
opTable[0xA8] = {
    name: "TAY",
    bytes: 1,
    cycles: 2,
    execute: function () {
        this.Y = this.ACC;
        this.updateNumStateFlags(this.Y);
    }
};
opTable[0xBA] = {
    name: "TSX",
    bytes: 1,
    cycles: 2,
    execute: function () {
        this.X = this.SP;
        this.updateNumStateFlags(this.X);
    }
};
opTable[0x8A] = {
    name: "TXA",
    bytes: 1,
    cycles: 2,
    execute: function () {
        this.ACC = this.X;
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x9A] = {
    name: "TXS",
    bytes: 1,
    cycles: 2,
    execute: function () {
        this.SP = this.X;
    }
};
opTable[0x98] = {
    name: "TYA",
    bytes: 1,
    cycles: 2,
    execute: function () {
        this.ACC = this.Y;
        this.updateNumStateFlags(this.Y);
    }
};
function ADC(num) {
    let num2 = this.ACC;
    this.ACC += num + this.flags.carry;
    //Wrap ACC and set/clear carry flag
    if (this.ACC > 0xFF) {
        this.flags.carry = true;
        this.ACC -= 0x100;
    }
    else {
        this.flags.carry = false;
    }
    ///Set/clear overflow flag
    this.updateOverflowFlag(this.ACC, num, num2);
    //Set/clear negative + zero flags
    this.updateNumStateFlags(this.ACC);
}
opTable[0x69] = {
    name: "ADC (imm)",
    bytes: 2,
    cycles: 2,
    execute: function () {
        ADC.call(this, this.nextByte());
    }
};
opTable[0x65] = {
    name: "ADC (zpg)",
    bytes: 2,
    cycles: 3,
    execute: function () {
        let addr = this.getZPageRef();
        ADC.call(this, this.mem[addr]);
    }
};
opTable[0x75] = {
    name: "ADC (zpg, X)",
    bytes: 2,
    cycles: 4,
    execute: function () {
        let addr = this.getZPageRef(this.X);
        ADC.call(this, this.mem[addr]);
    }
};
opTable[0x6D] = {
    name: "ADC (abs)",
    bytes: 3,
    cycles: 4,
    execute: function () {
        let addr = this.getRef();
        ADC.call(this, this.mem[addr]);
    }
};
opTable[0x7D] = {
    name: "ADC (abs, X)",
    bytes: 3,
    cycles: 4,
    execute: function () {
        //this.displayState();
        //console.log("");
        //this.debug = true;
        let addr = this.getRef(this.X);
        //console.log(this.mem[addr].toString(16));
        ADC.call(this, this.mem[addr]);
        //this.debug = false;
        //this.displayState();
        //console.log("");
    }
};
opTable[0x79] = {
    name: "ADC (abs, Y)",
    bytes: 3,
    cycles: 4,
    execute: function () {
        let addr = this.getRef(this.Y);
        ADC.call(this, this.mem[addr]);
    }
};
opTable[0x61] = {
    name: "ADC (ind, X)",
    bytes: 2,
    cycles: 6,
    execute: function () {
        let addr = this.getIndrXRef();
        ADC.call(this, this.mem[addr]);
    }
};
opTable[0x71] = {
    name: "ADC (ind), Y",
    bytes: 2,
    cycles: 6,
    execute: function () {
        let addr = this.getIndrYRef();
        ADC.call(this, this.mem[addr]);
    }
};
function SBC(num) {
    if (this.flags.decimalMode) {
        //Convert current 2 digit hex to literal 2 digit decimal
        let num2 = parseInt(this.ACC.toString(16));
        num = parseInt(num.toString(16));
        let res = num2 - num;
        res -= (this.flags.carry) ? 0 : 1;
        if (res < 0) {
            this.flags.carry = false;
            res += 100;
        }
        else {
            this.flags.carry = true;
        }
        this.ACC = parseInt(res.toString(), 16);
    }
    else {
        let mask = 0xFF;
        let flipBits = num ^ mask;
        ADC.call(this, flipBits);
    }
}
opTable[0xE9] = {
    name: "SBC (imm)",
    bytes: 2,
    cycles: 2,
    execute: function () {
        SBC.call(this, this.nextByte());
    }
};
opTable[0xE5] = {
    name: "SBC (zpg)",
    bytes: 2,
    cycles: 3,
    execute: function () {
        let num = this.mem[this.getZPageRef()];
        SBC.call(this, num);
    }
};
opTable[0xF5] = {
    name: "SBC (zpg, X)",
    bytes: 2,
    cycles: 4,
    execute: function () {
        let num = this.mem[this.getZPageRef(this.X)];
        SBC.call(this, num);
    }
};
opTable[0xED] = {
    name: "SBC (abs)",
    bytes: 3,
    cycles: 4,
    execute: function () {
        let num = this.mem[this.getRef()];
        SBC.call(this, num);
    }
};
opTable[0xFD] = {
    name: "SBC (abs, X)",
    bytes: 3,
    cycles: 4,
    execute: function () {
        let num = this.mem[this.getRef(this.X)];
        SBC.call(this, num);
    }
};
opTable[0xF9] = {
    name: "SBC (abs, Y)",
    bytes: 3,
    cycles: 4,
    execute: function () {
        let num = this.mem[this.getRef(this.Y)];
        SBC.call(this, num);
    }
};
opTable[0xE1] = {
    name: "SBC (ind, X)",
    bytes: 2,
    cycles: 6,
    execute: function () {
        let num = this.mem[this.getIndrXRef()];
        SBC.call(this, num);
    }
};
opTable[0xF1] = {
    name: "SBC (ind), Y",
    bytes: 2,
    cycles: 6,
    execute: function () {
        let num = this.mem[this.getIndrYRef()];
        SBC.call(this, num);
    }
};
opTable[0xEA] = {
    name: "NOP",
    bytes: 1,
    cycles: 1,
    execute: function () { }
};
opTable[0xE6] = {
    name: "INC (zpg)",
    bytes: 2,
    cycles: 5,
    execute: function () {
        let addr = this.getZPageRef();
        this.mem[addr] = addWrap(this.mem[addr], 1);
        this.updateNumStateFlags(this.mem[addr]);
    }
};
opTable[0xF6] = {
    name: "INC (zpg, X)",
    bytes: 2,
    cycles: 6,
    execute: function () {
        let addr = this.getZPageRef(this.X);
        this.mem[addr] = addWrap(this.mem[addr], 1);
        this.updateNumStateFlags(this.mem[addr]);
    }
};
opTable[0xEE] = {
    name: "INC (abs)",
    bytes: 3,
    cycles: 6,
    execute: function () {
        let addr = this.getRef();
        this.mem[addr] = addWrap(this.mem[addr], 1);
        this.updateNumStateFlags(this.mem[addr]);
    }
};
opTable[0xFE] = {
    name: "INC (abs, X)",
    bytes: 3,
    cycles: 7,
    execute: function () {
        let addr = this.getRef(this.X);
        this.mem[addr] = addWrap(this.mem[addr], 1);
        this.updateNumStateFlags(this.mem[addr]);
    }
};
opTable[0xE8] = {
    name: "INX",
    bytes: 1,
    cycles: 2,
    execute: function () {
        this.X = addWrap(this.X, 1);
        this.updateNumStateFlags(this.X);
    }
};
opTable[0xC8] = {
    name: "INY",
    bytes: 1,
    cycles: 2,
    execute: function () {
        this.Y = addWrap(this.Y, 1);
        this.updateNumStateFlags(this.Y);
    }
};
opTable[0xC6] = {
    name: "DEC (zpg)",
    bytes: 2,
    cycles: 5,
    execute: function () {
        let addr = this.getZPageRef();
        this.mem[addr] = addWrap(this.mem[addr], -1);
        this.updateNumStateFlags(this.mem[addr]);
    }
};
opTable[0xD6] = {
    name: "DEC (zpg, X)",
    bytes: 2,
    cycles: 6,
    execute: function () {
        let addr = this.getZPageRef(this.X);
        this.mem[addr] = addWrap(this.mem[addr], -1);
        this.updateNumStateFlags(this.mem[addr]);
    }
};
opTable[0xCE] = {
    name: "DEC (abs)",
    bytes: 3,
    cycles: 3,
    execute: function () {
        let addr = this.getRef();
        this.mem[addr] = addWrap(this.mem[addr], -1);
        this.updateNumStateFlags(this.mem[addr]);
    }
};
opTable[0xDE] = {
    name: "DEC (abs, X)",
    bytes: 3,
    cycles: 7,
    execute: function () {
        let addr = this.getRef(this.X);
        this.mem[addr] = addWrap(this.mem[addr], -1);
        this.updateNumStateFlags(this.mem[addr]);
    }
};
opTable[0xCA] = {
    name: "DEX",
    bytes: 1,
    cycles: 2,
    execute: function () {
        this.X = addWrap(this.X, -1);
        this.updateNumStateFlags(this.X);
    }
};
opTable[0x88] = {
    name: "DEY",
    bytes: 1,
    cycles: 2,
    execute: function () {
        this.Y = addWrap(this.Y, -1);
        this.updateNumStateFlags(this.Y);
    }
};
opTable[0x18] = {
    name: "CLC",
    bytes: 1,
    cycles: 2,
    execute: function () {
        this.flags.carry = false;
    }
};
opTable[0xD8] = {
    name: "CLD",
    bytes: 1,
    cycles: 2,
    execute: function () {
        this.flags.decimalMode = false;
    }
};
opTable[0xB8] = {
    name: "CLV",
    bytes: 1,
    cycles: 2,
    execute: function () {
        this.flags.overflow = false;
    }
};
opTable[0x58] = {
    name: "CLI",
    bytes: 1,
    cycles: 2,
    execute: function () {
        this.flags.interruptDisable = false;
    }
};
opTable[0x38] = {
    name: "SEC",
    bytes: 1,
    cycles: 2,
    execute: function () {
        this.flags.carry = true;
    }
};
opTable[0xF8] = {
    name: "SED",
    bytes: 1,
    cycles: 2,
    execute: function () {
        this.flags.decimalMode = true;
    }
};
opTable[0x78] = {
    name: "SEI",
    bytes: 1,
    cycles: 2,
    execute: function () {
        this.flags.interruptDisable = true;
    }
};
function CMP(num, register) {
    this.flags.zero = (register == num);
    let res = register - num;
    res += (res < 0) ? 0x10000 : 0;
    this.updateNegativeFlag(res);
    this.flags.carry = (register >= num);
}
opTable[0xC9] = {
    name: "CMP (imm)",
    bytes: 2,
    cycles: 2,
    execute: function () {
        CMP.call(this, this.nextByte(), this.ACC);
    }
};
opTable[0xC5] = {
    name: "CMP (zpg)",
    bytes: 2,
    cycles: 3,
    execute: function () {
        CMP.call(this, this.mem[this.getZPageRef()], this.ACC);
    }
};
opTable[0xD5] = {
    name: "CMP (zpg, X)",
    bytes: 2,
    cycles: 4,
    execute: function () {
        CMP.call(this, this.mem[this.getZPageRef(this.X)], this.ACC);
    }
};
opTable[0xCD] = {
    name: "CMP (abs)",
    bytes: 3,
    cycles: 4,
    execute: function () {
        CMP.call(this, this.mem[this.getRef()], this.ACC);
    }
};
opTable[0xDD] = {
    name: "CMP (abs, X)",
    bytes: 3,
    cycles: 4,
    execute: function () {
        CMP.call(this, this.mem[this.getRef(this.X)], this.ACC);
    }
};
opTable[0xD9] = {
    name: "CMP (abs, Y)",
    bytes: 3,
    cycles: 4,
    execute: function () {
        CMP.call(this, this.mem[this.getRef(this.Y)], this.ACC);
    }
};
opTable[0xC1] = {
    name: "CMP (ind, X)",
    bytes: 2,
    cycles: 6,
    execute: function () {
        CMP.call(this, this.mem[this.getIndrXRef()], this.ACC);
    }
};
opTable[0xD1] = {
    name: "CMP (ind), Y",
    bytes: 2,
    cycles: 5,
    execute: function () {
        CMP.call(this, this.mem[this.getIndrYRef()], this.ACC);
    }
};
opTable[0xE0] = {
    name: "CPX (imm)",
    bytes: 2,
    cycles: 2,
    execute: function () {
        CMP.call(this, this.nextByte(), this.X);
    }
};
opTable[0xE4] = {
    name: "CPX (zpg)",
    bytes: 2,
    cycles: 3,
    execute: function () {
        CMP.call(this, this.mem[this.getZPageRef()], this.X);
    }
};
opTable[0xEC] = {
    name: "CPX (abs)",
    bytes: 3,
    cycles: 4,
    execute: function () {
        CMP.call(this, this.mem[this.getRef()], this.X);
    }
};
opTable[0xC0] = {
    name: "CPY (imm)",
    bytes: 2,
    cycles: 2,
    execute: function () {
        CMP.call(this, this.nextByte(), this.Y);
    }
};
opTable[0xC4] = {
    name: "CPY (zpg)",
    bytes: 2,
    cycles: 3,
    execute: function () {
        CMP.call(this, this.mem[this.getZPageRef()], this.Y);
    }
};
opTable[0xCC] = {
    name: "CPY (abs)",
    bytes: 3,
    cycles: 4,
    execute: function () {
        CMP.call(this, this.mem[this.getRef()], this.Y);
    }
};
opTable[0x29] = {
    name: "AND (imm)",
    bytes: 2,
    cycles: 2,
    execute: function () {
        this.ACC = this.ACC & this.nextByte();
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x25] = {
    name: "AND (zpg)",
    bytes: 2,
    cycles: 3,
    execute: function () {
        this.ACC = this.ACC & this.mem[this.getZPageRef()];
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x35] = {
    name: "AND (zpg, X)",
    bytes: 2,
    cycles: 4,
    execute: function () {
        this.ACC = this.ACC & this.mem[this.getZPageRef(this.X)];
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x2D] = {
    name: "AND (abs)",
    bytes: 3,
    cycles: 4,
    execute: function () {
        this.ACC = this.ACC & this.mem[this.getRef()];
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x3D] = {
    name: "AND (abs, X)",
    bytes: 3,
    cycles: 4,
    execute: function () {
        this.ACC = this.ACC & this.mem[this.getRef(this.X)];
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x39] = {
    name: "AND (abs, Y)",
    bytes: 3,
    cycles: 4,
    execute: function () {
        this.ACC = this.ACC & this.mem[this.getRef(this.Y)];
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x21] = {
    name: "AND (ind, X)",
    bytes: 2,
    cycles: 6,
    execute: function () {
        this.ACC = this.ACC & this.mem[this.getIndrXRef()];
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x31] = {
    name: "AND (ind), Y",
    bytes: 2,
    cycles: 5,
    execute: function () {
        this.ACC = this.ACC & this.mem[this.getIndrYRef()];
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x09] = {
    name: "ORA (imm)",
    bytes: 2,
    cycles: 2,
    execute: function () {
        this.ACC = this.ACC | this.nextByte();
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x05] = {
    name: "ORA (zpg)",
    bytes: 2,
    cycles: 3,
    execute: function () {
        this.ACC = this.ACC | this.mem[this.getZPageRef()];
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x15] = {
    name: "ORA (zpg, X)",
    bytes: 2,
    cycles: 4,
    execute: function () {
        this.ACC = this.ACC | this.mem[this.getZPageRef(this.X)];
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x0D] = {
    name: "ORA (abs)",
    bytes: 3,
    cycles: 4,
    execute: function () {
        this.ACC = this.ACC | this.mem[this.getRef()];
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x1D] = {
    name: "ORA (abs, X)",
    bytes: 3,
    cycles: 4,
    execute: function () {
        this.ACC = this.ACC | this.mem[this.getRef(this.X)];
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x19] = {
    name: "ORA (abs, Y)",
    bytes: 3,
    cycles: 4,
    execute: function () {
        this.ACC = this.ACC | this.mem[this.getRef(this.Y)];
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x01] = {
    name: "ORA (ind, X)",
    bytes: 2,
    cycles: 6,
    execute: function () {
        this.ACC = this.ACC | this.mem[this.getIndrXRef()];
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x11] = {
    name: "ORA (ind), Y",
    bytes: 2,
    cycles: 5,
    execute: function () {
        this.ACC = this.ACC | this.mem[this.getIndrYRef()];
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x49] = {
    name: "EOR (imm)",
    bytes: 2,
    cycles: 2,
    execute: function () {
        this.ACC = this.ACC ^ this.nextByte();
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x45] = {
    name: "EOR (zpg)",
    bytes: 2,
    cycles: 3,
    execute: function () {
        this.ACC = this.ACC ^ this.mem[this.getZPageRef()];
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x55] = {
    name: "EOR (zpg, X)",
    bytes: 2,
    cycles: 4,
    execute: function () {
        this.ACC = this.ACC ^ this.mem[this.getZPageRef(this.X)];
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x4D] = {
    name: "EOR (abs)",
    bytes: 3,
    cycles: 4,
    execute: function () {
        this.ACC = this.ACC ^ this.mem[this.getRef()];
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x5D] = {
    name: "EOR (abs, X)",
    bytes: 3,
    cycles: 4,
    execute: function () {
        this.ACC = this.ACC ^ this.mem[this.getRef(this.X)];
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x59] = {
    name: "EOR (abs, Y)",
    bytes: 3,
    cycles: 4,
    execute: function () {
        this.ACC = this.ACC ^ this.mem[this.getRef(this.Y)];
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x41] = {
    name: "EOR (ind, X)",
    bytes: 2,
    cycles: 6,
    execute: function () {
        this.ACC = this.ACC ^ this.mem[this.getIndrXRef()];
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x51] = {
    name: "EOR (ind), Y",
    bytes: 2,
    cycles: 5,
    execute: function () {
        this.ACC = this.ACC ^ this.mem[this.getIndrYRef()];
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x0A] = {
    name: "ASL",
    bytes: 1,
    cycles: 2,
    execute: function () {
        this.flags.carry = (this.ACC >= 0x80);
        this.ACC = this.ACC << 1;
        this.ACC -= (this.flags.carry) ? 0x100 : 0;
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x06] = {
    name: "ASL (zpg)",
    bytes: 2,
    cycles: 5,
    execute: function () {
        let addr = this.getZPageRef();
        this.flags.carry = (this.mem[addr] >= 0x80);
        this.mem[addr] = this.mem[addr] << 1;
        this.mem[addr] -= (this.flags.carry) ? 0x100 : 0;
        this.updateNumStateFlags(this.mem[addr]);
    }
};
opTable[0x16] = {
    name: "ASL (zpg, X)",
    bytes: 2,
    cycles: 6,
    execute: function () {
        let addr = this.getZPageRef(this.X);
        this.flags.carry = (this.mem[addr] >= 0x80);
        this.mem[addr] = this.mem[addr] << 1;
        this.mem[addr] -= (this.flags.carry) ? 0x100 : 0;
        this.updateNumStateFlags(this.mem[addr]);
    }
};
opTable[0x0E] = {
    name: "ASL (abs)",
    bytes: 3,
    cycles: 6,
    execute: function () {
        let addr = this.getRef();
        this.flags.carry = (this.mem[addr] >= 0x80);
        this.mem[addr] = this.mem[addr] << 1;
        this.mem[addr] -= (this.flags.carry) ? 0x100 : 0;
        this.updateNumStateFlags(this.mem[addr]);
    }
};
opTable[0x1E] = {
    name: "ASL (abs, X)",
    bytes: 3,
    cycles: 7,
    execute: function () {
        let addr = this.getRef(this.X);
        this.flags.carry = (this.mem[addr] >= 0x80);
        this.mem[addr] = this.mem[addr] << 1;
        this.mem[addr] -= (this.flags.carry) ? 0x100 : 0;
        this.updateNumStateFlags(this.mem[addr]);
    }
};
opTable[0x4A] = {
    name: "LSR",
    bytes: 1,
    cycles: 2,
    execute: function () {
        this.flags.carry = (this.ACC % 2 == 1);
        this.ACC = this.ACC >> 1;
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x46] = {
    name: "LSR (zpg)",
    bytes: 2,
    cycles: 5,
    execute: function () {
        let addr = this.getZPageRef();
        this.flags.carry = (this.mem[addr] % 2 == 1);
        this.mem[addr] = this.mem[addr] >> 1;
        this.updateNumStateFlags(this.mem[addr]);
    }
};
opTable[0x56] = {
    name: "LSR (zpg, X)",
    bytes: 2,
    cycles: 6,
    execute: function () {
        let addr = this.getZPageRef(this.X);
        this.flags.carry = (this.mem[addr] % 2 == 1);
        this.mem[addr] = this.mem[addr] >> 1;
        this.updateNumStateFlags(this.mem[addr]);
    }
};
opTable[0x4E] = {
    name: "LSR (abs)",
    bytes: 3,
    cycles: 6,
    execute: function () {
        let addr = this.getRef();
        this.flags.carry = (this.mem[addr] % 2 == 1);
        this.mem[addr] = this.mem[addr] >> 1;
        this.updateNumStateFlags(this.mem[addr]);
    }
};
opTable[0x5E] = {
    name: "LSR (abs, X)",
    bytes: 3,
    cycles: 7,
    execute: function () {
        let addr = this.getRef(this.X);
        this.flags.carry = (this.mem[addr] % 2 == 1);
        this.mem[addr] = this.mem[addr] >> 1;
        this.updateNumStateFlags(this.mem[addr]);
    }
};
opTable[0x24] = {
    name: "BIT (zpg)",
    bytes: 2,
    cycles: 3,
    execute: function () {
        let addr = this.getZPageRef();
        let res = this.ACC & this.mem[addr];
        this.flags.zero = (res == 0x00);
        this.updateNegativeFlag(this.mem[addr]);
        let mask = 1 << 6; //6th bit mask
        this.flags.overflow = ((this.mem[addr] & mask) != 0);
    }
};
opTable[0x2C] = {
    name: "BIT (abs)",
    bytes: 3,
    cycles: 4,
    execute: function () {
        let addr = this.getRef();
        let res = this.ACC & this.mem[addr];
        this.flags.zero = (res == 0x00);
        this.updateNegativeFlag(this.mem[addr]);
        let mask = 1 << 6; //6th bit mask
        this.flags.overflow = ((this.mem[addr] & mask) != 0);
    }
};
opTable[0x2A] = {
    name: "ROL",
    bytes: 1,
    cycles: 2,
    execute: function () {
        //Store current carry bit for later
        let addBit = this.flags.carry;
        //Move MSB to carry flag
        this.flags.carry = (this.ACC >= 0x80);
        //Shift one place to the left
        this.ACC = this.ACC << 1;
        //Drop MSB
        this.ACC -= (this.flags.carry) ? 0x100 : 0;
        //Make the prev carry bit the LSB
        this.ACC += addBit;
        //Update flags
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x26] = {
    name: "ROL (zpg)",
    bytes: 2,
    cycles: 5,
    execute: function () {
        let addr = this.getZPageRef();
        let addBit = this.flags.carry;
        this.flags.carry = (this.mem[addr] >= 0x80);
        this.mem[addr] = this.mem[addr] << 1;
        this.mem[addr] -= (this.flags.carry) ? 0x100 : 0;
        this.mem[addr] += addBit;
        this.updateNumStateFlags(this.mem[addr]);
    }
};
opTable[0x36] = {
    name: "ROL (zpg, X)",
    bytes: 2,
    cycles: 6,
    execute: function () {
        let addr = this.getZPageRef(this.X);
        let addBit = this.flags.carry;
        this.flags.carry = (this.mem[addr] >= 0x80);
        this.mem[addr] = this.mem[addr] << 1;
        this.mem[addr] -= (this.flags.carry) ? 0x100 : 0;
        this.mem[addr] += addBit;
        this.updateNumStateFlags(this.mem[addr]);
    }
};
opTable[0x2E] = {
    name: "ROL (abs)",
    bytes: 3,
    cycles: 6,
    execute: function () {
        let addr = this.getRef();
        let addBit = this.flags.carry;
        this.flags.carry = (this.mem[addr] >= 0x80);
        this.mem[addr] = this.mem[addr] << 1;
        this.mem[addr] -= (this.flags.carry) ? 0x100 : 0;
        this.mem[addr] += addBit;
        this.updateNumStateFlags(this.mem[addr]);
    }
};
opTable[0x3E] = {
    name: "ROL (abs, X)",
    bytes: 3,
    cycles: 7,
    execute: function () {
        let addr = this.getRef(this.X);
        let addBit = this.flags.carry;
        this.flags.carry = (this.mem[addr] >= 0x80);
        this.mem[addr] = this.mem[addr] << 1;
        this.mem[addr] -= (this.flags.carry) ? 0x100 : 0;
        this.mem[addr] += addBit;
        this.updateNumStateFlags(this.mem[addr]);
    }
};
opTable[0x6A] = {
    name: "ROR",
    bytes: 1,
    cycles: 2,
    execute: function () {
        //Store current carry bit for later
        let addBit = (this.flags.carry) ? 0x80 : 0;
        //Move LSB to carry flag
        this.flags.carry = (this.ACC % 2 == 1);
        //Shift number one place to the right
        this.ACC = this.ACC >> 1;
        //Make the prev carry bit the MSB
        this.ACC += addBit;
        //Update flags
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x66] = {
    name: "ROR (zpg)",
    bytes: 2,
    cycles: 5,
    execute: function () {
        let addr = this.getZPageRef();
        let addBit = (this.flags.carry) ? 0x80 : 0;
        this.flags.carry = (this.mem[addr] % 2 == 1);
        this.mem[addr] = this.mem[addr] >> 1;
        this.mem[addr] += addBit;
        this.updateNumStateFlags(this.mem[addr]);
    }
};
opTable[0x76] = {
    name: "ROR (zpg, X)",
    bytes: 2,
    cycles: 6,
    execute: function () {
        let addr = this.getZPageRef(this.X);
        let addBit = (this.flags.carry) ? 0x80 : 0;
        this.flags.carry = (this.mem[addr] % 2 == 1);
        this.mem[addr] = this.mem[addr] >> 1;
        this.mem[addr] += addBit;
        this.updateNumStateFlags(this.mem[addr]);
    }
};
opTable[0x6E] = {
    name: "ROR (abs)",
    bytes: 3,
    cycles: 6,
    execute: function () {
        let addr = this.getRef();
        let addBit = (this.flags.carry) ? 0x80 : 0;
        this.flags.carry = (this.mem[addr] % 2 == 1);
        this.mem[addr] = this.mem[addr] >> 1;
        this.mem[addr] += addBit;
        this.updateNumStateFlags(this.mem[addr]);
    }
};
opTable[0x7E] = {
    name: "ROR (abs, X)",
    bytes: 3,
    cycles: 7,
    execute: function () {
        let addr = this.getRef(this.X);
        let addBit = (this.flags.carry) ? 0x80 : 0;
        this.flags.carry = (this.mem[addr] % 2 == 1);
        this.mem[addr] = this.mem[addr] >> 1;
        this.mem[addr] += addBit;
        this.updateNumStateFlags(this.mem[addr]);
    }
};
function branch() {
    let dist = this.nextByte();
    dist -= (dist < 0x80) ? 0 : 0x100;
    if (this.debug) {
        console.log(`Branching ${dist} bytes...`);
    }
    if (dist == -2 && this.detectTraps) {
        console.log(`TRAPPED at 0x${this.PC.toString(16).padStart(4, "0").toUpperCase()}`);
        this.flags.break = true;
    }
    this.PC += dist;
}
opTable[0x90] = {
    name: "BCC",
    bytes: 2,
    cycles: 2,
    execute: function () {
        if (!this.flags.carry) {
            branch.call(this);
        }
    }
};
opTable[0xB0] = {
    name: "BCS",
    bytes: 2,
    cycles: 2,
    execute: function () {
        if (this.flags.carry) {
            branch.call(this);
        }
    }
};
opTable[0x30] = {
    name: "BMI",
    bytes: 2,
    cycles: 2,
    execute: function () {
        if (this.flags.negative) {
            branch.call(this);
        }
    }
};
opTable[0x10] = {
    name: "BPL",
    bytes: 2,
    cycles: 2,
    execute: function () {
        if (!this.flags.negative) {
            branch.call(this);
        }
    }
};
opTable[0xF0] = {
    name: "BEQ",
    bytes: 2,
    cycles: 2,
    execute: function () {
        if (this.flags.zero) {
            branch.call(this);
        }
    }
};
opTable[0xD0] = {
    name: "BNE",
    bytes: 2,
    cycles: 2,
    execute: function () {
        if (!this.flags.zero) {
            branch.call(this);
        }
    }
};
opTable[0x50] = {
    name: "BVC",
    bytes: 2,
    cycles: 2,
    execute: function () {
        if (!this.flags.overflow) {
            branch.call(this);
        }
    }
};
opTable[0x70] = {
    name: "BVS",
    bytes: 2,
    cycles: 2,
    execute: function () {
        if (this.flags.overflow) {
            branch.call(this);
        }
    }
};
opTable[0x4C] = {
    name: "JMP (abs)",
    bytes: 3,
    cycles: 3,
    execute: function () {
        let addr = this.getRef();
        if (this.debug) {
            console.log(`Jumping to location 0x${addr.toString(16).padStart(4, "0")}...`);
        }
        if (addr == this.PC && this.detectTraps) {
            console.log(`TRAPPED at 0x${this.PC.toString(16).padStart(4, "0").toUpperCase()}`);
            this.flags.break = true;
        }
        this.PC = addr - 3;
    }
};
opTable[0x6C] = {
    name: "JMP (ind)",
    bytes: 3,
    cycles: 5,
    execute: function () {
        let indAddr = this.next2Bytes();
        let addr = combineHex(this.mem[indAddr + 1], this.mem[indAddr]);
        if (this.debug) {
            console.log(`Jumping to location 0x${addr}...`);
        }
        if (addr == this.PC && this.detectTraps) {
            console.log(`TRAPPED at 0x${this.PC.toString(16).padStart(4, "0").toUpperCase()}`);
            this.flags.break = true;
        }
        this.PC = addr - 3;
    }
};
opTable[0x20] = {
    name: "JSR",
    bytes: 3,
    cycles: 6,
    execute: function () {
        let addr = this.getRef();
        if (this.debug) {
            console.log(`Jumping to subroutine at 0x${addr.toString(16).padStart(4, "0").toUpperCase()}...`);
        }
        //Split PC and add each addr byte to stack
        let bytes = splitHex(this.PC + 2);
        this.pushStack(bytes[0]);
        this.pushStack(bytes[1]);
        this.PC = addr - 3;
    }
};
opTable[0x60] = {
    name: "RTS",
    bytes: 1,
    cycles: 6,
    execute: function () {
        let loByte = this.pullStack();
        let hiByte = this.pullStack();
        let addr = combineHex(hiByte, loByte);
        if (this.debug) {
            console.log(`Return to location 0x${addr.toString(16).padStart(4, "0").toUpperCase()} from subroutine...`);
        }
        this.PC = addr;
    }
};
opTable[0x48] = {
    name: "PHA",
    bytes: 1,
    cycles: 3,
    execute: function () {
        this.pushStack(this.ACC);
    }
};
opTable[0x08] = {
    name: "PHP",
    bytes: 1,
    cycles: 3,
    execute: function () {
        let statusByte = 0x00;
        //Set each bit accoriding to flags
        statusByte += (this.flags.carry) ? 1 : 0;
        statusByte += (this.flags.zero) ? 2 : 0;
        statusByte += (this.flags.interruptDisable) ? 4 : 0;
        statusByte += (this.flags.decimalMode) ? 8 : 0;
        statusByte += 16; //Always set the break bit from software
        statusByte += 32; //This bit always set
        statusByte += (this.flags.overflow) ? 64 : 0;
        statusByte += (this.flags.negative) ? 128 : 0;
        this.pushStack(statusByte);
    }
};
opTable[0x68] = {
    name: "PLA",
    bytes: 1,
    cycles: 4,
    execute: function () {
        this.ACC = this.pullStack();
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x28] = {
    name: "PLP",
    bytes: 1,
    cycles: 4,
    execute: function () {
        let sByte = this.pullStack();
        //Adjust mask and check each indv bit for each flag
        let mask = 1;
        this.flags.carry = ((sByte & mask) != 0);
        mask = 1 << 1;
        this.flags.zero = ((sByte & mask) != 0);
        mask = 1 << 2;
        this.flags.interruptDisable = ((sByte & mask) != 0);
        mask = 1 << 3;
        this.flags.decimalMode = ((sByte & mask) != 0);
        mask = 1 << 6;
        this.flags.overflow = ((sByte & mask) != 0);
        mask = 1 << 7;
        this.flags.negative = ((sByte & mask) != 0);
    }
};
opTable[0x40] = {
    name: "RTI",
    bytes: 1,
    cycles: 6,
    execute: function () {
        //Pull processor flags from stack
        let sByte = this.pullStack();
        //Adjust mask and check each indv bit for each flag
        let mask = 1;
        this.flags.carry = ((sByte & mask) != 0);
        mask = 1 << 1;
        this.flags.zero = ((sByte & mask) != 0);
        mask = 1 << 2;
        this.flags.interruptDisable = ((sByte & mask) != 0);
        mask = 1 << 3;
        this.flags.decimalMode = ((sByte & mask) != 0);
        mask = 1 << 6;
        this.flags.overflow = ((sByte & mask) != 0);
        mask = 1 << 7;
        this.flags.negative = ((sByte & mask) != 0);
        //Pull PC from stack
        let loByte = this.pullStack();
        let hiByte = this.pullStack();
        let addr = combineHex(hiByte, loByte);
        if (this.debug) {
            console.log(`Return to location 0x${addr.toString(16).padStart(4, "0").toUpperCase()} from interrupt...`);
        }
        this.PC = addr - 1;
    }
};
//UNOFFICIAL OPCODES
opTable[0xEB] = {
    name: "SBC (imm, unoffical)",
    bytes: 2,
    cycles: 2,
    execute: function () {
        SBC.call(this, this.nextByte());
    }
};
//NOP
opTable[0x1A] = {
    name: "NOP",
    bytes: 1,
    cycles: 2,
    execute: function () { }
};
opTable[0x3A] = {
    name: "NOP",
    bytes: 1,
    cycles: 2,
    execute: function () { }
};
opTable[0x5A] = {
    name: "NOP",
    bytes: 1,
    cycles: 2,
    execute: function () { }
};
opTable[0x7A] = {
    name: "NOP",
    bytes: 1,
    cycles: 2,
    execute: function () { }
};
opTable[0xDA] = {
    name: "NOP",
    bytes: 1,
    cycles: 2,
    execute: function () { }
};
opTable[0xFA] = {
    name: "NOP",
    bytes: 1,
    cycles: 2,
    execute: function () { }
};
opTable[0x04] = {
    name: "DOP",
    bytes: 2,
    cycles: 3,
    execute: function () { }
};
opTable[0x14] = {
    name: "DOP",
    bytes: 2,
    cycles: 4,
    execute: function () { }
};
opTable[0x34] = {
    name: "DOP",
    bytes: 2,
    cycles: 4,
    execute: function () { }
};
opTable[0x44] = {
    name: "DOP",
    bytes: 2,
    cycles: 3,
    execute: function () { }
};
opTable[0x54] = {
    name: "DOP",
    bytes: 2,
    cycles: 4,
    execute: function () { }
};
opTable[0x64] = {
    name: "DOP",
    bytes: 2,
    cycles: 3,
    execute: function () { }
};
opTable[0x74] = {
    name: "DOP",
    bytes: 2,
    cycles: 4,
    execute: function () { }
};
opTable[0x80] = {
    name: "DOP",
    bytes: 2,
    cycles: 2,
    execute: function () { }
};
opTable[0x82] = {
    name: "DOP",
    bytes: 2,
    cycles: 2,
    execute: function () { }
};
opTable[0x89] = {
    name: "DOP",
    bytes: 2,
    cycles: 2,
    execute: function () { }
};
opTable[0xC2] = {
    name: "DOP",
    bytes: 2,
    cycles: 2,
    execute: function () { }
};
opTable[0xD4] = {
    name: "DOP",
    bytes: 2,
    cycles: 4,
    execute: function () { }
};
opTable[0xE2] = {
    name: "DOP",
    bytes: 2,
    cycles: 2,
    execute: function () { }
};
opTable[0xF4] = {
    name: "DOP",
    bytes: 2,
    cycles: 4,
    execute: function () { }
};
opTable[0x0C] = {
    name: "TOP",
    bytes: 3,
    cycles: 4,
    execute: function () { }
};
opTable[0x1C] = {
    name: "TOP",
    bytes: 3,
    cycles: 1,
    execute: function () { }
};
opTable[0x3C] = {
    name: "TOP",
    bytes: 3,
    cycles: 4,
    execute: function () { }
};
opTable[0x5C] = {
    name: "TOP",
    bytes: 3,
    cycles: 4,
    execute: function () { }
};
opTable[0x7C] = {
    name: "TOP",
    bytes: 3,
    cycles: 4,
    execute: function () { }
};
opTable[0xDC] = {
    name: "TOP",
    bytes: 3,
    cycles: 4,
    execute: function () { }
};
opTable[0xFC] = {
    name: "TOP",
    bytes: 3,
    cycles: 4,
    execute: function () { }
};
//LAX
opTable[0xA3] = {
    name: "LAX (ind, X)",
    bytes: 2,
    cycles: 6,
    execute: function () {
        let addr = this.getIndrXRef();
        this.ACC = this.X + this.mem[addr];
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0xB3] = {
    name: "LAX (ind), Y",
    bytes: 2,
    cycles: 5,
    execute: function () {
        let addr = this.getIndrYRef();
        this.ACC = this.X + this.mem[addr];
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0xA7] = {
    name: "LAX (zpg)",
    bytes: 2,
    cycles: 3,
    execute: function () {
        let addr = this.getZPageRef();
        this.ACC = this.X + this.mem[addr];
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0xB7] = {
    name: "LAX (zpg, Y)",
    bytes: 2,
    cycles: 4,
    execute: function () {
        let addr = this.getZPageRef(this.Y);
        this.ACC = this.X + this.mem[addr];
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0xAF] = {
    name: "LAX (abs)",
    bytes: 3,
    cycles: 4,
    execute: function () {
        let addr = this.getRef();
        this.ACC = this.X + this.mem[addr];
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0xBF] = {
    name: "LAX (abs)",
    bytes: 3,
    cycles: 4,
    execute: function () {
        let addr = this.getRef(this.Y);
        this.ACC = this.X + this.mem[addr];
        this.updateNumStateFlags(this.ACC);
    }
};
//AND X with ACC and store result in memory
opTable[0x87] = {
    name: "AAX (zpg)",
    bytes: 2,
    cycles: 3,
    execute: function () {
        let addr = this.getZPageRef();
        this.mem[addr] = this.ACC & this.X;
        this.updateNumStateFlags(this.mem[addr]);
    }
};
opTable[0x97] = {
    name: "AAX (zpg, Y)",
    bytes: 2,
    cycles: 4,
    execute: function () {
        let addr = this.getZPageRef(this.Y);
        this.mem[addr] = this.ACC & this.X;
        this.updateNumStateFlags(this.mem[addr]);
    }
};
opTable[0x83] = {
    name: "AAX (ind, X)",
    bytes: 2,
    cycles: 6,
    execute: function () {
        let addr = this.getIndrXRef();
        this.mem[addr] = this.ACC & this.X;
        this.updateNumStateFlags(this.mem[addr]);
    }
};
opTable[0x8F] = {
    name: "AAX (abs)",
    bytes: 3,
    cycles: 4,
    execute: function () {
        let addr = this.getRef();
        this.mem[addr] = this.ACC & this.X;
        this.updateNumStateFlags(this.mem[addr]);
    }
};
//DCP
//Subtract 1 from memory content, then CMP with ACC
opTable[0xC7] = {
    name: "DCP (zpg)",
    bytes: 2,
    cycles: 5,
    execute: function () {
        let addr = this.getZPageRef();
        this.mem[addr]--;
        CMP.call(this, this.mem[addr], this.ACC);
    }
};
opTable[0xD7] = {
    name: "DCP (zpg, X)",
    bytes: 2,
    cycles: 6,
    execute: function () {
        let addr = this.getZPageRef(this.X);
        this.mem[addr]--;
        CMP.call(this, this.mem[addr], this.ACC);
    }
};
opTable[0xCF] = {
    name: "DCP (abs)",
    bytes: 3,
    cycles: 6,
    execute: function () {
        let addr = this.getRef();
        this.mem[addr]--;
        CMP.call(this, this.mem[addr], this.ACC);
    }
};
opTable[0xDF] = {
    name: "DCP (zpg, X)",
    bytes: 3,
    cycles: 7,
    execute: function () {
        let addr = this.getRef(this.X);
        this.mem[addr]--;
        CMP.call(this, this.mem[addr], this.ACC);
    }
};
opTable[0xDB] = {
    name: "DCP (zpg, Y)",
    bytes: 3,
    cycles: 7,
    execute: function () {
        let addr = this.getRef(this.Y);
        this.mem[addr]--;
        CMP.call(this, this.mem[addr], this.ACC);
    }
};
opTable[0xC3] = {
    name: "DCP (ind, X)",
    bytes: 2,
    cycles: 8,
    execute: function () {
        let addr = this.getIndrXRef();
        this.mem[addr]--;
        CMP.call(this, this.mem[addr], this.ACC);
    }
};
opTable[0xD3] = {
    name: "DCP (ind), Y",
    bytes: 2,
    cycles: 8,
    execute: function () {
        let addr = this.getIndrYRef();
        this.mem[addr]--;
        CMP.call(this, this.mem[addr], this.ACC);
    }
};
//ISC
//Increase memory content by 1, then SBC from the ACC
opTable[0xE7] = {
    name: "ISC (zpg)",
    bytes: 2,
    cycles: 5,
    execute: function () {
        let addr = this.getZPageRef();
        this.mem[addr]++;
        SBC.call(this, this.mem[addr]);
    }
};
opTable[0xF7] = {
    name: "ISC (zpg, X)",
    bytes: 2,
    cycles: 6,
    execute: function () {
        let addr = this.getZPageRef(this.X);
        this.mem[addr]++;
        SBC.call(this, this.mem[addr]);
    }
};
opTable[0xEF] = {
    name: "ISC (abs)",
    bytes: 3,
    cycles: 6,
    execute: function () {
        let addr = this.getRef();
        this.mem[addr]++;
        SBC.call(this, this.mem[addr]);
    }
};
opTable[0xFF] = {
    name: "ISC (abs, X)",
    bytes: 3,
    cycles: 7,
    execute: function () {
        let addr = this.getRef(this.X);
        this.mem[addr]++;
        SBC.call(this, this.mem[addr]);
    }
};
opTable[0xFB] = {
    name: "ISC (abs, Y)",
    bytes: 3,
    cycles: 7,
    execute: function () {
        let addr = this.getRef(this.Y);
        this.mem[addr]++;
        SBC.call(this, this.mem[addr]);
    }
};
opTable[0xE3] = {
    name: "ISC (ind, X)",
    bytes: 2,
    cycles: 8,
    execute: function () {
        let addr = this.getIndrXRef();
        this.mem[addr]++;
        SBC.call(this, this.mem[addr]);
    }
};
opTable[0xF3] = {
    name: "ISC (abs)",
    bytes: 2,
    cycles: 8,
    execute: function () {
        let addr = this.getIndrYRef();
        this.mem[addr]++;
        SBC.call(this, this.mem[addr]);
    }
};
//SLO
//Shift memory content 1 bit left, then OR with ACC
opTable[0x07] = {
    name: "SLO (zpg)",
    bytes: 2,
    cycles: 5,
    execute: function () {
        let addr = this.getZPageRef();
        this.flags.carry = (this.mem[addr] >= 0x80);
        this.mem[addr] = this.mem[addr] << 1;
        this.mem[addr] -= (this.flags.carry) ? 0x100 : 0;
        this.ACC = this.ACC | this.mem[addr];
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x17] = {
    name: "SLO (zpg, X)",
    bytes: 2,
    cycles: 6,
    execute: function () {
        let addr = this.getZPageRef(this.X);
        this.flags.carry = (this.mem[addr] >= 0x80);
        this.mem[addr] = this.mem[addr] << 1;
        this.mem[addr] -= (this.flags.carry) ? 0x100 : 0;
        this.ACC = this.ACC | this.mem[addr];
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x0F] = {
    name: "SLO (abs)",
    bytes: 3,
    cycles: 6,
    execute: function () {
        let addr = this.getZPageRef();
        this.flags.carry = (this.mem[addr] >= 0x80);
        this.mem[addr] = this.mem[addr] << 1;
        this.mem[addr] -= (this.flags.carry) ? 0x100 : 0;
        this.ACC = this.ACC | this.mem[addr];
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x1F] = {
    name: "SLO (abs, X)",
    bytes: 3,
    cycles: 7,
    execute: function () {
        let addr = this.getRef(this.X);
        this.flags.carry = (this.mem[addr] >= 0x80);
        this.mem[addr] = this.mem[addr] << 1;
        this.mem[addr] -= (this.flags.carry) ? 0x100 : 0;
        this.ACC = this.ACC | this.mem[addr];
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x1B] = {
    name: "SLO (abs, Y)",
    bytes: 3,
    cycles: 7,
    execute: function () {
        let addr = this.getRef(this.Y);
        this.flags.carry = (this.mem[addr] >= 0x80);
        this.mem[addr] = this.mem[addr] << 1;
        this.mem[addr] -= (this.flags.carry) ? 0x100 : 0;
        this.ACC = this.ACC | this.mem[addr];
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x03] = {
    name: "SLO (ind, Y)",
    bytes: 2,
    cycles: 8,
    execute: function () {
        let addr = this.getIndrXRef();
        this.flags.carry = (this.mem[addr] >= 0x80);
        this.mem[addr] = this.mem[addr] << 1;
        this.mem[addr] -= (this.flags.carry) ? 0x100 : 0;
        this.ACC = this.ACC | this.mem[addr];
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x13] = {
    name: "SLO (ind), Y",
    bytes: 2,
    cycles: 8,
    execute: function () {
        let addr = this.getIndrYRef();
        this.flags.carry = (this.mem[addr] >= 0x80);
        this.mem[addr] = this.mem[addr] << 1;
        this.mem[addr] -= (this.flags.carry) ? 0x100 : 0;
        this.ACC = this.ACC | this.mem[addr];
        this.updateNumStateFlags(this.ACC);
    }
};
//RLA
//Rotate one bit left in memory, AND result with ACC
opTable[0x27] = {
    name: "RLA (zpg)",
    bytes: 2,
    cycles: 5,
    execute: function () {
        let addr = this.getZPageRef();
        let addBit = this.flags.carry;
        this.flags.carry = (this.mem[addr] >= 0x80);
        this.mem[addr] = this.mem[addr] << 1;
        this.mem[addr] -= (this.flags.carry) ? 0x100 : 0;
        this.mem[addr] += addBit;
        this.ACC = this.ACC & this.mem[addr];
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x37] = {
    name: "RLA (zpg, X)",
    bytes: 2,
    cycles: 6,
    execute: function () {
        let addr = this.getZPageRef(this.X);
        let addBit = this.flags.carry;
        this.flags.carry = (this.mem[addr] >= 0x80);
        this.mem[addr] = this.mem[addr] << 1;
        this.mem[addr] -= (this.flags.carry) ? 0x100 : 0;
        this.mem[addr] += addBit;
        this.ACC = this.ACC & this.mem[addr];
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x2F] = {
    name: "RLA (abs)",
    bytes: 3,
    cycles: 7,
    execute: function () {
        let addr = this.getRef();
        let addBit = this.flags.carry;
        this.flags.carry = (this.mem[addr] >= 0x80);
        this.mem[addr] = this.mem[addr] << 1;
        this.mem[addr] -= (this.flags.carry) ? 0x100 : 0;
        this.mem[addr] += addBit;
        this.ACC = this.ACC & this.mem[addr];
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x3F] = {
    name: "RLA (abs, X)",
    bytes: 3,
    cycles: 7,
    execute: function () {
        let addr = this.getRef(this.X);
        let addBit = this.flags.carry;
        this.flags.carry = (this.mem[addr] >= 0x80);
        this.mem[addr] = this.mem[addr] << 1;
        this.mem[addr] -= (this.flags.carry) ? 0x100 : 0;
        this.mem[addr] += addBit;
        this.ACC = this.ACC & this.mem[addr];
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x3B] = {
    name: "RLA (abs, Y)",
    bytes: 3,
    cycles: 7,
    execute: function () {
        let addr = this.getRef(this.Y);
        let addBit = this.flags.carry;
        this.flags.carry = (this.mem[addr] >= 0x80);
        this.mem[addr] = this.mem[addr] << 1;
        this.mem[addr] -= (this.flags.carry) ? 0x100 : 0;
        this.mem[addr] += addBit;
        this.ACC = this.ACC & this.mem[addr];
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x23] = {
    name: "RLA (ind, X)",
    bytes: 2,
    cycles: 8,
    execute: function () {
        let addr = this.getIndrXRef();
        let addBit = this.flags.carry;
        this.flags.carry = (this.mem[addr] >= 0x80);
        this.mem[addr] = this.mem[addr] << 1;
        this.mem[addr] -= (this.flags.carry) ? 0x100 : 0;
        this.mem[addr] += addBit;
        this.ACC = this.ACC & this.mem[addr];
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x33] = {
    name: "RLA (ind), Y",
    bytes: 2,
    cycles: 8,
    execute: function () {
        let addr = this.getIndrYRef();
        let addBit = this.flags.carry;
        this.flags.carry = (this.mem[addr] >= 0x80);
        this.mem[addr] = this.mem[addr] << 1;
        this.mem[addr] -= (this.flags.carry) ? 0x100 : 0;
        this.mem[addr] += addBit;
        this.ACC = this.ACC & this.mem[addr];
        this.updateNumStateFlags(this.ACC);
    }
};
//SRE
//Shift memory 1 bit right, then EOR with ACC
opTable[0x47] = {
    name: "SRE (zpg)",
    bytes: 2,
    cycles: 5,
    execute: function () {
        let addr = this.getZPageRef();
        this.flags.carry = (this.mem[addr] % 2 == 1);
        this.mem[addr] = this.mem[addr] >> 1;
        this.ACC = this.ACC ^ this.mem[addr];
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x57] = {
    name: "SRE (zpg, X)",
    bytes: 2,
    cycles: 6,
    execute: function () {
        let addr = this.getZPageRef(this.X);
        this.flags.carry = (this.mem[addr] % 2 == 1);
        this.mem[addr] = this.mem[addr] >> 1;
        this.ACC = this.ACC ^ this.mem[addr];
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x4F] = {
    name: "SRE (abs)",
    bytes: 3,
    cycles: 6,
    execute: function () {
        let addr = this.getRef();
        this.flags.carry = (this.mem[addr] % 2 == 1);
        this.mem[addr] = this.mem[addr] >> 1;
        this.ACC = this.ACC ^ this.mem[addr];
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x5F] = {
    name: "SRE (abs, X)",
    bytes: 3,
    cycles: 7,
    execute: function () {
        let addr = this.getRef(this.X);
        this.flags.carry = (this.mem[addr] % 2 == 1);
        this.mem[addr] = this.mem[addr] >> 1;
        this.ACC = this.ACC ^ this.mem[addr];
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x5B] = {
    name: "SRE (abs, Y)",
    bytes: 3,
    cycles: 7,
    execute: function () {
        let addr = this.getRef(this.Y);
        this.flags.carry = (this.mem[addr] % 2 == 1);
        this.mem[addr] = this.mem[addr] >> 1;
        this.ACC = this.ACC ^ this.mem[addr];
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x43] = {
    name: "SRE (ind, X)",
    bytes: 2,
    cycles: 8,
    execute: function () {
        let addr = this.getIndrXRef();
        this.flags.carry = (this.mem[addr] % 2 == 1);
        this.mem[addr] = this.mem[addr] >> 1;
        this.ACC = this.ACC ^ this.mem[addr];
        this.updateNumStateFlags(this.ACC);
    }
};
opTable[0x53] = {
    name: "SRE (ind), X",
    bytes: 2,
    cycles: 8,
    execute: function () {
        let addr = this.getIndrYRef();
        this.flags.carry = (this.mem[addr] % 2 == 1);
        this.mem[addr] = this.mem[addr] >> 1;
        this.ACC = this.ACC ^ this.mem[addr];
        this.updateNumStateFlags(this.ACC);
    }
};
//RRA
//Rotate memory 1 bit right, then ADC with ACC
opTable[0x67] = {
    name: "RRA (zpg)",
    bytes: 2,
    cycles: 5,
    execute: function () {
        let addr = this.getZPageRef();
        let addBit = (this.flags.carry) ? 0x80 : 0;
        this.flags.carry = (this.mem[addr] % 2 == 1);
        this.mem[addr] = this.mem[addr] >> 1;
        this.mem[addr] += addBit;
        ADC.call(this, this.mem[addr]);
    }
};
opTable[0x77] = {
    name: "RRA (zpg, X)",
    bytes: 2,
    cycles: 6,
    execute: function () {
        let addr = this.getZPageRef(this.X);
        let addBit = (this.flags.carry) ? 0x80 : 0;
        this.flags.carry = (this.mem[addr] % 2 == 1);
        this.mem[addr] = this.mem[addr] >> 1;
        this.mem[addr] += addBit;
        ADC.call(this, this.mem[addr]);
    }
};
opTable[0x6F] = {
    name: "RRA (abs)",
    bytes: 3,
    cycles: 6,
    execute: function () {
        let addr = this.getRef();
        let addBit = (this.flags.carry) ? 0x80 : 0;
        this.flags.carry = (this.mem[addr] % 2 == 1);
        this.mem[addr] = this.mem[addr] >> 1;
        this.mem[addr] += addBit;
        ADC.call(this, this.mem[addr]);
    }
};
opTable[0x7F] = {
    name: "RRA (abs, X)",
    bytes: 3,
    cycles: 7,
    execute: function () {
        let addr = this.getRef(this.X);
        let addBit = (this.flags.carry) ? 0x80 : 0;
        this.flags.carry = (this.mem[addr] % 2 == 1);
        this.mem[addr] = this.mem[addr] >> 1;
        this.mem[addr] += addBit;
        ADC.call(this, this.mem[addr]);
    }
};
opTable[0x7B] = {
    name: "RRA (abs, Y)",
    bytes: 3,
    cycles: 7,
    execute: function () {
        let addr = this.getRef(this.Y);
        let addBit = (this.flags.carry) ? 0x80 : 0;
        this.flags.carry = (this.mem[addr] % 2 == 1);
        this.mem[addr] = this.mem[addr] >> 1;
        this.mem[addr] += addBit;
        ADC.call(this, this.mem[addr]);
    }
};
opTable[0x63] = {
    name: "RRA (ind, X)",
    bytes: 2,
    cycles: 8,
    execute: function () {
        let addr = this.getIndrXRef();
        let addBit = (this.flags.carry) ? 0x80 : 0;
        this.flags.carry = (this.mem[addr] % 2 == 1);
        this.mem[addr] = this.mem[addr] >> 1;
        this.mem[addr] += addBit;
        ADC.call(this, this.mem[addr]);
    }
};
opTable[0x73] = {
    name: "RRA (ind), Y",
    bytes: 2,
    cycles: 8,
    execute: function () {
        let addr = this.getIndrYRef();
        let addBit = (this.flags.carry) ? 0x80 : 0;
        this.flags.carry = (this.mem[addr] % 2 == 1);
        this.mem[addr] = this.mem[addr] >> 1;
        this.mem[addr] += addBit;
        ADC.call(this, this.mem[addr]);
    }
};
//LAR
//AND memory w/ SP, store result in ACC, X, and SP
opTable[0xBB] = {
    name: "LAR (abs, Y)",
    bytes: 3,
    cycles: 4,
    execute: function () {
        let addr = this.getRef(this.Y);
        this.SP = this.SP & this.mem[addr];
        this.X = this.SP;
        this.ACC = this.X;
        this.updateNumStateFlags(this.ACC);
    }
};
//ATX
//AND byte with ACC, transfer ACC to X
opTable[0xAB] = {
    name: "ATX (imm)",
    bytes: 2,
    cycles: 2,
    execute: function () {
        this.ACC = this.ACC & this.nextByte();
        this.X = this.ACC;
        this.updateNumStateFlags(this.ACC);
    }
};
function combineHexBuff(buff) {
    return (buff[0] << 8) | (buff[1]);
}
function combineHex(hiByte, lowByte) {
    return (hiByte << 8) | (lowByte);
}
function splitHex(hex) {
    let str = hex.toString(16).padStart(4, "0");
    let hiByte = parseInt(str.substr(0, 2), 16);
    let loByte = parseInt(str.substr(2), 16);
    return [hiByte, loByte];
}
function addWrap(reg, add) {
    reg = reg + add;
    if (reg > 0xFF) {
        reg = 0x00;
    }
    if (reg < 0x00) {
        reg = 0xFF;
    }
    return reg;
}
class iNESFile {
    constructor(filePath) {
        this.filePath = filePath;
        if (filePath.indexOf("/") === -1) {
            this.fileName = filePath.substr(filePath.lastIndexOf("/") + 1);
        }
        else {
            this.fileName = filePath;
        }
        let fs = require("fs");
        //Load file into buffer
        let buff = fs.readFileSync(filePath);
        //Check if valid iNES file (file starts with 'NES' and character break)
        if (buff[0] !== 0x4E)
            throw Error("Corrupted iNES file!"); //N
        if (buff[1] !== 0x45)
            throw Error("Corrupted iNES file!"); //E
        if (buff[2] !== 0x53)
            throw Error("Corrupted iNES file!"); //S
        if (buff[3] !== 0x1A)
            throw Error("Corrupted iNES file!"); //[END]
        this.pgrPages = buff[4]; //PGR size
        this.chrPages = buff[5]; //CHR size
        //Split byte 6 into mapper # and settings byte
        let hexStr = buff[6].toString(16);
        this.mapNum = parseInt(hexStr[0], 16);
        //Parse settings
        let lowNib = parseInt(hexStr[1], 16);
        let mask = 1;
        this.mirrorVertical = (lowNib & mask) == 1;
        mask = 1 << 1;
        this.batteryBacked = (lowNib & mask) == 1;
        mask = 1 << 2;
        this.trainerPresent = (lowNib & mask) == 1;
        mask = 1 << 3;
        this.fourScreenMode = (lowNib & mask) == 1;
        //Byte 7
        hexStr = buff[7].toString(16);
        //Get the hiByte of the mapper #
        let hiNib = parseInt(hexStr[0], 16);
        hiNib = hiNib << 4;
        this.mapNum = this.mapNum | hiNib;
        //Get additional settings
        lowNib = parseInt(hexStr[1], 16);
        mask = 1;
        this.vsGame = (lowNib & mask) == 1;
        mask = 1 << 1;
        this.isPC10 = (lowNib & mask) == 1;
        mask = 3 << 2;
        this.nes2_0 = (lowNib & mask) == 2;
        if (this.nes2_0) {
            //TODO: Parse byte 8
            //Byte 9
            hexStr = buff[9].toString(16);
            hiNib = parseInt(hexStr[0], 16);
            lowNib = parseInt(hexStr[1], 16);
            this.chrPages = ((hiNib << 4) & this.chrPages);
            this.pgrPages = ((lowNib << 4) & this.pgrPages);
            //Byte 10
            hexStr = buff[10].toString(16);
            hiNib = parseInt(hexStr[0], 16);
            lowNib = parseInt(hexStr[1], 16);
            this.pgrRamBattSize = hiNib;
            this.pgrRamSize = lowNib;
            //Byte 11
            hexStr = buff[11].toString(16);
            hiNib = parseInt(hexStr[0], 16);
            lowNib = parseInt(hexStr[1], 16);
            this.chrRamBattSize = hiNib;
            this.chrRamSize = lowNib;
            //Byte 12
            let byte = parseInt(buff[12], 16);
            mask = 1;
            this.isPAL = (byte & mask) == 1;
            mask = 1 << 1;
            this.bothFormats = (byte & mask) == 1;
            //TODO: Byte 13 (Vs. Hardware)
            //TODO: Byte 14 (Misc. ROMs)
        }
        //Start loading memory
        let startLoc = 0x10;
        if (this.trainerPresent) {
            this.trainerData = new Uint8Array(buff.slice(startLoc, startLoc + 0x200));
            startLoc += 0x200;
        }
        this.pgrRom = new Uint8Array(buff.slice(startLoc, startLoc + 0x4000 * this.pgrPages));
        startLoc += 0x4000 * this.pgrPages;
        this.chrRom = new Uint8Array(buff.slice(startLoc, startLoc + 0x2000 * this.chrPages));
        startLoc += 0x2000 * this.chrPages;
    }
    load(mem, ppuMem) {
        switch (this.mapNum) {
            case 0: //NROM
                mem.set(this.pgrRom, 0x8000);
                mem.set(this.pgrRom, 0xC000);
                ppuMem.set(this.chrRom, 0);
                break;
        }
    }
}
class PPU {
    constructor(mainMemory) {
        this.oddFrame = false;
        this.latch = false;
        //CTRL vars
        this.baseNTAddr = 0x2000;
        this.incAddrBy32 = false; //If false, inc by 1
        this.spritePatAddr = 0;
        this.bkgPatAddr = 0;
        this.sprite8x16 = false; //If false, sprite size is 8x8
        this.masterSlave = false;
        this.vBlankNMI = false;
        //MASK vars
        this.greyscale = false;
        this.showLeftBkg = false;
        this.showLeftSprite = false;
        this.showBkg = false;
        this.showSprites = false;
        this.maxRed = false;
        this.maxGreen = false;
        this.maxBlue = false;
        //STATUS vars
        this.vbl = false;
        this.PPUCTRL = 0x2000;
        this.PPUMASK = 0x2001;
        this.PPUSTATUS = 0x2002;
        this.OAMADDR = 0x2003;
        this.OAMDATA = 0x2004;
        this.PPUSCROLL = 0x2005;
        this.PPUADDR = 0x2006;
        this.PPUDATA = 0x2007;
        this.OAMDMA = 0x4014;
        this.mem = new Uint8Array(0x4000);
        this.OAM = new Uint8Array(0x100);
        this.cpuMem = mainMemory;
    }
    boot() {
        this.cpuMem[this.PPUCTRL] = 0;
        this.cpuMem[this.PPUMASK] = 0;
        this.cpuMem[this.PPUSTATUS] = 0xA0;
        this.cpuMem[this.OAMADDR] = 0;
        this.cpuMem[this.PPUSCROLL] = 0;
        this.cpuMem[this.PPUADDR] = 0;
        this.cpuMem[this.PPUDATA] = 0;
        this.oddFrame = false;
    }
    reset() {
        this.cpuMem[this.PPUCTRL] = 0;
        this.cpuMem[this.PPUMASK] = 0;
        this.cpuMem[this.PPUSCROLL] = 0;
        this.cpuMem[this.PPUDATA] = 0;
        this.oddFrame = false;
    }
    readReg(addr) {
        switch (addr) {
            case this.PPUSTATUS:
                this.latch = false;
                //this.cpuMem[addr] = (this.cpuMem[addr] & 0x7F);
                break;
        }
    }
    writeReg(addr) {
        let byte = this.cpuMem[addr];
        switch (addr) {
            case this.PPUCTRL:
                let ntBit = byte & 3;
                switch (ntBit) {
                    case 0:
                        this.baseNTAddr = 0x2000;
                        break;
                    case 1:
                        this.baseNTAddr = 0x2400;
                        break;
                    case 2:
                        this.baseNTAddr = 0x2800;
                        break;
                    case 3:
                        this.baseNTAddr = 0x2C00;
                        break;
                }
                this.incAddrBy32 = (byte & 4) == 1;
                if ((byte & 8) == 1) {
                    this.spritePatAddr = 0x1000;
                }
                else {
                    this.spritePatAddr = 0;
                }
                if ((byte & 16) == 1) {
                    this.bkgPatAddr = 0x1000;
                }
                else {
                    this.bkgPatAddr = 0;
                }
                this.sprite8x16 = (byte & 32) == 1;
                this.masterSlave = (byte & 64) == 1;
                this.vBlankNMI = (byte & 128) == 1;
                break;
            case this.PPUMASK:
                this.greyscale = (byte & 1) == 1;
                this.showLeftBkg = (byte & 2) == 1;
                this.showLeftSprite = (byte & 4) == 1;
                this.showBkg = (byte & 8) == 1;
                this.showSprites = (byte & 16) == 1;
                this.maxRed = (byte & 32) == 1;
                this.maxGreen = (byte & 64) == 1;
                this.maxBlue = (byte & 128) == 1;
                break;
            case this.PPUADDR:
                if (!this.latch) {
                    this.address = byte << 8;
                }
                else {
                    this.address += byte;
                }
                this.latch = !this.latch;
                break;
            case this.PPUDATA:
                this.mem[this.address] = byte;
                if (this.incAddrBy32) {
                    this.address += 32;
                }
                else {
                    this.address += 1;
                }
                break;
        }
    }
    setVBL() {
        this.vbl = true;
        this.mem[this.PPUSTATUS] |= 128;
    }
    clearVBL() {
        this.vbl = false;
        this.mem[this.PPUSTATUS] &= 0x7F;
    }
}
/// <reference path="rom.ts" />
/// <reference path="ppu.ts" />
class NES {
    constructor(nesPath) {
        this.MEM_PATH = "mem.hex";
        this.PPU_MEM_PATH = "ppuMem.hex";
        this.MEM_SIZE = 0x10000;
        this.fs = require("fs");
        this.running = false;
        if (nesPath === undefined) {
            if (this.fs.existsSync(this.MEM_PATH)) {
                this.mainMemory = this.fs.readFileSync(this.MEM_PATH);
            }
            else {
                this.mainMemory = new Uint8Array(this.MEM_SIZE);
                this.mainMemory.fill(0x02);
            }
        }
        else {
            this.mainMemory = new Uint8Array(this.MEM_SIZE);
            this.mainMemory.fill(0x02);
        }
        this.rom = new iNESFile(nesPath);
        this.ppu = new PPU(this.mainMemory);
        this.cpu = new CPU(this.mainMemory, this.ppu);
    }
    boot() {
        this.ppu.boot();
        this.rom.load(this.mainMemory, this.ppu.mem);
        this.cpu.boot();
        this.running = true;
        let i = 0;
        while (i++ < 250000) {
            try {
                this.cpu.step();
            }
            catch (e) {
                if (e.name == "Unexpected OpCode") {
                    console.log(e.message);
                    break;
                }
                throw e;
            }
        }
        this.fs.writeFileSync(this.MEM_PATH, Buffer.from(this.mainMemory));
        this.fs.writeFileSync(this.PPU_MEM_PATH, Buffer.from(this.ppu.mem));
    }
}
let nes = new NES("../nestest.nes");
nes.boot();
